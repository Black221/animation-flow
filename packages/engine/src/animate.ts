// Sampling keys. Numbers (position, scale, rotation, opacity, zoom) are interpolated between the two keys that set
// them, with the easing of the later key; discrete values (pose, expression, facing, text) are held from their key.
// A property only interpolates between keys that actually set it, so a key can change the pose without moving.
import type { CameraKey, Ease, ElementKey, TimeRef } from '@af/schema';
import { ease, lerp } from './math';

type At = (ref: TimeRef | undefined, fallback?: number) => number;
type Keyed = { t: TimeRef; ease?: Ease | undefined } & Record<string, unknown>;

export function sampleNumber(keys: readonly Keyed[], times: readonly number[], prop: string, t: number, dflt: number): number {
  let i = -1, j = -1;
  for (let k = 0; k < keys.length; k++) {
    if (typeof keys[k]![prop] !== 'number') continue;
    if (times[k]! <= t) i = k; else { j = k; break; }
  }
  if (i < 0 && j < 0) return dflt;
  if (i < 0) return keys[j]![prop] as number;
  if (j < 0) return keys[i]![prop] as number;
  const a = keys[i]![prop] as number, b = keys[j]![prop] as number, span = times[j]! - times[i]!;
  return span <= 0 ? b : lerp(a, b, ease(keys[j]!.ease, (t - times[i]!) / span));
}

export function sampleDiscrete<T>(keys: readonly Keyed[], times: readonly number[], prop: string, t: number, dflt: T): T {
  let v: T | undefined, first: T | undefined;
  for (let k = 0; k < keys.length; k++) {
    const x = keys[k]![prop];
    if (x === undefined) continue;
    if (first === undefined) first = x as T;
    if (times[k]! <= t) v = x as T;
  }
  return v ?? first ?? dflt;
}

export interface ElementSample {
  x: number; y: number; scale: number; rotation: number; opacity: number;
  pose: string; expression: string; facing: 1 | -1; text: string | undefined;
}

export function sampleElement(keys: readonly ElementKey[], t: number, at: At): ElementSample {
  const K = keys as unknown as Keyed[], T = keys.map((k) => at(k.t));
  return {
    x: sampleNumber(K, T, 'x', t, 0),
    y: sampleNumber(K, T, 'y', t, 0),
    scale: sampleNumber(K, T, 'scale', t, 1),
    rotation: sampleNumber(K, T, 'rotation', t, 0),
    opacity: sampleNumber(K, T, 'opacity', t, 1),
    pose: sampleDiscrete(K, T, 'pose', t, 'idle'),
    expression: sampleDiscrete(K, T, 'expression', t, 'neutral'),
    facing: sampleDiscrete<1 | -1>(K, T, 'facing', t, 1),
    text: sampleDiscrete<string | undefined>(K, T, 'text', t, undefined),
  };
}

export interface CameraSample { x: number; y: number; zoom: number; rotation: number }

export function sampleCamera(keys: readonly CameraKey[], t: number, at: At, width: number, height: number): CameraSample {
  const K = keys as unknown as Keyed[], T = keys.map((k) => at(k.t));
  return {
    x: sampleNumber(K, T, 'x', t, width / 2),
    y: sampleNumber(K, T, 'y', t, height / 2),
    zoom: sampleNumber(K, T, 'zoom', t, 1),
    rotation: sampleNumber(K, T, 'rotation', t, 0),
  };
}
