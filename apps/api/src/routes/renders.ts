// Render jobs: ask for a video of a saved version of a project, follow its progress, cancel it, watch or download
// the result. The job renders the version that was saved when it was requested, whatever happens to the project after.
// A render belongs to its project's workspace: members watch, editors render, cancel and delete.
import { timeProject } from '@af/engine';
import { parseProject } from '@af/schema';
import { stylePacks } from '@af/styles';
import type { FastifyInstance } from 'fastify';
import { existsSync, rmSync } from 'node:fs';
import { sendFile } from '../files';
import { z } from 'zod';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import { enqueue, markCanceled, type RenderRow } from '../render/queue';
import type { Signer } from '../render/sign';
import type { Quotas } from '../plans';
import { randomUUID } from 'node:crypto';

const WIDTHS = [640, 960, 1280, 1920] as const;
const Uuid = z.object({ id: z.string().uuid() });
const Body = z.object({
  style: z.string().optional(),
  width: z.number().int().refine((w) => (WIDTHS as readonly number[]).includes(w), `largeur parmi ${WIDTHS.join(', ')}`).default(1280),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  sceneId: z.string().optional(),
  subtitles: z.boolean().default(true),
  /** narration, music and sound effects */
  audio: z.boolean().default(true),
});
const CRF = { draft: 28, standard: 21, high: 17 } as const;

export function renderRoutes(app: FastifyInstance, db: Db, sign: Signer, quota: Quotas) {
  const view = (r: RenderRow) => ({
    id: r.id, projectId: r.project_id, projectVersion: r.project_version, status: r.status, options: r.options,
    framesDone: r.frames_done, framesTotal: r.frames_total, fps: r.fps, error: r.error, bytes: r.bytes == null ? null : Number(r.bytes), warnings: r.warnings ?? [],
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
    videoUrl: r.status === 'done' ? `/api/renders/${r.id}/video?${sign.sign(r.id)}` : null,
  });
  const load = async (id: string, ws: string) => (await db.query<RenderRow>('SELECT r.* FROM renders r JOIN projects p ON p.id = r.project_id WHERE r.id = $1 AND p.workspace_id = $2', [id, ws])).rows[0];

  app.post('/api/projects/:id/renders', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = Body.safeParse(req.body ?? {});
    if (!p.success) return reply.code(404).send({ error: 'projet introuvable' });
    if (!b.success) return reply.code(400).send({ error: 'options invalides', issues: b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const { rows } = await db.query<{ data: unknown; version: number }>('SELECT data, version FROM projects WHERE id = $1 AND workspace_id = $2', [p.data.id, wsOf(req).id]);
    const parsed = rows[0] ? parseProject(rows[0].data) : null;
    if (!rows[0] || !parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    const project = parsed.project, style = b.data.style ?? project.style;
    if (!stylePacks[style]) return reply.code(400).send({ error: `style inconnu : ${style}` });
    const tl = timeProject(project);
    let from: number | undefined, to: number | undefined;
    if (b.data.sceneId) {
      const s = tl.scenes.find((x) => x.id === b.data.sceneId);
      if (!s) return reply.code(400).send({ error: `scène inconnue : ${b.data.sceneId}` });
      from = s.start; to = s.start + s.duration;
    }
    const frames = Math.round((to ?? tl.duration) * project.fps) - Math.round((from ?? 0) * project.fps);
    // the plan: how wide, how many minutes left this month, room for the file
    const ws = wsOf(req).id, minutes = frames / project.fps / 60;
    await quota.width(ws, b.data.width); await quota.ensure(ws, 'renderMinutes', minutes); await quota.ensure(ws, 'storageMb', 0);
    const id = randomUUID();
    await quota.record(ws, 'renderMinutes', minutes, id, userOf(req).id);
    const job = await enqueue(db, p.data.id, rows[0].version, userOf(req).id, { style, width: b.data.width, crf: CRF[b.data.quality], subtitles: b.data.subtitles, audio: b.data.audio, ...(from != null ? { from, to: to!, sceneId: b.data.sceneId! } : {}) }, frames, (await quota.has(ws, 'priority')) ? 1 : 0, id);
    return reply.code(202).send(view(job));
  });

  app.get('/api/projects/:id/renders', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'projet introuvable' });
    return (await db.query<RenderRow>('SELECT r.* FROM renders r JOIN projects p ON p.id = r.project_id WHERE r.project_id = $1 AND p.workspace_id = $2 ORDER BY r.created_at DESC LIMIT 50', [p.data.id, wsOf(req).id])).rows.map(view);
  });

  app.get('/api/renders/:id', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    return r ? view(r) : reply.code(404).send({ error: 'rendu introuvable' });
  });

  app.post('/api/renders/:id/cancel', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), ws = wsOf(req).id, r = p.success ? await load(p.data.id, ws) : undefined;
    if (!r) return reply.code(404).send({ error: 'rendu introuvable' });
    if (r.status === 'queued' || r.status === 'running') await markCanceled(db, r.id); // a running worker sees it at its next heartbeat
    return view((await load(r.id, ws))!);
  });

  app.delete('/api/renders/:id', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'rendu introuvable' });
    if (r.status === 'running' || r.status === 'queued') return reply.code(409).send({ error: "annulez le rendu avant de le supprimer" });
    if (r.file) rmSync(r.file, { force: true });
    await db.query('DELETE FROM renders WHERE id = $1', [r.id]);
    return reply.code(204).send();
  });

  // the video itself: signed link (issued only to members, no session needed), byte ranges for seeking in the player
  app.get('/api/renders/:id/video', { config: { auth: 'public' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), q = req.query as { exp?: string; sig?: string; download?: string };
    if (!p.success || !sign.verify(p.data.id, q.exp, q.sig)) return reply.code(403).send({ error: 'lien expiré ou invalide' });
    const r = (await db.query<RenderRow>('SELECT * FROM renders WHERE id = $1', [p.data.id])).rows[0];
    if (!r || r.status !== 'done' || !r.file || !existsSync(r.file)) return reply.code(404).send({ error: 'vidéo introuvable' });
    return sendFile(req, reply, r.file, 'video/mp4', q.download ? `rendu-${r.id.slice(0, 8)}.mp4` : undefined);
  });
}
