// The readiness probe (/api/ready), apart from the liveness probe (/api/health): can this process serve now? The
// database answers, the data folder takes a write, FFmpeg starts. Docker's healthcheck asks it, so the load balancer
// only waits for replicas that can work. The answer says which check failed, never why (no path, no error text).
import { ffmpegAvailable } from '@af/render';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Queryable } from './db';

export interface ReadyChecks { database: boolean; storage: boolean; ffmpeg: boolean }
export interface ReadyOptions {
  /** the folder that must take a write (DATA_DIR) */
  dataDir: string;
  /** whether FFmpeg starts (tests replace it) */
  ffmpeg?: () => Promise<boolean>;
  /** how long one check may take (ms) */
  timeoutMs?: number;
}

const within = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((ok) => { const t = setTimeout(() => ok(fallback), ms); t.unref?.(); })]);

/** returns a probe; the route is public, so FFmpeg is started at most once a minute and concurrent probes share one run */
export function readiness(db: Queryable, o: ReadyOptions): () => Promise<ReadyChecks> {
  const timeout = o.timeoutMs ?? 3000, startFfmpeg = o.ffmpeg ?? (() => ffmpegAvailable(timeout));
  let ffmpeg: { ok: boolean; at: number } | null = null, running: Promise<ReadyChecks> | null = null;

  const database = () => within(db.query('SELECT 1').then(() => true, () => false), timeout, false);
  const storage = () => within((async () => {
    const file = join(o.dataDir, `.ready-${process.pid}-${randomBytes(4).toString('hex')}`);
    try { await mkdir(o.dataDir, { recursive: true }); await writeFile(file, 'ok'); return true; } catch { return false; } finally { await rm(file, { force: true }).catch(() => undefined); }
  })(), timeout, false);
  const ffmpegOk = async () => {
    if (ffmpeg && Date.now() - ffmpeg.at < 60_000) return ffmpeg.ok;
    const ok = await startFfmpeg().catch(() => false);
    ffmpeg = { ok, at: Date.now() };
    return ok;
  };

  return () => running ??= (async () => {
    try {
      const [d, s, f] = await Promise.all([database(), storage(), ffmpegOk()]);
      return { database: d, storage: s, ffmpeg: f };
    } finally { running = null; }
  })();
}
