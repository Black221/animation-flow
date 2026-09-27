// Background music, generated from each scene's mood: no recordings, no licences, reproducible (seeded).
// A mood sets the tempo, the mode and the instruments; every scene gets four-bar chord loops in one key for the
// whole film, and scenes cross-fade into each other. Instruments are simple on purpose (pad, pluck, bass, bells,
// soft kick and hat) and sit under the voice: the mixer ducks them further while someone speaks.
import type { Music } from '@af/schema';
import { rng } from '@af/engine';
import { Biquad, midiToHz, reverb, SR } from './dsp';

export type Mood = Music['mood'];
interface MoodSpec { bpm: number; mode: number[]; chords: number[][]; pad: number; pluck: 'quarter' | 'eighth' | 'arp' | null; bass: 'beats' | 'pulse' | 'root' | null; drums: 'soft' | 'pulse' | null; bells: boolean; bright: number }

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
// chords as scale degrees (0-based) of their root; each chord is a triad on that degree
const MOODS: Record<Exclude<Mood, 'none'>, MoodSpec> = {
  calm: { bpm: 76, mode: MAJOR, chords: [[0], [5], [3], [4]], pad: 0.5, pluck: 'quarter', bass: 'root', drums: null, bells: false, bright: 1400 },
  curious: { bpm: 100, mode: DORIAN, chords: [[0], [3], [0], [4]], pad: 0.35, pluck: 'arp', bass: 'beats', drums: 'soft', bells: false, bright: 2200 },
  playful: { bpm: 116, mode: MAJOR, chords: [[0], [4], [5], [3]], pad: 0.3, pluck: 'eighth', bass: 'beats', drums: 'soft', bells: true, bright: 2600 },
  epic: { bpm: 92, mode: MINOR, chords: [[0], [5], [2], [6]], pad: 0.7, pluck: 'eighth', bass: 'pulse', drums: 'pulse', bells: false, bright: 1800 },
  night: { bpm: 64, mode: MINOR, chords: [[0], [5], [3], [4]], pad: 0.55, pluck: null, bass: 'root', drums: null, bells: true, bright: 1000 },
  tense: { bpm: 104, mode: MINOR, chords: [[0], [1], [0], [6]], pad: 0.4, pluck: null, bass: 'pulse', drums: 'pulse', bells: false, bright: 1200 },
};
export const MOOD_NAMES = Object.keys(MOODS) as Exclude<Mood, 'none'>[];

const KEY = 57; // A3: the tonic of the whole film
const note = (spec: MoodSpec, degree: number, octave = 0) => {
  const d = ((degree % 7) + 7) % 7, o = Math.floor(degree / 7);
  return KEY + spec.mode[d]! + 12 * (o + octave);
};
const triad = (spec: MoodSpec, root: number) => [note(spec, root), note(spec, root + 2), note(spec, root + 4)];

export interface Section { start: number; duration: number; mood: Mood; gainDb: number }

/** stereo music for the given sections over `total` seconds */
export function renderMusic(sections: Section[], total: number, seed = 1): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(total * SR)), L = new Float32Array(n), R = new Float32Array(n), send = new Float32Array(n);
  const XF = 0.8; // cross-fade between scenes (s)
  sections.forEach((sec, si) => {
    if (sec.mood === 'none' || sec.duration <= 0) return;
    const spec = MOODS[sec.mood], rand = rng(`${seed}:${si}:${sec.mood}`), gain = Math.pow(10, sec.gainDb / 20);
    const beat = 60 / spec.bpm, bar = beat * 4;
    const t0 = Math.max(0, sec.start - XF / 2), t1 = Math.min(total, sec.start + sec.duration + XF / 2);
    const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
    const fade = (t: number) => Math.min(1, (t - t0) / XF, (t1 - t) / XF);
    const put = (i: number, l: number, r: number, wet: number) => { if (i < i0 || i >= i1) return; const f = Math.max(0, fade(i / SR)) * gain; L[i]! += l * f; R[i]! += r * f; send[i]! += (l + r) * 0.5 * wet * f; };

    // pad: detuned saws through a low-pass, one chord per bar, slow attack (chord worked out once per bar)
    if (spec.pad > 0) {
      const lpL = Biquad.lowpass(spec.bright, 0.6), lpR = Biquad.lowpass(spec.bright, 0.6);
      const ph = new Float64Array(12), inc = new Float64Array(12), amp = 0.05 * spec.pad * 0.9;
      const barLen = Math.round(bar * SR), s0 = Math.round(sec.start * SR);
      for (let i = i0; i < i1;) {
        const b = Math.max(0, Math.floor((i - s0) / barLen)), barStart = s0 + b * barLen, end = Math.min(i1, barStart + barLen);
        const chord = triad(spec, spec.chords[b % spec.chords.length]![0]!);
        for (let k = 0; k < 3; k++) {
          const f = midiToHz(chord[k]! - 12) / SR;
          inc[k * 4] = f * 0.996; inc[k * 4 + 1] = f / 0.996; inc[k * 4 + 2] = f * 1.004; inc[k * 4 + 3] = f / 1.004;
        }
        for (; i < end; i++) {
          let l = 0, r = 0;
          for (let v = 0; v < 12; v += 2) {
            let p0 = ph[v]! + inc[v]!; if (p0 >= 1) p0 -= 1; ph[v] = p0; l += p0;
            let p1 = ph[v + 1]! + inc[v + 1]!; if (p1 >= 1) p1 -= 1; ph[v + 1] = p1; r += p1;
          }
          const env = Math.min(1, Math.max(0, i - barStart) / (0.35 * SR) + (b > 0 ? 0.6 : 0));
          put(i, lpL.process(l * 2 - 6) * amp * env, lpR.process(r * 2 - 6) * amp * env, 0.8);
        }
      }
    }
    // events on the beat grid: plucks, bass, bells, drums
    const events: { t: number; f: number; kind: 'pluck' | 'bass' | 'bell' | 'kick' | 'hat'; pan: number; vel: number }[] = [];
    for (let t = sec.start; t < sec.start + sec.duration; t += beat / 2) {
      const rel = t - sec.start, b = Math.floor(rel / bar + 1e-6), step = Math.round((rel - b * bar) / (beat / 2)), chord = triad(spec, spec.chords[b % spec.chords.length]![0]!);
      const on = step % 2 === 0;
      if (spec.pluck === 'quarter' && on) events.push({ t, f: midiToHz(chord[(step / 2) % 3]! + 12), kind: 'pluck', pan: ((step / 2) % 2 ? 0.35 : -0.35), vel: 0.5 });
      if (spec.pluck === 'eighth') events.push({ t, f: midiToHz(chord[step % 3]! + 12), kind: 'pluck', pan: step % 2 ? 0.4 : -0.4, vel: on ? 0.5 : 0.32 });
      if (spec.pluck === 'arp') { const seq = [0, 1, 2, 1, 0, 2, 1, 2]; events.push({ t, f: midiToHz(chord[seq[step % 8]!]! + (step % 4 === 3 ? 24 : 12)), kind: 'pluck', pan: Math.sin(step) * 0.5, vel: 0.42 }); }
      if (spec.bass === 'root' && step === 0) events.push({ t, f: midiToHz(chord[0]! - 24), kind: 'bass', pan: 0, vel: 0.6 });
      if (spec.bass === 'beats' && (step === 0 || step === 4)) events.push({ t, f: midiToHz(chord[0]! - 24), kind: 'bass', pan: 0, vel: 0.6 });
      if (spec.bass === 'pulse') events.push({ t, f: midiToHz(chord[0]! - 24), kind: 'bass', pan: 0, vel: on ? 0.55 : 0.4 });
      if (spec.bells && on && rand() < 0.28) events.push({ t: t + rand() * 0.05, f: midiToHz(chord[Math.floor(rand() * 3)]! + 24), kind: 'bell', pan: rand() * 1.4 - 0.7, vel: 0.35 });
      if (spec.drums === 'soft') { if (step === 0 || step === 4) events.push({ t, f: 0, kind: 'kick', pan: 0, vel: 0.5 }); if (!on) events.push({ t, f: 0, kind: 'hat', pan: 0.2, vel: 0.25 }); }
      if (spec.drums === 'pulse') { if (on) events.push({ t, f: 0, kind: 'kick', pan: 0, vel: step % 4 === 0 ? 0.6 : 0.35 }); events.push({ t, f: 0, kind: 'hat', pan: -0.2, vel: on ? 0.18 : 0.28 }); }
    }
    for (const e of events) {
      const s = Math.round(e.t * SR), a = ((e.pan + 1) * Math.PI) / 4, gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2;
      const dur = e.kind === 'bell' ? 2.2 : e.kind === 'bass' ? beat * 0.9 : e.kind === 'pluck' ? 0.45 : e.kind === 'kick' ? 0.25 : 0.05;
      const m = Math.round(dur * SR), hp = e.kind === 'hat' ? Biquad.highpass(7000) : null;
      let ph = 0;
      for (let k = 0; k < m; k++) {
        const t = k / SR; let x: number;
        switch (e.kind) {
          case 'pluck': ph += (2 * Math.PI * e.f) / SR; x = (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * Math.exp(-9 * t) * Math.min(1, t * 900) * 0.16; break;
          case 'bass': ph += (2 * Math.PI * e.f) / SR; x = Math.tanh(1.6 * (Math.sin(ph) + 0.25 * Math.sin(2 * ph))) * Math.min(1, t * 200, (dur - t) * 30) * 0.2; break;
          case 'bell': ph += (2 * Math.PI * e.f) / SR; x = (Math.sin(ph) + 0.4 * Math.sin(2.76 * ph) + 0.2 * Math.sin(5.4 * ph)) * Math.exp(-2.4 * t) * Math.min(1, t * 1500) * 0.1; break;
          case 'kick': ph += (2 * Math.PI * (45 + 90 * Math.exp(-30 * t))) / SR; x = Math.sin(ph) * Math.exp(-14 * t) * 0.5; break;
          default: x = hp!.process(rand() * 2 - 1) * Math.exp(-80 * t) * 0.25;
        }
        put(s + k, x * gl * e.vel, x * gr * e.vel, e.kind === 'kick' ? 0.05 : e.kind === 'bell' ? 1 : 0.4);
      }
    }
  });
  const [wl, wr] = reverb(send, 1.8);
  for (let i = 0; i < n; i++) { L[i]! += wl[i]!; R[i]! += wr[i]!; }
  return [L, R];
}
