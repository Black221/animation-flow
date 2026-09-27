import { exampleProject, parseProject, textHash, type Project } from '@af/schema';
import { timeProject } from '@af/engine';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, integratedLoudness, mixSoundtrack, renderMusic, SOUND_KINDS, sound, SR, trimSilence, MOOD_NAMES } from '../src';

const dir = mkdtempSync(join(tmpdir(), 'af-audio-'));
/** ffmpeg's own EBU R128 measurement of a WAV file (integrated loudness) */
const measure = (file: string) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:')[1] ?? '');
  return m ? Number(m[1]) : NaN;
};

const tone = (seconds: number, f: number, amp: number) => { const x = new Float32Array(Math.round(seconds * SR)); for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR) * amp; return x; };
/** a stand-in for a recorded voice: a tone that swells like speech */
const fakeVoice = (seconds: number) => { const x = tone(seconds, 220, 0.3); for (let i = 0; i < x.length; i++) x[i]! *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / SR); return x; };

describe('wav', () => {
  it('round-trips 16-bit and float files', () => {
    const a = { sampleRate: SR, channels: [tone(0.1, 440, 0.5), tone(0.1, 660, 0.25)] };
    for (const bits of [16, 32] as const) {
      const b = decodeWav(encodeWav(a, bits));
      expect(b.sampleRate).toBe(SR);
      expect(b.channels.length).toBe(2);
      expect(Math.abs(b.channels[1]![100]! - a.channels[1]![100]!)).toBeLessThan(1e-4);
    }
    expect(() => decodeWav(new Uint8Array(20))).toThrow();
  });
});

describe('loudness', () => {
  it('matches ffmpeg ebur128 within 0.2 LU', () => {
    const L = fakeVoice(6), R = tone(6, 1000, 0.1);
    const file = join(dir, 'l.wav');
    writeFileSync(file, encodeWav({ sampleRate: SR, channels: [L, R] }, 32));
    expect(Math.abs(integratedLoudness([L, R]) - measure(file))).toBeLessThan(0.2);
  });
  it('trims silence around a recording', () => {
    const x = new Float32Array(SR * 2); x.set(tone(0.5, 300, 0.4), SR / 2);
    const t = trimSilence(x);
    expect(t.length / SR).toBeGreaterThan(0.5);
    expect(t.length / SR).toBeLessThan(0.65);
  });
});

describe('synthesis', () => {
  it('every sound kind is finite, audible and deterministic', () => {
    for (const k of SOUND_KINDS) {
      const s = sound(k)!;
      expect(s.length, k).toBeGreaterThan(100);
      let peak = 0; for (const v of s) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); }
      expect(peak, k).toBeGreaterThan(0.05);
      expect(peak, k).toBeLessThan(2);
    }
    expect(sound('nope')).toBeNull();
  });
  it('every mood plays, stays finite and repeats identically', () => {
    for (const mood of MOOD_NAMES) {
      const [l] = renderMusic([{ start: 0, duration: 3, mood, gainDb: 0 }], 3);
      const [l2] = renderMusic([{ start: 0, duration: 3, mood, gainDb: 0 }], 3);
      expect(Buffer.from(l.buffer).equals(Buffer.from(l2.buffer)), mood).toBe(true);
      expect(Number.isFinite(integratedLoudness([l])), mood).toBe(true);
    }
  });
});

describe('mix', () => {
  const r = parseProject(exampleProject); if (!r.ok) throw new Error('bad example');
  // give two lines of scene 1 a "recording" so the mixer has voices to place
  const withVoices = (): { project: Project; voices: Map<string, Float32Array> } => {
    const p = structuredClone(r.project), voices = new Map<string, Float32Array>();
    p.scenes[0]!.narration.slice(0, 2).forEach((l, i) => { const id = String(i).padStart(32, 'a'); l.audio = { asset: id, textHash: textHash(l.text) }; l.duration = 1.5 + i; voices.set(id, fakeVoice(1.5 + i)); });
    return { project: p, voices };
  };

  it('reaches −16 LUFS with true peaks under −2 dBTP, confirmed by ffmpeg', () => {
    const { project, voices } = withVoices(), m = mixSoundtrack({ project, voices });
    expect(m.duration).toBeCloseTo(timeProject(project).duration, 1);
    expect(m.lufs).toBeCloseTo(-16, 0);
    expect(m.peakDb).toBeLessThanOrEqual(-1.95);
    const file = join(dir, 'mix.wav');
    writeFileSync(file, encodeWav({ sampleRate: SR, channels: [m.left, m.right] }, 32));
    const r2 = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.split('Summary:')[1] ?? '';
    expect(Math.abs(Number(/I:\s+(-?[\d.]+) LUFS/.exec(r2)![1]) - -16)).toBeLessThan(0.5);
    expect(Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r2)![1])).toBeLessThanOrEqual(-1.8); // ffmpeg's own true-peak meter
    expect(m.missing).toContain('s1/l3');
    expect(m.missing).not.toContain('s1/l1');
    expect(m.unknownSounds).toEqual([]);
  }, 30_000);

  it('places a voice where its line starts', () => {
    const { project, voices } = withVoices(), tl = timeProject(project);
    const m = mixSoundtrack({ project, voices, include: { music: false, sfx: false }, targetLufs: null });
    const start = tl.scenes[0]!.lines[0]!.start, idx = Math.round(start * SR);
    const rms = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += m.left[i]! ** 2; return Math.sqrt(s / (b - a)); };
    expect(rms(idx - 4000, idx - 100)).toBeLessThan(1e-4);
    expect(rms(idx + 100, idx + 4000)).toBeGreaterThan(0.05);
  });

  it('ignores a recording whose text has changed', () => {
    const { project, voices } = withVoices();
    project.scenes[0]!.narration[0]!.text = 'Un autre texte.';
    expect(mixSoundtrack({ project, voices }).missing).toContain('s1/l1');
  });

  it('lowers the music while a voice speaks', () => {
    const { project, voices } = withVoices(), tl = timeProject(project), l2 = tl.scenes[0]!.lines[1]!;
    const opts = { project, voices, targetLufs: null } as const;
    const mix = mixSoundtrack({ ...opts, include: { sfx: false } });
    const voiceOnly = mixSoundtrack({ ...opts, include: { sfx: false, music: false } });
    const freeMusic = mixSoundtrack({ ...opts, voices: new Map(), include: { sfx: false } });
    // no normalisation: the mix is a plain sum, so mix − voice = the music as it sounds under the voice
    const a = Math.round((l2.start + 0.5) * SR), b = Math.round((l2.end - 0.2) * SR);
    let under = 0, free = 0;
    for (let i = a; i < b; i++) { under += (mix.left[i]! - voiceOnly.left[i]!) ** 2; free += freeMusic.left[i]! ** 2; }
    expect(under / free).toBeLessThan(0.3); // −8 dB of ducking is 0.16 in energy
  }, 30_000);
});
