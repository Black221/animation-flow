// Render frames [from, to) of a project into one H.264 segment. Runs inline or inside a worker thread; either way it
// builds its own evaluator and renderer, so chunks share nothing and can run in parallel.
import { createCanvas } from '@napi-rs/canvas';
import { createEvaluator } from '@af/engine';
import { registry } from '@af/library';
import { parseProject } from '@af/schema';
import { getStyle, type CanvasLike } from '@af/styles';
import { once } from 'node:events';
import { rawEncoder, AbortError } from './ffmpeg';
import { registerFonts } from './fonts';

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
  fontsDir?: string | undefined;
}

export async function renderChunk(job: ChunkJob, onFrame: (done: number) => void, signal?: AbortSignal): Promise<void> {
  const parsed = parseProject(job.project);
  if (!parsed.ok) throw new Error('invalid project: ' + parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  const project = parsed.project, fps = project.fps;
  registerFonts(job.fontsDir);
  const ev = createEvaluator(project, registry);
  const canvas = createCanvas(job.width, job.height);
  const make = (w: number, h: number) => createCanvas(w, h) as unknown as CanvasLike;
  const renderer = getStyle(job.style).create(canvas as unknown as CanvasLike, { createCanvas: make });
  const enc = rawEncoder({ width: job.width, height: job.height, fps, crf: job.crf, preset: job.preset, out: job.out });
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
  }
}
