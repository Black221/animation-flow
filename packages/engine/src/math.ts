// Small pure helpers. Everything the engine computes is a function of the project and the time only, so frames can be
// rendered in any order, in parallel, in the browser or on a server, and always come out the same.
import type { Ease } from '@af/schema';

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 → 1 as t goes from a to b (clamped) */
export const seg = (t: number, a: number, b: number) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export const EASES: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  backOut: (k) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  step: (k) => (k >= 1 ? 1 : 0),
};
export const ease = (name: Ease | undefined, k: number) => EASES[name ?? 'inOut'](clamp(k));

/** FNV-1a: a stable 32-bit seed from any string (element ids, primitive ids) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: a seeded generator in [0, 1) */
export function rng(seed: number | string): () => number {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
