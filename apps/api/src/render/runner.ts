// A render worker: claims queued jobs one at a time and renders them with @af/render (each job already uses
// several threads). It runs inside the API process by default (ROLE=all), or alone (ROLE=worker) next to a shared
// PostgreSQL and a shared RENDERS_DIR, to add rendering machines.
import { decodeWav, encodeWav, mixSoundtrack, SR } from '@af/audio';
import { renderVideo, AbortError } from '@af/render';
import { parseProject, voiceIsCurrent } from '@af/schema';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadVoices } from '../routes/voices';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import { beat, claim, fail, finish, markCanceled, release, requeueStale, type RenderRow } from './queue';

export interface RunnerOptions {
  db: Db;
  rendersDir: string;
  voicesDir: string;
  fontsDir?: string | undefined;
  threads: number;
  pollMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface Runner { stop(): Promise<void>; /** resolves when the queue is empty and nothing runs (tests) */ idle(): Promise<void>; readonly id: string }

export function startRunner(o: RunnerOptions): Runner {
  const id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`, pollMs = o.pollMs ?? 1000, log = o.log ?? (() => undefined);
  mkdirSync(o.rendersDir, { recursive: true });
  let stopped = false, busy = false, current: AbortController | null = null, wake: (() => void) | null = null;
  const idleWaiters: (() => void)[] = [];

  const runJob = async (job: RenderRow) => {
    const { rows } = await o.db.query<{ data: unknown; workspace_id: string }>('SELECT v.data, p.workspace_id FROM project_versions v JOIN projects p ON p.id = v.project_id WHERE v.project_id = $1 AND v.version = $2', [job.project_id, job.project_version]);
    if (!rows[0]) return fail(o.db, job.id, 'version du projet introuvable');
    const ctrl = new AbortController(); current = ctrl;
    const out = join(o.rendersDir, `${job.id}.mp4`), opt = job.options, audioFile = `${out}.audio.wav`, warnings: string[] = [];
    const range = opt.from != null || opt.to != null ? { from: opt.from ?? 0, to: opt.to ?? Infinity } : undefined;
    let lastBeat = 0;
    try {
      // the soundtrack first (seconds of work): voices on their lines, music, sound effects, −16 LUFS
      let withAudio = false;
      const parsed = parseProject(rows[0].data);
      if (opt.audio !== false && parsed.ok) {
        const assets = parsed.project.scenes.flatMap((s) => s.narration.filter(voiceIsCurrent).map((l) => l.audio!.asset));
        const voices = loadVoices(o.voicesDir, rows[0].workspace_id, new Set(assets), (b) => decodeWav(b).channels[0]!);
        const mix = mixSoundtrack({ project: parsed.project, voices, ...(range ? { range } : {}) });
        if (mix.missing.length) warnings.push(`${mix.missing.length} réplique(s) sans voix enregistrée : ${mix.missing.slice(0, 6).join(', ')}${mix.missing.length > 6 ? '…' : ''}`);
        if (mix.unknownSounds.length) warnings.push(`bruitages inconnus : ${mix.unknownSounds.join(', ')}`);
        writeFileSync(audioFile, encodeWav({ sampleRate: SR, channels: [mix.left, mix.right] }, 16));
        withAudio = true;
      }
      const r = await renderVideo({
        project: rows[0].data, out, style: opt.style, width: opt.width, crf: opt.crf, subtitles: opt.subtitles, preset: 'medium', range,
        ...(withAudio ? { audioFile } : {}),
        threads: o.threads, fontsDir: o.fontsDir, signal: ctrl.signal,
        onProgress: (p) => {
          const now = Date.now();
          if (now - lastBeat < 700 && p.done < p.total) return;
          lastBeat = now;
          void beat(o.db, job.id, p.done, p.fps).then((s) => { if (s === 'canceled') ctrl.abort(); }).catch(() => undefined);
        },
      });
      await finish(o.db, job.id, out, r.bytes, r.frames, warnings);
      log('render done', { id: job.id, frames: r.frames, ms: r.ms });
    } catch (e) {
      if (stopped) { await release(o.db, job.id); log('render handed back to the queue (shutdown)', { id: job.id }); }
      else if (e instanceof AbortError || ctrl.signal.aborted) { await markCanceled(o.db, job.id); log('render canceled', { id: job.id }); }
      else { await fail(o.db, job.id, (e as Error).message); log('render failed', { id: job.id, error: (e as Error).message }); }
    } finally { current = null; rmSync(audioFile, { force: true }); }
  };

  const loop = async () => {
    await requeueStale(o.db).catch(() => 0);
    let lastSweep = Date.now();
    while (!stopped) {
      let job: RenderRow | null = null;
      try { job = await claim(o.db, id); } catch (e) { log('queue error', { error: (e as Error).message }); }
      if (job) { busy = true; await runJob(job); busy = false; continue; }
      idleWaiters.splice(0).forEach((f) => f());
      if (Date.now() - lastSweep > 30_000) { lastSweep = Date.now(); await requeueStale(o.db).catch(() => 0); }
      await new Promise<void>((r) => { const t = setTimeout(r, pollMs); wake = () => { clearTimeout(t); r(); }; });
      wake = null;
    }
  };
  const done = loop();

  return {
    id,
    async stop() { stopped = true; current?.abort(); wake?.(); await done; },
    idle: () => new Promise<void>((r) => { if (!busy) { wake?.(); } idleWaiters.push(r); }),
  };
}
