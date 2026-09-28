// renderVideo(): a project → an MP4. The frames of the requested range are split into chunks rendered in parallel
// (one worker thread per chunk, each with its own canvas, style renderer and FFmpeg encoder), then the segments are
// joined without re-encoding and the subtitles are added as a soft track. Deterministic frames make chunks exact:
// the same frame renders the same wherever and whenever it is computed.
import { ASPECTS, timeProject, toSrt, type Aspect, type Framing } from '@af/engine';
import { parseProject } from '@af/schema';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { renderChunk, type ChunkJob } from './chunk';
import { AbortError, FFMPEG, run } from './ffmpeg';

export { probe, AbortError, decodeAudio, decodeUpload, audioType } from './ffmpeg';
export { registerFonts } from './fonts';
export { renderStill } from './still';
export { loadPictures, normalizePicture, normalizeUpload, pictureType, type Upload } from './pictures';

export interface Progress { done: number; total: number; elapsedMs: number; fps: number }
export interface RenderVideoOptions {
  project: unknown;
  out: string;
  /** style pack id; defaults to the project's */
  style?: string | undefined;
  /** output width in pixels; the height follows the aspect (both rounded to even numbers) */
  width?: number | undefined;
  /** the output's shape (default: the project's); another shape reframes the film (see @af/engine reframe) */
  aspect?: Aspect | undefined;
  /** how a reframed film is fitted: follow the action (default), keep the centre, or show it whole */
  framing?: Framing | undefined;
  /** mp4 (H.264 + AAC, plays everywhere; default), webm (VP9 + Opus) or gif (no sound, 15 images a second) */
  format?: OutputFormat | undefined;
  /** draw the narration into the picture (instead of, or for a GIF without, a subtitle track) */
  burnSubtitles?: boolean | undefined;
  /** seconds; default: the whole film */
  range?: { from: number; to: number } | undefined;
  /** x264 quality, 0 (lossless) … 51; default 20 */
  crf?: number | undefined;
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | undefined;
  /** add the narration as a subtitle track; default true */
  subtitles?: boolean | undefined;
  /** a WAV soundtrack covering the rendered range (from @af/audio's mixSoundtrack), muxed as AAC */
  audioFile?: string | undefined;
  /** worker threads; 0 renders inline on the calling thread (tests, tiny renders) */
  threads?: number | undefined;
  fontsDir?: string | undefined;
  /** pictures of the project (asset id → file): decors painted by an image model */
  images?: Record<string, string> | undefined;
  onProgress?: ((p: Progress) => void) | undefined;
  signal?: AbortSignal | undefined;
}
export type OutputFormat = 'mp4' | 'webm' | 'gif';
export const FORMAT_MIME: Record<OutputFormat, string> = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' };
const GIF_FPS = 15;

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
  const format = o.format ?? 'mp4', ratio = o.aspect ? ASPECTS[o.aspect] : project.width / project.height;
  const width = even(o.width ?? project.width), height = even(width / ratio);
  // a GIF is made from a nearly lossless H.264 intermediate; the segments of a WebM are VP9 already
  const codec = format === 'webm' ? 'vp9' as const : 'h264' as const, ext = format === 'webm' ? 'webm' : 'mp4';
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
      crf: format === 'gif' ? 12 : o.crf ?? (format === 'webm' ? 33 : 20), preset: o.preset ?? 'medium', out: join(parts, `part${String(k).padStart(3, '0')}.${ext}`), fontsDir: o.fontsDir, images: o.images,
      codec, aspect: o.aspect, framing: o.framing, burnSubtitles: o.burnSubtitles,
    }));
    const onFrame = (k: number) => (n: number) => { doneBy[k] = n; report(); };
    if (threads === 0) for (const [k, j] of jobs.entries()) await renderChunk(j, onFrame(k), o.signal);
    else await Promise.all(jobs.map((j, k) => inWorker(j, onFrame(k), o.signal)));
    if (o.signal?.aborted) throw new AbortError();
    report(true);

    // join the segments (no re-encoding) and add the narration as a subtitle track
    const list = join(parts, 'list.txt'), seconds = (total / fps).toFixed(3);
    writeFileSync(list, jobs.map((j) => `file '${j.out.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const concat = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
    if (format === 'gif') {
      // one palette for the film, the frames dithered on it, repeating forever
      await run(FFMPEG, [...concat, '-vf', `fps=${GIF_FPS},split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', '-t', seconds, o.out], o.signal);
      return { file: o.out, frames: total, width, height, fps: GIF_FPS, duration: total / fps, bytes: statSync(o.out).size, ms: Date.now() - t0 };
    }
    const srt = o.subtitles === false || o.burnSubtitles ? '' : toSrt(project, tl, { from: first / fps, to: last / fps });
    const args = [...concat], maps = ['-map', '0:v'];
    let next = 1;
    const lang = LANG[project.language] ?? 'und', webm = format === 'webm';
    if (o.audioFile) { args.push('-i', o.audioFile); maps.push('-map', `${next++}:a`, ...(webm ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k']), '-ar', '48000', '-metadata:s:a:0', `language=${lang}`); }
    if (srt) { writeFileSync(join(parts, 'subs.srt'), srt); args.push('-i', join(parts, 'subs.srt')); maps.push('-map', `${next++}:s`, '-c:s', webm ? 'webvtt' : 'mov_text', '-metadata:s:s:0', `language=${lang}`); }
    // an explicit length, not -shortest: that stops at the end of the shortest stream, and the subtitle track ends
    // with the last line of narration, often well before the picture
    args.push(...maps, '-c:v', 'copy', '-t', seconds, '-metadata', `title=${project.title}`, ...(webm ? [] : ['-movflags', '+faststart']), o.out);
    await run(FFMPEG, args, o.signal);
    return { file: o.out, frames: total, width, height, fps, duration: total / fps, bytes: statSync(o.out).size, ms: Date.now() - t0 };
  } catch (e) {
    rmSync(o.out, { force: true });
    throw e;
  } finally {
    rmSync(parts, { recursive: true, force: true });
  }
}
