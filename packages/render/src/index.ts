// renderVideo(): a project → an MP4. The frames of the requested range are split into chunks rendered in parallel
// (one worker thread per chunk, each with its own canvas, style renderer and FFmpeg encoder), then the segments are
// joined without re-encoding and the subtitles are added as a soft track. Deterministic frames make chunks exact:
// the same frame renders the same wherever and whenever it is computed.
import { timeProject, toSrt } from '@af/engine';
import { parseProject } from '@af/schema';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { renderChunk, type ChunkJob } from './chunk';
import { AbortError, FFMPEG, run } from './ffmpeg';

export { probe, AbortError } from './ffmpeg';
export { registerFonts } from './fonts';

export interface Progress { done: number; total: number; elapsedMs: number; fps: number }
export interface RenderVideoOptions {
  project: unknown;
  out: string;
  /** style pack id; defaults to the project's */
  style?: string | undefined;
  /** output width in pixels; height follows the project's aspect ratio (both rounded to even numbers) */
  width?: number | undefined;
  /** seconds; default: the whole film */
  range?: { from: number; to: number } | undefined;
  /** x264 quality, 0 (lossless) … 51; default 20 */
  crf?: number | undefined;
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | undefined;
  /** add the narration as a subtitle track; default true */
  subtitles?: boolean | undefined;
  /** worker threads; 0 renders inline on the calling thread (tests, tiny renders) */
  threads?: number | undefined;
  fontsDir?: string | undefined;
  onProgress?: ((p: Progress) => void) | undefined;
  signal?: AbortSignal | undefined;
}
export interface RenderResult { file: string; frames: number; width: number; height: number; fps: number; duration: number; bytes: number; ms: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const LANG: Record<string, string> = { fr: 'fra', en: 'eng', es: 'spa', de: 'deu', it: 'ita', pt: 'por', wo: 'wol', ar: 'ara' };

// bundled (production): chunk-worker.js sits next to the bundle; from sources (development): dev-worker.mjs, which
// loads the TypeScript entry through tsx
function workerUrl(): URL {
  const js = new URL('./chunk-worker.js', import.meta.url);
  return existsSync(fileURLToPath(js)) ? js : new URL('./dev-worker.mjs', import.meta.url);
}

function inWorker(job: ChunkJob, onFrame: (n: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, bad) => {
    const w = new Worker(workerUrl(), { workerData: job });
    const abort = () => w.postMessage({ type: 'abort' });
    signal?.addEventListener('abort', abort, { once: true });
    const end = (f: () => void) => { signal?.removeEventListener('abort', abort); void w.terminate(); f(); };
    w.on('message', (m: { type: string; done?: number; name?: string; message?: string }) => {
      if (m.type === 'progress') onFrame(m.done!);
      else if (m.type === 'done') end(ok);
      else if (m.type === 'error') end(() => bad(m.name === 'AbortError' ? new AbortError() : new Error(m.message)));
    });
    w.on('error', (e) => end(() => bad(e)));
  });
}

export async function renderVideo(o: RenderVideoOptions): Promise<RenderResult> {
  const t0 = Date.now(), parsed = parseProject(o.project);
  if (!parsed.ok) throw new Error('invalid project: ' + parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  const project = parsed.project, tl = timeProject(project), fps = project.fps;
  const from = Math.max(0, o.range?.from ?? 0), to = Math.min(tl.duration, o.range?.to ?? tl.duration);
  const first = Math.round(from * fps), last = Math.max(first, Math.min(tl.frames, Math.round(to * fps)));
  const total = last - first;
  if (total <= 0) throw new Error('nothing to render: empty range');
  const width = even(o.width ?? project.width), height = even((width * project.height) / project.width);
  const threads = Math.max(0, Math.floor(o.threads ?? 0)), chunks = Math.max(1, Math.min(threads || 1, Math.floor(total / 24) || 1));
  const parts = `${o.out}.parts`;
  rmSync(parts, { recursive: true, force: true });
  mkdirSync(parts, { recursive: true });
  mkdirSync(dirname(o.out), { recursive: true });

  const doneBy = new Array<number>(chunks).fill(0);
  let lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    const done = doneBy.reduce((a, b) => a + b, 0), el = now - t0;
    o.onProgress?.({ done, total, elapsedMs: el, fps: el > 0 ? (done * 1000) / el : 0 });
  };
  try {
    const jobs: ChunkJob[] = Array.from({ length: chunks }, (_, k) => ({
      project: o.project, style: o.style ?? project.style, width, height,
      from: first + Math.floor((total * k) / chunks), to: first + Math.floor((total * (k + 1)) / chunks),
      crf: o.crf ?? 20, preset: o.preset ?? 'medium', out: join(parts, `part${String(k).padStart(3, '0')}.mp4`), fontsDir: o.fontsDir,
    }));
    const onFrame = (k: number) => (n: number) => { doneBy[k] = n; report(); };
    if (threads === 0) for (const [k, j] of jobs.entries()) await renderChunk(j, onFrame(k), o.signal);
    else await Promise.all(jobs.map((j, k) => inWorker(j, onFrame(k), o.signal)));
    if (o.signal?.aborted) throw new AbortError();
    report(true);

    // join the segments (no re-encoding) and add the narration as a subtitle track
    const list = join(parts, 'list.txt');
    writeFileSync(list, jobs.map((j) => `file '${pathToFileURL(j.out).pathname.replace(/'/g, "'\\''")}'`).join('\n'));
    const srt = o.subtitles === false ? '' : toSrt(project, tl, { from: first / fps, to: last / fps });
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
    if (srt) { writeFileSync(join(parts, 'subs.srt'), srt); args.push('-i', join(parts, 'subs.srt'), '-map', '0:v', '-map', '1:s', '-c:s', 'mov_text', '-metadata:s:s:0', `language=${LANG[project.language] ?? 'und'}`); }
    args.push('-c:v', 'copy', '-metadata', `title=${project.title}`, '-movflags', '+faststart', o.out);
    await run(FFMPEG, args, o.signal);
    return { file: o.out, frames: total, width, height, fps, duration: total / fps, bytes: statSync(o.out).size, ms: Date.now() - t0 };
  } catch (e) {
    rmSync(o.out, { force: true });
    throw e;
  } finally {
    rmSync(parts, { recursive: true, force: true });
  }
}
