// The render queue lives in PostgreSQL: no extra service. A worker claims the oldest queued job with
// FOR UPDATE SKIP LOCKED (several workers never take the same job), reports progress and a heartbeat while it runs,
// and a job whose worker went silent is put back in the queue (at most MAX_ATTEMPTS times).
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';

export type RenderStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export interface RenderOptionsDb { style: string; width: number; crf: number; from?: number; to?: number; sceneId?: string; subtitles: boolean; audio?: boolean }
export interface RenderRow {
  id: string; project_id: string; project_version: number; status: RenderStatus; options: RenderOptionsDb;
  frames_done: number; frames_total: number; fps: number | null; attempts: number; error: string | null;
  file: string | null; bytes: string | number | null; worker: string | null; warnings: string[];
  created_at: Date; started_at: Date | null; heartbeat_at: Date | null; finished_at: Date | null;
}

export const MAX_ATTEMPTS = 2;
export const STALE_AFTER_S = 90;

/** `priority`: taken before the others (the Pro plan) */
export async function enqueue(db: Db, projectId: string, version: number, by: string | null, options: RenderOptionsDb, framesTotal: number, priority = 0, id: string = randomUUID()): Promise<RenderRow> {
  const { rows } = await db.query<RenderRow>(
    'INSERT INTO renders (id, project_id, project_version, options, frames_total, created_by, priority) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [id, projectId, version, JSON.stringify(options), framesTotal, by, priority]);
  return rows[0]!;
}

/** one atomic statement: the row lock taken by the subquery keeps two workers off the same job */
export async function claim(db: Db, worker: string): Promise<RenderRow | null> {
  const { rows } = await db.query<RenderRow>(
    `UPDATE renders SET status = 'running', worker = $1, attempts = attempts + 1, started_at = now(), heartbeat_at = now(), error = NULL
      WHERE id = (SELECT id FROM renders WHERE status = 'queued' ORDER BY priority DESC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [worker]);
  return rows[0] ?? null;
}

/** progress + heartbeat; returns the current status, so the worker notices a cancellation */
export async function beat(db: Db, id: string, done: number, fps: number): Promise<RenderStatus | null> {
  const { rows } = await db.query<{ status: RenderStatus }>(
    `UPDATE renders SET frames_done = GREATEST(frames_done, $2), fps = $3, heartbeat_at = now() WHERE id = $1 RETURNING status`, [id, done, fps]);
  return rows[0]?.status ?? null;
}

export async function finish(db: Db, id: string, file: string, bytes: number, frames: number, warnings: string[] = []) {
  await db.query(`UPDATE renders SET status = 'done', file = $2, bytes = $3, frames_done = $4, frames_total = $4, warnings = $5, finished_at = now() WHERE id = $1 AND status = 'running'`, [id, file, bytes, frames, JSON.stringify(warnings)]);
}
export async function fail(db: Db, id: string, error: string) {
  await db.query(`UPDATE renders SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [id, error.slice(0, 2000)]);
  await db.query('DELETE FROM usage_events WHERE ref = $1', [id]); // the minutes it counted come back
}
export async function markCanceled(db: Db, id: string) {
  await db.query(`UPDATE renders SET status = 'canceled', finished_at = COALESCE(finished_at, now()) WHERE id = $1`, [id]);
  await db.query(`DELETE FROM usage_events WHERE ref = $1 AND NOT EXISTS (SELECT 1 FROM renders WHERE id::text = $1 AND frames_done >= frames_total AND frames_total > 0)`, [id]);
}

/** a worker shutting down hands its job back to the queue (the attempt does not count) */
export async function release(db: Db, id: string) {
  await db.query(`UPDATE renders SET status = 'queued', worker = NULL, frames_done = 0, attempts = GREATEST(0, attempts - 1) WHERE id = $1 AND status = 'running'`, [id]);
}

/** jobs whose worker stopped reporting: back to the queue, or failed after MAX_ATTEMPTS */
export async function requeueStale(db: Db, staleAfterS = STALE_AFTER_S): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE renders SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
            error = CASE WHEN attempts >= $2 THEN 'le rendu a été interrompu plusieurs fois' ELSE NULL END,
            worker = NULL, frames_done = 0, finished_at = CASE WHEN attempts >= $2 THEN now() ELSE NULL END
      WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1) RETURNING id`, [staleAfterS, MAX_ATTEMPTS]);
  return rows.length;
}
