// Render frames [from, to) of a project into one H.264 segment. Runs inline or inside a worker thread; either way it
// builds its own evaluator and renderer, so chunks share nothing and can run in parallel.
import { createCanvas } from '@napi-rs/canvas';
import { ASPECTS, createEvaluator, planFraming, type Aspect, type Framing } from '@af/engine';
import { registry } from '@af/library';
import { parseProject } from '@af/schema';
import { createOutputRenderer, getStyle, type CanvasLike } from '@af/styles';
import { once } from 'node:events';
import { rawEncoder, AbortError, type VideoCodec } from './ffmpeg';
import { registerFonts } from './fonts';
import { loadPictures } from './pictures';

export interface ChunkJob {
  project: unknown;
  style: string;
  width: number;
  height: number;
  from: number;
  to: number;
  crf: number;
  preset: string;
  out: string;
  codec?: VideoCodec | undefined;
  /** the output's shape, when it is not the film's: 9:16, 1:1, 4:5 */
  aspect?: Aspect | undefined;
  framing?: Framing | undefined;
  /** draw the narration into the picture */
  burnSubtitles?: boolean | undefined;
  fontsDir?: string | undefined;
  /** pictures of the project (asset id → file) */
  images?: Record<string, string> | undefined;
}

export async function renderChunk(job: ChunkJob, onFrame: (done: number) => void, signal?: AbortSignal): Promise<void> {
  const parsed = parseProject(job.project);
  if (!parsed.ok) throw new Error('invalid project: ' + parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  const project = parsed.project, fps = project.fps;
  registerFonts(job.fontsDir);
  const ev = createEvaluator(project, registry), images = await loadPictures(job.images);
  const canvas = createCanvas(job.width, job.height);
  const make = (w: number, h: number) => createCanvas(w, h) as unknown as CanvasLike;
  // another shape than the film's: the window follows the action (computed from the whole film, so every chunk
  // gets the same one), or the whole picture fits
  const reshaped = job.aspect && Math.abs(ASPECTS[job.aspect] - project.width / project.height) > 0.01, framing = job.framing ?? 'follow';
  const path = reshaped && framing !== 'fit' ? planFraming(ev, project.width, project.height, ASPECTS[job.aspect!], framing) : null;
  const opts = { createCanvas: make, images: images as never, subtitles: !!job.burnSubtitles };
  const renderer = reshaped
    ? createOutputRenderer(getStyle(job.style), canvas as unknown as CanvasLike, { ...opts, framing, window: path ? (t) => path.at(t) : undefined })
    : getStyle(job.style).create(canvas as unknown as CanvasLike, opts);
  const enc = rawEncoder({ width: job.width, height: job.height, fps, crf: job.crf, preset: job.preset, out: job.out, codec: job.codec });
  let stderr = '';
  enc.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
  const exited = new Promise<number | null>((ok) => enc.on('close', ok));
  const kill = () => enc.kill('SIGKILL');
  signal?.addEventListener('abort', kill, { once: true });
  try {
    for (let f = job.from; f < job.to; f++) {
      if (signal?.aborted) throw new AbortError();
      renderer.render(ev.frameAt(f / fps));
      if (!enc.stdin.write(canvas.data())) await Promise.race([once(enc.stdin, 'drain'), exited]);
      onFrame(f - job.from + 1);
    }
    enc.stdin.end();
    const code = await exited;
    if (signal?.aborted) throw new AbortError();
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-2).join(' | ')}`);
  } finally {
    signal?.removeEventListener('abort', kill);
    renderer.dispose();
    if (enc.exitCode == null) enc.kill('SIGKILL');
    await exited; // Windows keeps the segment locked until ffmpeg is gone, and the caller deletes it next
  }
}
