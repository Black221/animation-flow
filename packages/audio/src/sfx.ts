// Sound effects, synthesized: no sample files, no licences, same sound on every machine (seeded noise). A project's
// sounds are designed for it (SoundRecipe in @af/schema: layers of a wave or noise, gliding, filtered, shaped); the
// built-in ones below serve older projects.
import { rng } from '@af/engine';
import type { SoundRecipe } from '@af/schema';
import { Biquad, SR } from './dsp';

type Make = (rand: () => number) => Float32Array;
const len = (s: number) => new Float32Array(Math.round(s * SR));
const noise = (rand: () => number) => rand() * 2 - 1;

/** a sine whose frequency glides from f0 to f1 (exponentially) over the buffer, with an envelope */
function glide(seconds: number, f0: number, f1: number, env: (k: number) => number, harm = 0): Float32Array {
  const out = len(seconds); let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const k = i / out.length, f = f0 * Math.pow(f1 / f0, k); ph += (2 * Math.PI * f) / SR;
    out[i] = (Math.sin(ph) + harm * Math.sin(2 * ph)) * env(k);
  }
  return out;
}
const expDecay = (rate: number) => (k: number) => Math.exp(-rate * k) * Math.min(1, k * 400);

const SOUNDS: Record<string, { label: string; make: Make }> = {
  pop: { label: 'pop (apparition)', make: () => glide(0.09, 950, 280, expDecay(6), 0.2) },
  click: { label: 'clic', make: (r) => { const o = len(0.012), hp = Biquad.highpass(2500); for (let i = 0; i < o.length; i++) o[i] = hp.process(noise(r)) * (1 - i / o.length); return o; } },
  whoosh: {
    label: 'whoosh (passage rapide)',
    make: (r) => {
      const o = len(0.7), bp = Biquad.bandpass(400, 1.2);
      for (let i = 0; i < o.length; i++) {
        const k = i / o.length;
        if (i % 64 === 0) bp.retune(Biquad.bandpass(300 + 2600 * Math.sin(Math.PI * k), 1.4));
        o[i] = bp.process(noise(r)) * Math.sin(Math.PI * k) ** 1.5 * 1.6;
      }
      return o;
    },
  },
  chime: {
    label: 'carillon',
    make: () => { const o = len(1.6); for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = (Math.sin(2 * Math.PI * 1318.5 * t) + 0.5 * Math.sin(2 * Math.PI * 1975.5 * t) + 0.25 * Math.sin(2 * Math.PI * 2637 * t)) * Math.exp(-3 * t) * 0.45 * Math.min(1, t * 800); } return o; },
  },
  sparkle: {
    label: 'étincelles',
    make: (r) => { const o = len(0.9); for (let k = 0; k < 7; k++) { const at = Math.round(r() * 0.6 * SR), f = 2200 + r() * 2200, d = glide(0.25, f, f * 1.01, expDecay(9)); for (let i = 0; i < d.length && at + i < o.length; i++) o[at + i]! += d[i]! * 0.35; } return o; },
  },
  boing: { label: 'boing (surprise)', make: () => { const o = len(0.5); let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR, f = 180 * (1 + 0.5 * Math.exp(-6 * t) * Math.sin(2 * Math.PI * 14 * t)); ph += (2 * Math.PI * f) / SR; o[i] = Math.sin(ph) * Math.exp(-5 * t) * Math.min(1, t * 500) * 0.9; } return o; } },
  thud: { label: 'choc sourd', make: (r) => { const g = glide(0.3, 110, 45, expDecay(8)), lp = Biquad.lowpass(900); for (let i = 0; i < g.length; i++) g[i]! += lp.process(noise(r)) * Math.exp(-40 * (i / SR)) * 0.6; return g; } },
  stamp: {
    label: 'tampon',
    make: (r) => { const o = glide(0.35, 140, 60, expDecay(10)), bp = Biquad.bandpass(1800, 0.8); for (let i = 0; i < o.length; i++) o[i] = o[i]! * 0.8 + bp.process(noise(r)) * Math.exp(-25 * (i / SR)) * 0.9; return o; },
  },
  lock: {
    label: 'verrou',
    make: (r) => { const o = len(0.4); for (const [at, f] of [[0, 2400], [0.12, 1800]] as const) { const s = Math.round(at * SR); for (let i = 0; i < 0.08 * SR; i++) { const t = i / SR; o[s + i]! += (Math.sin(2 * Math.PI * f * t) * 0.6 + noise(r) * 0.4) * Math.exp(-60 * t); } } return o; },
  },
  bip: { label: 'bip (robot)', make: () => { const o = len(0.14); for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = (Math.sin(2 * Math.PI * 880 * t) > 0 ? 0.35 : -0.35) * Math.min(1, t * 300, (0.14 - t) * 300); } const lp = Biquad.lowpass(3000); for (let i = 0; i < o.length; i++) o[i] = lp.process(o[i]!); return o; } },
  rise: { label: 'montée', make: () => glide(0.9, 300, 1200, (k) => Math.sin(Math.PI * k) * (0.7 + 0.3 * Math.sin(k * 60)) * 0.6, 0.15) },
  fall: { label: 'descente', make: () => glide(0.8, 900, 200, (k) => Math.sin(Math.PI * k) * 0.6, 0.15) },
};

export const SOUND_KINDS = Object.keys(SOUNDS);
export const soundCatalog = Object.entries(SOUNDS).map(([kind, s]) => ({ kind, label: s.label }));

const cache = new Map<string, Float32Array>();
/** the mono sound of a kind (seeded: the same kind always sounds the same); null for an unknown kind */
export function sound(kind: string, seed = 0): Float32Array | null {
  const s = SOUNDS[kind];
  if (!s) return null;
  const key = `${kind}:${seed}`;
  let b = cache.get(key);
  if (!b) { b = s.make(rng(key)); cache.set(key, b); if (cache.size > 64) cache.delete(cache.keys().next().value!); }
  return b;
}

/** a sound designed for the project: its layers mixed, mono */
export function recipeSound(r: SoundRecipe, seed = 0): Float32Array {
  const rand = rng(`recipe:${r.name}:${seed}`);
  const end = Math.max(...r.layers.map((l) => l.start + l.duration + (l.repeat ? (l.repeat.count - 1) * l.repeat.every : 0)));
  const out = new Float32Array(Math.max(1, Math.round(Math.min(8, end) * SR)));
  for (const l of r.layers) {
    const f0 = l.freq[0], f1 = l.freq[1] ?? f0, n = Math.round(l.duration * SR), g = Math.pow(10, l.gain / 20) * 0.5;
    for (let rep = 0; rep < (l.repeat?.count ?? 1); rep++) {
      const s0 = Math.round((l.start + rep * (l.repeat?.every ?? 0)) * SR);
      const filt = l.filter ? (l.filter.type === 'lowpass' ? Biquad.lowpass : l.filter.type === 'highpass' ? Biquad.highpass : Biquad.bandpass)(l.filter.freq[0], l.filter.q) : null;
      let ph = 0;
      for (let i = 0; i < n && s0 + i < out.length; i++) {
        const k = i / Math.max(1, n), t = i / SR;
        const vib = l.vibrato ? Math.pow(2, (l.vibrato.depth / 12) * Math.sin(2 * Math.PI * l.vibrato.rate * t)) : 1;
        const f = f0 * Math.pow(f1 / f0, k) * vib;
        ph += f / SR; ph -= Math.floor(ph);
        let x: number;
        switch (l.wave) {
          case 'sine': x = Math.sin(2 * Math.PI * ph); break;
          case 'triangle': x = 1 - 4 * Math.abs(ph - 0.5); break;
          case 'square': x = ph < 0.5 ? 0.7 : -0.7; break;
          case 'saw': x = (2 * ph - 1) * 0.7; break;
          default: x = rand() * 2 - 1;
        }
        if (filt && l.filter) {
          // sweep the filter along the layer (retuned every 64 samples, without clicks)
          if (l.filter.freq[1] && i % 64 === 0) { const ff = l.filter.freq[0] * Math.pow(l.filter.freq[1] / l.filter.freq[0], k); filt.retune((l.filter.type === 'lowpass' ? Biquad.lowpass : l.filter.type === 'highpass' ? Biquad.highpass : Biquad.bandpass)(Math.min(20000, ff), l.filter.q)); }
          x = filt.process(x);
        }
        const env = Math.min(1, t / Math.max(1e-4, l.attack)) * (t < l.attack ? 1 : Math.exp(-(t - l.attack) / l.decay)) * Math.min(1, (n - i) / (0.004 * SR));
        out[s0 + i]! += x * env * g;
      }
    }
  }
  return out;
}

const recipeCache = new Map<string, Float32Array>();
/** the sound of a kind: one designed for the project, else a built-in one; null if neither exists */
export function soundFor(kind: string, sounds: Record<string, SoundRecipe> = {}, seed = 0): Float32Array | null {
  const r = sounds[kind];
  if (!r) return sound(kind, seed);
  const key = `${JSON.stringify(r)}:${seed}`;
  let b = recipeCache.get(key);
  if (!b) { b = recipeSound(r, seed); recipeCache.set(key, b); if (recipeCache.size > 64) recipeCache.delete(recipeCache.keys().next().value!); }
  return b;
}
