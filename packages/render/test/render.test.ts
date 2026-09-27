import { exampleProject } from '@af/schema';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probe, renderVideo, AbortError } from '../src';

const dir = mkdtempSync(join(tmpdir(), 'af-render-'));

describe('renderVideo', () => {
  it('renders an excerpt inline with the right size, frame count and a subtitle track', async () => {
    const out = join(dir, 'inline.mp4'), seen: number[] = [];
    const r = await renderVideo({ project: exampleProject, out, width: 320, range: { from: 0, to: 2 }, preset: 'ultrafast', threads: 0, onProgress: (p) => seen.push(p.done) });
    expect(r).toMatchObject({ frames: 48, width: 320, height: 180, fps: 24 });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 320, height: 180, fps: 24, frames: 48 });
    expect(info.streams).toEqual(['video', 'subtitle']);
    expect(seen.at(-1)).toBe(48);
    expect(existsSync(`${out}.parts`)).toBe(false);
  }, 60_000);

  it('splits the work across worker threads and joins the segments exactly', async () => {
    const out = join(dir, 'threads.mp4');
    const r = await renderVideo({ project: exampleProject, out, width: 256, range: { from: 1, to: 5 }, preset: 'ultrafast', threads: 3, subtitles: false });
    expect(r.frames).toBe(96);
    const info = await probe(out);
    expect(info.frames).toBe(96);
    expect(info.streams).toEqual(['video']);
  }, 90_000);

  it('stops on abort and leaves no file behind', async () => {
    const out = join(dir, 'abort.mp4'), ctrl = new AbortController();
    const p = renderVideo({ project: exampleProject, out, width: 256, preset: 'ultrafast', threads: 0, signal: ctrl.signal, onProgress: (x) => { if (x.done > 5) ctrl.abort(); } });
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.parts`)).toBe(false);
  }, 60_000);

  it('refuses an invalid project or an empty range', async () => {
    await expect(renderVideo({ project: { schemaVersion: 1 }, out: join(dir, 'x.mp4') })).rejects.toThrow(/invalid project/);
    await expect(renderVideo({ project: exampleProject, out: join(dir, 'y.mp4'), range: { from: 5, to: 5 } })).rejects.toThrow(/empty range/);
  });
});
