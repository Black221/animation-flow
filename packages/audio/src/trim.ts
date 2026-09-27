// Recorded lines often start and end with silence: remove it (keeping a short margin) so each line's measured
// duration is the time it actually speaks.
import { SR } from './dsp';

export function trimSilence(x: Float32Array, thresholdDb = -45, marginS = 0.06): Float32Array {
  const th = Math.pow(10, thresholdDb / 20), win = Math.round(0.01 * SR);
  const loud = (i: number) => { let p = 0; for (let k = i; k < Math.min(x.length, i + win); k++) p = Math.max(p, Math.abs(x[k]!)); return p > th; };
  let a = 0, b = x.length;
  while (a < x.length && !loud(a)) a += win;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  if (a >= b) return new Float32Array(0);
  const m = Math.round(marginS * SR);
  return x.slice(Math.max(0, a - m), Math.min(x.length, b + m));
}
