// FFmpeg and ffprobe as child processes. FFMPEG_PATH / FFPROBE_PATH override the binaries found on PATH.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** whether FFmpeg can be started (`ffmpeg -version` exits 0 within `timeoutMs`); the readiness probe asks it */
export function ffmpegAvailable(timeoutMs = 3000): Promise<boolean> {
  return new Promise((ok) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-version'], { stdio: 'ignore' });
    const timer = setTimeout(() => { p.kill('SIGKILL'); ok(false); }, timeoutMs);
    p.on('error', () => { clearTimeout(timer); ok(false); });
    p.on('close', (code) => { clearTimeout(timer); ok(code === 0); });
  });
}

export type VideoCodec = 'h264' | 'vp9';
/** the encoder's options: H.264 (MP4, and the intermediate of a GIF) or VP9 (WebM, constant quality, all cores) */
const CODEC: Record<VideoCodec, (crf: number, preset: string) => string[]> = {
  h264: (crf, preset) => ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)],
  vp9: (crf, preset) => ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', preset === 'ultrafast' || preset === 'veryfast' ? 'realtime' : 'good', '-cpu-used', preset === 'slow' ? '2' : '4'],
};

/** an encoder reading raw RGBA frames on stdin */
export function rawEncoder(o: { width: number; height: number; fps: number; crf: number; preset: string; out: string; codec?: VideoCodec }): ChildProcessWithoutNullStreams {
  return spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
    ...CODEC[o.codec ?? 'h264'](o.crf, o.preset), '-pix_fmt', 'yuv420p', '-r', String(o.fps),
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

/** decode any audio FFmpeg reads (MP3, WAV, OGG…) to mono 32-bit float at `rate` Hz */
export function decodeAudio(bytes: Uint8Array, rate = 48000, signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((ok, bad) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1']);
    const chunks: Buffer[] = []; let err = '';
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.on('error', bad);
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code !== 0) return bad(new Error(`audio could not be decoded: ${err.trim().split('\n').pop() ?? code}`));
      const buf = Buffer.concat(chunks), out = new Float32Array(buf.length >> 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
      ok(out);
    });
    p.stdin.on('error', () => undefined); // the process may exit before reading everything (corrupt input)
    p.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
}

/** what an audio file is, from its first bytes, as FFmpeg names the format (anything else: not accepted) */
export function audioType(b: Uint8Array): 'wav' | 'mp3' | 'ogg' | 'flac' | 'mov' | 'matroska' | 'aac' | 'aiff' | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe6) === 0xe2)) return 'mp3';
  if (s(0, 4) === 'OggS') return 'ogg';
  if (s(0, 4) === 'fLaC') return 'flac';
  if (s(4, 4) === 'ftyp') return 'mov';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'matroska';
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return 'aac';
  if (s(0, 4) === 'FORM' && (s(8, 4) === 'AIFF' || s(8, 4) === 'AIFC')) return 'aiff';
  return null;
}

/** decode an imported sound (a recorded voice, a music) to mono 32-bit float at `rate` Hz, `maxSeconds` at most.
 *  The format is named from the file's first bytes and given to FFmpeg, which reads only that local copy: a
 *  playlist or a reference to another file or address is never followed. */
export async function decodeUpload(bytes: Uint8Array, o: { rate?: number; maxSeconds: number; signal?: AbortSignal }): Promise<{ samples: Float32Array; truncated: boolean }> {
  const fmt = audioType(bytes);
  if (!fmt) throw new Error('format audio non pris en charge (WAV, MP3, OGG, FLAC, M4A, WebM, AAC ou AIFF)');
  const rate = o.rate ?? 48000, tmp = join(tmpdir(), `af-upload-${randomUUID()}`);
  writeFileSync(tmp, bytes);
  try {
    const samples = await new Promise<Float32Array>((ok, bad) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', fmt, '-i', tmp, '-vn', '-t', String(o.maxSeconds + 0.5), '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = []; let err = '';
      p.stdout.on('data', (d: Buffer) => chunks.push(d));
      p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
      const abort = () => p.kill('SIGKILL');
      o.signal?.addEventListener('abort', abort, { once: true });
      p.on('error', bad);
      p.on('close', (code) => {
        o.signal?.removeEventListener('abort', abort);
        if (code !== 0) return bad(new Error(`son illisible : ${err.trim().split('\n').pop() ?? code}`));
        const buf = Buffer.concat(chunks), out = new Float32Array(buf.length >> 2);
        for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
        ok(out);
      });
    });
    const max = Math.round(o.maxSeconds * rate);
    return samples.length > max ? { samples: samples.subarray(0, max), truncated: true } : { samples, truncated: false };
  } finally { rmSync(tmp, { force: true }); }
}
