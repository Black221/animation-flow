// FFmpeg and ffprobe as child processes. FFMPEG_PATH / FFPROBE_PATH override the binaries found on PATH.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** run to completion; rejects with the tail of stderr */
export function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.on('error', (e) => { signal?.removeEventListener('abort', abort); bad(e); });
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) bad(new AbortError());
      else if (code === 0) ok();
      else bad(new Error(`${cmd} exited with ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/** an H.264 encoder reading raw RGBA frames on stdin */
export function rawEncoder(o: { width: number; height: number; fps: number; crf: number; preset: string; out: string }): ChildProcessWithoutNullStreams {
  return spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p', '-r', String(o.fps),
    o.out,
  ]);
}

export interface ProbeInfo { width: number; height: number; fps: number; frames: number; duration: number; streams: string[] }
export async function probe(file: string): Promise<ProbeInfo> {
  const out = await new Promise<string>((ok, bad) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file]);
    let s = '', e = '';
    p.stdout.on('data', (d: Buffer) => { s += d; });
    p.stderr.on('data', (d: Buffer) => { e += d; });
    p.on('error', bad);
    p.on('close', (c) => (c === 0 ? ok(s) : bad(new Error(e.trim()))));
  });
  const j = JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string }[]; format: { duration?: string } };
  const v = j.streams.find((x) => x.codec_type === 'video');
  const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return { width: v?.width ?? 0, height: v?.height ?? 0, fps: n! / (d || 1), frames: Number(v?.nb_read_frames ?? 0), duration: Number(j.format.duration ?? 0), streams: j.streams.map((x) => x.codec_type) };
}

export class AbortError extends Error { constructor() { super('render canceled'); this.name = 'AbortError'; } }
