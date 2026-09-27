// Sound effects, synthesized: no sample files, no licences, same sound on every machine (seeded noise).
import { rng } from '@af/engine';
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
