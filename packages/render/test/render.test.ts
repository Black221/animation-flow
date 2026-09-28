import { encodeWav, mixSoundtrack, SR } from '@af/audio';
import { timeProject } from '@af/engine';
import { exampleProject, parseProject } from '@af/schema';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probe, renderVideo, AbortError } from '../src';

const dir = mkdtempSync(join(tmpdir(), 'af-render-'));
const project = (() => { const r = parseProject(exampleProject); if (!r.ok) throw new Error('bad example'); return r.project; })();

describe('renderVideo', () => {
  it('renders an excerpt inline with the right size, frame count and a subtitle track', async () => {
    const out = join(dir, 'inline.mp4'), seen: number[] = [];
    const r = await renderVideo({ project: exampleProject, out, width: 320, range: { from: 0, to: 2 }, preset: 'ultrafast', threads: 0, onProgress: (p) => seen.push(p.done) });
    expect(r).toMatchObject({ frames: 48, width: 320, height: 180, fps: 24 });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 320, height: 180, fps: 24, frames: 48 });
    expect(info.streams).toEqual(['video', 'subtitle']);
    expect(info.duration).toBeCloseTo(2, 1);
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

  it('muxes a soundtrack and keeps the full length even when the narration ends early', async () => {
    // scene 2 lasts 8 s but its only line ends after ~3 s: the file must still be 8 s long
    const out = join(dir, 'audio.mp4'), tl = timeProject(project), s2 = tl.scenes[1]!, range = { from: s2.start, to: s2.start + s2.duration };
    const m = mixSoundtrack({ project, voices: new Map(), range });
    writeFileSync(join(dir, 'a.wav'), encodeWav({ sampleRate: SR, channels: [m.left, m.right] }));
    await renderVideo({ project: exampleProject, out, width: 256, range, preset: 'ultrafast', threads: 0, audioFile: join(dir, 'a.wav') });
    const info = await probe(out);
    expect(info.streams).toEqual(['video', 'audio', 'subtitle']);
    expect(info.duration).toBeCloseTo(s2.duration, 1);
    expect(info.frames).toBe(Math.round(s2.duration * 24));
  }, 60_000);

  it('delivers a vertical film: reframed, subtitles drawn in, no subtitle track', async () => {
    const out = join(dir, 'vertical.mp4');
    const r = await renderVideo({ project: exampleProject, out, width: 180, aspect: '9:16', framing: 'follow', burnSubtitles: true, range: { from: 5, to: 7 }, preset: 'ultrafast', threads: 2 });
    expect(r).toMatchObject({ width: 180, height: 320, frames: 48 });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 180, height: 320, frames: 48 });
    expect(info.streams).toEqual(['video']);
  }, 60_000);

  it('makes a square film that fits the whole picture, and a WebM with sound and subtitles', async () => {
    const sq = join(dir, 'square.mp4');
    expect(await renderVideo({ project: exampleProject, out: sq, width: 200, aspect: '1:1', framing: 'fit', range: { from: 0, to: 1 }, preset: 'ultrafast', threads: 0 })).toMatchObject({ width: 200, height: 200 });
    const out = join(dir, 'film.webm'), range = { from: 3, to: 5 };
    const m = mixSoundtrack({ project, voices: new Map(), range });
    writeFileSync(join(dir, 'w.wav'), encodeWav({ sampleRate: SR, channels: [m.left, m.right] }));
    await renderVideo({ project: exampleProject, out, width: 256, format: 'webm', range, preset: 'ultrafast', threads: 2, audioFile: join(dir, 'w.wav') });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 256, height: 144, frames: 48 });
    expect(info.streams).toEqual(['video', 'audio', 'subtitle']);
    expect(info.duration).toBeCloseTo(2, 1);
  }, 90_000);

  it('makes a looping GIF at 15 images a second', async () => {
    const out = join(dir, 'film.gif');
    const r = await renderVideo({ project: exampleProject, out, width: 240, aspect: '4:5', format: 'gif', burnSubtitles: true, range: { from: 1, to: 3 }, preset: 'ultrafast', threads: 2 });
    expect(r).toMatchObject({ width: 240, height: 300, fps: 15 });
    const info = await probe(out);
    expect(info).toMatchObject({ width: 240, height: 300, frames: 30 });
    expect(info.streams).toEqual(['video']);
    expect(readFileSync(out).subarray(0, 6).toString()).toBe('GIF89a');
  }, 60_000);

  it('refuses an invalid project or an empty range', async () => {
    await expect(renderVideo({ project: { schemaVersion: 1 }, out: join(dir, 'x.mp4') })).rejects.toThrow(/invalid project/);
    await expect(renderVideo({ project: exampleProject, out: join(dir, 'y.mp4'), range: { from: 5, to: 5 } })).rejects.toThrow(/empty range/);
  });
});
