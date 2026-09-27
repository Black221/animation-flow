// Music, played from a score: no recordings, no licences, reproducible (seeded). A piece (see Piece in @af/schema)
// is a chord progression and parts on a 16-step grid; the model composes one per kind of scene, and this plays it
// with simple synthesised instruments that sit under a voice (the mixer ducks them further while someone speaks).
// The built-in moods are pieces too, written here: older projects use them, and so does a film whose score could
// not be composed. Scenes cross-fade into each other.
import { Piece as PieceSchema, type Part, type Piece } from '@af/schema';
import { rng } from '@af/engine';
import { Biquad, midiToHz, reverb, SR } from './dsp';

type PieceIn = Parameters<typeof PieceSchema.parse>[0];
const preset = (p: PieceIn): Piece => PieceSchema.parse(p);
/** the built-in moods, in the score format */
export const MOODS: Record<string, Piece> = {
  calm: preset({ name: 'Calme', bpm: 76, key: 'A', mode: 'major', chords: ['I', 'vi', 'IV', 'V'], reverb: 0.5, parts: [
    { instrument: 'pad', play: 'chords', pattern: 'x---------------', gain: -3 },
    { instrument: 'pluck', play: 'arp', pattern: 'x...x...x...x...', octave: 1, gain: -4, pan: 0.3 },
    { instrument: 'bass', play: 'bass', pattern: 'x---------------' },
  ] }),
  curious: preset({ name: 'Curieux', bpm: 100, key: 'A', mode: 'dorian', chords: ['i', 'IV', 'i', 'v'], parts: [
    { instrument: 'pad', play: 'chords', pattern: 'x---------------', gain: -6 },
    { instrument: 'pluck', play: 'arp', pattern: 'x.x.x.x.x.x.x.x.', arp: 'updown', octave: 1, gain: -5 },
    { instrument: 'bass', play: 'bass', pattern: 'x.......x.......' },
    { instrument: 'kick', play: 'drum', pattern: 'x.......x.......', gain: -6 }, { instrument: 'hat', play: 'drum', pattern: '..x...x...x...x.', gain: -10 },
  ] }),
  playful: preset({ name: 'Enjoué', bpm: 116, key: 'A', mode: 'major', chords: ['I', 'V', 'vi', 'IV'], parts: [
    { instrument: 'marimba', play: 'arp', pattern: 'x.x.x.x.x.x.x.x.', octave: 1, gain: -4 },
    { instrument: 'bells', play: 'melody', notes: ['5 - . 3 . 5 . 8 - - . 6 . 5 . .', '3 - . 2 . 3 . 5 - - . . . . . .'], octave: 1, gain: -10 },
    { instrument: 'bass', play: 'bass', pattern: 'x.......x.......' },
    { instrument: 'kick', play: 'drum', pattern: 'x.......x.......', gain: -6 }, { instrument: 'shaker', play: 'drum', pattern: '.x.x.x.x.x.x.x.x', gain: -12 },
  ] }),
  epic: preset({ name: 'Épique', bpm: 92, key: 'A', mode: 'minor', chords: ['i', 'bVI', 'bIII', 'bVII'], reverb: 0.6, parts: [
    { instrument: 'strings', play: 'chords', pattern: 'x---------------', gain: -2 },
    { instrument: 'synthbass', play: 'bass', pattern: 'x.x.x.x.x.x.x.x.', gain: -3 },
    { instrument: 'kick', play: 'drum', pattern: 'x...x...x...x...', gain: -4 }, { instrument: 'tom', play: 'drum', pattern: '..............xx', gain: -8 },
  ] }),
  night: preset({ name: 'Nuit', bpm: 64, key: 'A', mode: 'minor', chords: ['i', 'bVI', 'iv', 'v'], reverb: 0.7, parts: [
    { instrument: 'pad', play: 'chords', pattern: 'x---------------', gain: -2 },
    { instrument: 'bells', play: 'melody', notes: ['5 - - - . . . . 3 - - - . . . .', '8 - - - . . . . 7 - - - . . . .'], octave: 1, gain: -12 },
    { instrument: 'bass', play: 'bass', pattern: 'x---------------', gain: -3 },
  ] }),
  tense: preset({ name: 'Tendu', bpm: 104, key: 'A', mode: 'minor', chords: ['i', 'bII', 'i', 'bVII'], parts: [
    { instrument: 'strings', play: 'chords', pattern: 'x-------x-------', gain: -5 },
    { instrument: 'synthbass', play: 'bass', pattern: 'x.x.x.x.x.x.x.x.', gain: -3 },
    { instrument: 'kick', play: 'drum', pattern: 'x.......x.......', gain: -5 }, { instrument: 'hat', play: 'drum', pattern: 'xxxxxxxxxxxxxxxx', gain: -14 },
  ] }),
};
export const MOOD_NAMES = Object.keys(MOODS);

// ---------- harmony ----------
const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const MODES: Record<Piece['mode'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9, 12, 14], blues: [0, 3, 5, 6, 7, 10, 12],
};
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/** the tonic of a piece, around the middle of the keyboard (C3 … B3) */
const tonic = (p: Piece) => 48 + (PC[p.key] ?? 9);

/** the notes (MIDI) of a chord written in roman numerals over the key's major scale */
export function chordNotes(symbol: string, root: number): number[] {
  const m = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|dim|\+|aug|maj7|m7|7|sus2|sus4|6|9)?$/.exec(symbol);
  if (!m) return [root, root + 4, root + 7];
  const degree = NUMERALS.indexOf(m[2]!.toUpperCase()), minor = m[2] === m[2]!.toLowerCase();
  const r = root + MODES.major[degree]! + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0), q = m[3];
  let tones = minor ? [0, 3, 7] : [0, 4, 7];
  if (q === '°' || q === 'dim') tones = [0, 3, 6];
  else if (q === '+' || q === 'aug') tones = [0, 4, 8];
  else if (q === 'sus2') tones = [0, 2, 7];
  else if (q === 'sus4') tones = [0, 5, 7];
  else if (q === '7') tones = [...tones, 10];
  else if (q === 'maj7') tones = [...tones, 11];
  else if (q === 'm7') tones = [0, 3, 7, 10];
  else if (q === '6') tones = [...tones, 9];
  else if (q === '9') tones = [...tones, 10, 14];
  return tones.map((t) => r + t);
}

/** a melody token → MIDI (null for a rest or a hold) */
function melodyNote(tok: string, p: Piece): number | null {
  const m = /^([#b]?)(\d{1,2})([',]*)$/.exec(tok);
  if (!m) return null;
  const n = Math.max(1, Number(m[2])) - 1, scale = MODES[p.mode];
  let pitch = tonic(p) + scale[n % 7]! + 12 * Math.floor(n / 7) + (m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0);
  for (const c of m[3]!) pitch += c === "'" ? 12 : -12;
  return pitch;
}

// ---------- instruments ----------
type Kind = Part['instrument'];
export interface Note { t: number; dur: number; midi: number; kind: Kind; vel: number; pan: number }
const WET: Partial<Record<Kind, number>> = { pad: 0.8, strings: 0.8, bells: 1, flute: 0.6, piano: 0.5, pluck: 0.4, marimba: 0.4, lead: 0.4, organ: 0.4, bass: 0.1, synthbass: 0.1, kick: 0.05, snare: 0.3, clap: 0.4, tom: 0.3 };
const TAIL: Partial<Record<Kind, number>> = { pad: 0.6, strings: 0.4, bells: 2, piano: 1.2, pluck: 0.4, marimba: 0.3, flute: 0.15, lead: 0.1, organ: 0.08, bass: 0.08, synthbass: 0.08 };

/** one note, mono, from its instrument (drums ignore the pitch) */
function voice(n: Note, rand: () => number): Float32Array {
  const len = Math.round(Math.max(0.02, n.dur + (TAIL[n.kind] ?? 0)) * SR), out = new Float32Array(len), f = midiToHz(n.midi), w = (2 * Math.PI * f) / SR;
  const hold = n.dur, rel = TAIL[n.kind] ?? 0.05;
  const gate = (t: number, att: number) => Math.min(1, t / Math.max(1e-4, att)) * (t < hold ? 1 : Math.max(0, 1 - (t - hold) / Math.max(1e-3, rel)));
  let ph = 0, ph2 = 0;
  switch (n.kind) {
    case 'pad': case 'strings': {
      const lp = Biquad.lowpass(n.kind === 'pad' ? 1500 : 2600, 0.6), att = n.kind === 'pad' ? 0.35 : 0.15;
      for (let i = 0; i < len; i++) {
        const t = i / SR, vib = n.kind === 'strings' ? 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) : 1;
        ph += (f * 0.996 * vib) / SR; ph2 += (f * 1.004 * vib) / SR; ph -= Math.floor(ph); ph2 -= Math.floor(ph2);
        out[i] = lp.process(ph + ph2 - 1) * gate(t, att) * 0.12;
      }
      break;
    }
    case 'organ': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.15 * Math.sin(4 * ph)) * gate(t, 0.01) * 0.09; } break;
    case 'piano': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = (Math.sin(ph) + 0.45 * Math.sin(2 * ph) * Math.exp(-4 * t) + 0.2 * Math.sin(3 * ph) * Math.exp(-6 * t)) * Math.exp(-2.2 * t) * gate(t, 0.004) * 0.18; } break;
    case 'pluck': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * Math.exp(-9 * t) * Math.min(1, t * 900) * 0.16; } break;
    case 'marimba': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = (Math.sin(ph) + 0.25 * Math.sin(4 * ph) * Math.exp(-20 * t)) * Math.exp(-7 * t) * Math.min(1, t * 1200) * 0.2; } break;
    case 'bells': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = (Math.sin(ph) + 0.4 * Math.sin(2.76 * ph) + 0.2 * Math.sin(5.4 * ph)) * Math.exp(-2.4 * t) * Math.min(1, t * 1500) * 0.1; } break;
    case 'flute': { const bp = Biquad.bandpass(Math.min(18000, f * 2), 2); for (let i = 0; i < len; i++) { const t = i / SR; ph += w * (1 + 0.006 * Math.sin(2 * Math.PI * 5 * t)); out[i] = (Math.sin(ph) * 0.9 + bp.process(rand() * 2 - 1) * 0.15) * gate(t, 0.06) * 0.14; } break; }
    case 'lead': { const lp = Biquad.lowpass(2400, 0.9); for (let i = 0; i < len; i++) { const t = i / SR; ph += f / SR; ph -= Math.floor(ph); out[i] = lp.process(ph < 0.5 ? 1 : -1) * gate(t, 0.01) * 0.07; } break; }
    case 'bass': for (let i = 0; i < len; i++) { const t = i / SR; ph += w; out[i] = Math.tanh(1.6 * (Math.sin(ph) + 0.25 * Math.sin(2 * ph))) * gate(t, 0.005) * 0.2; } break;
    case 'synthbass': { const lp = Biquad.lowpass(700, 1.1); for (let i = 0; i < len; i++) { const t = i / SR; ph += f / SR; ph -= Math.floor(ph); out[i] = lp.process(2 * ph - 1) * gate(t, 0.004) * 0.22; } break; }
    case 'kick': for (let i = 0; i < Math.min(len, 0.3 * SR); i++) { const t = i / SR; ph += (2 * Math.PI * (45 + 90 * Math.exp(-30 * t))) / SR; out[i] = Math.sin(ph) * Math.exp(-14 * t) * 0.5; } break;
    case 'tom': for (let i = 0; i < Math.min(len, 0.4 * SR); i++) { const t = i / SR; ph += (2 * Math.PI * (90 + 60 * Math.exp(-12 * t))) / SR; out[i] = Math.sin(ph) * Math.exp(-9 * t) * 0.4; } break;
    case 'snare': { const bp = Biquad.bandpass(1800, 0.7); for (let i = 0; i < Math.min(len, 0.25 * SR); i++) { const t = i / SR; ph += (2 * Math.PI * 190) / SR; out[i] = (bp.process(rand() * 2 - 1) * 0.8 + Math.sin(ph) * 0.3) * Math.exp(-18 * t) * 0.4; } break; }
    case 'clap': { const bp = Biquad.bandpass(1200, 1); for (let i = 0; i < Math.min(len, 0.2 * SR); i++) { const t = i / SR, burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.4 : 1) : 1; out[i] = bp.process(rand() * 2 - 1) * Math.exp(-25 * t) * burst * 0.5; } break; }
    case 'shaker': { const hp = Biquad.highpass(5000); for (let i = 0; i < Math.min(len, 0.08 * SR); i++) { const t = i / SR; out[i] = hp.process(rand() * 2 - 1) * Math.min(1, t * 300) * Math.exp(-50 * t) * 0.2; } break; }
    case 'hat': case 'openhat': { const hp = Biquad.highpass(7000), k = n.kind === 'hat' ? 80 : 12; for (let i = 0; i < Math.min(len, (n.kind === 'hat' ? 0.05 : 0.35) * SR); i++) { const t = i / SR; out[i] = hp.process(rand() * 2 - 1) * Math.exp(-k * t) * 0.25; } break; }
  }
  return out;
}

// ---------- a piece → notes ----------
const stepsOf = (pat: string | string[] | undefined, bar: number, dflt: string) => { const p = pat ?? dflt; return Array.isArray(p) ? p[bar % p.length]! : p; };

/** the notes a piece plays from `start` for `duration` seconds (bars loop) */
export function pieceNotes(p: Piece, start: number, duration: number, seed = 1): Note[] {
  const rand = rng(`${seed}:notes`), beat = 60 / p.bpm, step = beat / 4, barLen = beat * 4, bars = Math.ceil(duration / barLen), out: Note[] = [];
  const at = (bar: number, s: number) => start + bar * barLen + s * step + (s % 2 ? p.swing * step : 0);
  for (const part of p.parts) {
    const vel0 = Math.pow(10, part.gain / 20);
    for (let b = 0; b < bars; b++) {
      const chord = chordNotes(p.chords[b % p.chords.length]!, tonic(p));
      if (part.play === 'melody') {
        const toks = part.notes![b % part.notes!.length]!.trim().split(/\s+/);
        for (let s = 0; s < 16; s++) {
          const m = melodyNote(toks[s]!, p);
          if (m == null) continue;
          let len = 1; while (s + len < 16 && toks[s + len] === '-') len++;
          out.push({ t: at(b, s), dur: len * step, midi: m + 12 * part.octave, kind: part.instrument, vel: vel0 * 0.8, pan: part.pan });
        }
        continue;
      }
      const pat = stepsOf(part.pattern, b, part.play === 'drum' ? 'x...x...x...x...' : 'x---------------');
      let arpI = 0;
      for (let s = 0; s < 16; s++) {
        const c = pat[s]!;
        if (c !== 'x' && c !== 'X') continue;
        let len = 1; while (s + len < 16 && pat[s + len] === '-') len++;
        const vel = vel0 * (c === 'X' ? 1 : part.play === 'drum' ? 0.7 : 0.85), t = at(b, s), dur = len * step;
        if (part.play === 'drum') out.push({ t, dur, midi: 60, kind: part.instrument, vel, pan: part.pan });
        else if (part.play === 'bass') out.push({ t, dur, midi: chord[0]! - 24 + 12 * part.octave, kind: part.instrument, vel, pan: part.pan });
        else if (part.play === 'chords') chord.forEach((m, k) => out.push({ t, dur, midi: m - 12 + 12 * part.octave, kind: part.instrument, vel: vel * 0.7, pan: part.pan + (k - 1) * 0.15 }));
        else {
          const tones = [...chord, chord[0]! + 12], n = tones.length;
          const k = part.arp === 'down' ? n - 1 - (arpI % n) : part.arp === 'updown' ? (Math.floor(arpI / (n - 1)) % 2 ? n - 1 - (arpI % (n - 1)) : arpI % (n - 1)) : part.arp === 'random' ? Math.floor(rand() * n) : arpI % n;
          out.push({ t, dur, midi: tones[k]! + 12 * part.octave, kind: part.instrument, vel, pan: part.pan });
          arpI++;
        }
      }
    }
  }
  return out.filter((n) => n.t < start + duration);
}

export interface Section { start: number; duration: number; piece: Piece | null; gainDb: number }
/** a scene's music: a piece of the project's score, a built-in mood, or nothing */
export const pieceFor = (mood: string, score: Record<string, Piece> = {}): Piece | null => score[mood] ?? MOODS[mood] ?? null;

/** stereo music for the given sections over `total` seconds */
export function renderMusic(sections: Section[], total: number, seed = 1): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(total * SR)), L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n);
  const XF = 0.8; // cross-fade between scenes (s)
  sections.forEach((sec, si) => {
    const p = sec.piece;
    if (!p || sec.duration <= 0) return;
    const rand = rng(`${seed}:${si}:${p.name}`), gain = Math.pow(10, sec.gainDb / 20);
    const t0 = Math.max(0, sec.start - XF / 2), t1 = Math.min(total, sec.start + sec.duration + XF / 2);
    const fade = (t: number) => Math.max(0, Math.min(1, (t - t0) / XF, (t1 - t) / XF));
    for (const note of pieceNotes(p, sec.start, sec.duration + XF / 2, seed + si)) {
      const buf = voice(note, rand), s = Math.round(note.t * SR), a = ((Math.max(-1, Math.min(1, note.pan)) + 1) * Math.PI) / 4;
      const g = note.vel * gain, gl = Math.cos(a) * Math.SQRT2 * g, gr = Math.sin(a) * Math.SQRT2 * g, wet = (WET[note.kind] ?? 0.3) * (0.4 + p.reverb) * g;
      const k0 = Math.max(0, Math.round(t0 * SR) - s), k1 = Math.min(buf.length, Math.round(t1 * SR) - s, n - s);
      for (let k = Math.max(k0, -s); k < k1; k++) {
        const i = s + k, x = buf[k]! * fade(i / SR);
        L[i]! += x * gl; R[i]! += x * gr; send[i]! += x * wet;
      }
    }
  });
  const [wl, wr] = reverb(send, 1.8);
  for (let i = 0; i < n; i++) { L[i]! += wl[i]!; R[i]! += wr[i]!; }
  return [L, R];
}
