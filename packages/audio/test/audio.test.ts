import { exampleProject, parseProject, textHash, type Project } from '@af/schema';
import { timeProject } from '@af/engine';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chordNotes, decodeWav, encodeWav, integratedLoudness, mixSoundtrack, MOODS, pieceNotes, recipeSound, renderMusic, SOUND_KINDS, sound, soundFor, SR, trimSilence, MOOD_NAMES } from '../src';
import { Piece, SoundRecipe } from '@af/schema';

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
      let peak = 0, finite = true; for (const v of s) { finite &&= Number.isFinite(v); peak = Math.max(peak, Math.abs(v)); }
      expect(finite).toBe(true);
      expect(peak, k).toBeGreaterThan(0.05);
      expect(peak, k).toBeLessThan(2);
    }
    expect(sound('nope')).toBeNull();
  });
  it('every mood plays, stays finite and repeats identically', () => {
    for (const mood of MOOD_NAMES) {
      const [l] = renderMusic([{ start: 0, duration: 3, piece: MOODS[mood]!, gainDb: 0 }], 3);
      const [l2] = renderMusic([{ start: 0, duration: 3, piece: MOODS[mood]!, gainDb: 0 }], 3);
      expect(Buffer.from(l.buffer).equals(Buffer.from(l2.buffer)), mood).toBe(true);
      expect(Number.isFinite(integratedLoudness([l])), mood).toBe(true);
    }
  });
});

describe('composed music and designed sounds', { timeout: 30_000 }, () => {
  const piece = Piece.parse({
    name: 'Marche', bpm: 120, key: 'D', mode: 'major', chords: ['I', 'V7', 'vi', 'IV'], swing: 0.1,
    parts: [
      { instrument: 'piano', play: 'chords', pattern: 'x...x...x...x...' }, { instrument: 'strings', play: 'chords', pattern: 'x---------------', gain: -6 },
      { instrument: 'flute', play: 'melody', notes: ['1 - 3 - 5 - 8 - 7 - 5 - 3 - 2 -'], octave: 1 }, { instrument: 'lead', play: 'arp', pattern: 'x.x.x.x.x.x.x.x.', arp: 'random', gain: -10 },
      { instrument: 'synthbass', play: 'bass', pattern: ['x.x.x.x.x.x.x.x.', 'x-------x-------'] }, { instrument: 'organ', play: 'chords', pattern: '....x-------....', gain: -12 },
      { instrument: 'snare', play: 'drum', pattern: '....X.......X...' }, { instrument: 'clap', play: 'drum', pattern: '............x...' }, { instrument: 'openhat', play: 'drum', pattern: '..x...x...x...x.' },
    ],
  });
  it('reads chords in roman numerals', () => {
    expect(chordNotes('I', 60)).toEqual([60, 64, 67]);
    expect(chordNotes('vi', 60)).toEqual([69, 72, 76]);
    expect(chordNotes('V7', 60)).toEqual([67, 71, 74, 77]);
    expect(chordNotes('bVII', 60)).toEqual([70, 74, 77]);
    expect(chordNotes('ii°', 60)).toEqual([62, 65, 68]);
  });
  it('plays every part of a piece on its grid, in time', () => {
    const notes = pieceNotes(piece, 0, 8); // 4 bars at 120 bpm
    const flute = notes.filter((n) => n.kind === 'flute');
    expect(flute.map((n) => n.midi).slice(0, 4)).toEqual([62, 66, 69, 74]); // D major from D4 (tonic D3, an octave up)
    expect(flute[0]!.dur).toBeCloseTo(0.25); // a step held once: two 16ths at 120 bpm
    expect(notes.filter((n) => n.kind === 'snare').map((n) => n.t).slice(0, 2)).toEqual([0.5, 1.5]);
    expect(notes.filter((n) => n.kind === 'synthbass').length).toBe(8 + 2 + 8 + 2); // alternating bar patterns
    const [l] = renderMusic([{ start: 0, duration: 8, piece, gainDb: 0 }], 8);
    expect(Number.isFinite(integratedLoudness([l]))).toBe(true);
    let peak = 0, finite = true; for (const v of l) { finite &&= Number.isFinite(v); peak = Math.max(peak, Math.abs(v)); }
    expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.05);
  });
  it('refuses a piece written wrong', () => {
    const bad = (p: object) => { const r = Piece.safeParse({ name: 'x', bpm: 100, chords: ['I'], parts: [{ instrument: 'pad', play: 'chords' }], ...p }); return r.success ? [] : r.error.issues.map((i) => i.message); };
    expect(bad({ chords: ['H7'] }).join()).toContain('chiffres romains');
    expect(bad({ parts: [{ instrument: 'kick', play: 'chords' }] }).join()).toContain('play "drum"');
    expect(bad({ parts: [{ instrument: 'hat', play: 'drum', pattern: 'x.x' }] }).join()).toContain('16 pas');
    expect(bad({ parts: [{ instrument: 'flute', play: 'melody', notes: ['1 2 3'] }] }).join()).toContain('16 jetons');
  });
  it('synthesises a designed sound: layers, glides, filters, repeats', () => {
    const r = SoundRecipe.parse({ name: 'porte', layers: [
      { wave: 'noise', duration: 0.3, decay: 0.08, filter: { type: 'bandpass', freq: [400, 2000], q: 2 } },
      { wave: 'sine', freq: [300, 80], duration: 0.4, decay: 0.15, gain: -3 },
      { wave: 'square', freq: [1200], duration: 0.05, start: 0.1, repeat: { count: 3, every: 0.12 }, gain: -12, vibrato: { rate: 30, depth: 1 } },
    ] });
    const a = recipeSound(r), b = recipeSound(r);
    expect(a.length).toBe(Math.round(0.4 * SR));
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    let peak = 0, finite = true; for (const v of a) { finite &&= Number.isFinite(v); peak = Math.max(peak, Math.abs(v)); }
      expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.05);
    expect(soundFor('porte', { porte: r })).toEqual(a);
    expect(soundFor('pop', {})).toEqual(sound('pop')); // a built-in one, for older projects
    expect(soundFor('nope', { porte: r })).toBeNull();
  });
});

// full soundtracks are mixed here (seconds of CPU each): a budget that holds while the other test files run too
describe('mix', { timeout: 30_000 }, () => {
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
