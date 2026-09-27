// Small signal-processing tools, sample by sample (fast enough in JS for minutes of 48 kHz audio).
export const SR = 48000;
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-12, g));
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Biquad {
  private z1 = 0; private z2 = 0;
  constructor(public b0: number, public b1: number, public b2: number, public a1: number, public a2: number) {}
  /** take another filter's coefficients, keeping this one's state (sweeping a filter without clicks) */
  retune(o: Biquad) { this.b0 = o.b0; this.b1 = o.b1; this.b2 = o.b2; this.a1 = o.a1; this.a2 = o.a2; return this; }
  process(x: number) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  /** RBJ cookbook */
  static lowpass(f: number, q = 0.707, sr = SR) { const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al; return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0); }
  static highpass(f: number, q = 0.707, sr = SR) { const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al; return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0); }
  static bandpass(f: number, q = 1, sr = SR) { const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al; return new Biquad(al / a0, 0, -al / a0, (-2 * c) / a0, (1 - al) / a0); }
}

/** a mono buffer added into a stereo pair at a sample offset, with gain and equal-power pan */
export function addInto(L: Float32Array, R: Float32Array, src: Float32Array, at: number, gain = 1, pan = 0) {
  const a = ((pan + 1) * Math.PI) / 4, gl = Math.cos(a) * Math.SQRT2 * gain, gr = Math.sin(a) * Math.SQRT2 * gain;
  const i0 = Math.max(0, -at), i1 = Math.min(src.length, L.length - at);
  for (let i = i0; i < i1; i++) { const x = src[i]!; L[at + i]! += x * gl; R[at + i]! += x * gr; }
}

/** a simple stereo reverb (four combs and two all-passes per side, Freeverb-like) used as a send */
export function reverb(input: Float32Array, seconds = 1.6, damp = 0.35): [Float32Array, Float32Array] {
  const n = input.length, fb = Math.min(0.9, 0.7 + seconds * 0.08);
  const side = (spread: number) => {
    const combs = [1116, 1188, 1277, 1356].map((d) => ({ buf: new Float32Array(d + spread), i: 0, lp: 0 }));
    const aps = [556, 441].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = input[k]! * 0.015;
      let y = 0;
      for (let c = 0; c < 4; c++) {
        const cb = combs[c]!, o = cb.buf[cb.i]!;
        cb.lp = o * (1 - damp) + cb.lp * damp; cb.buf[cb.i] = x + cb.lp * fb;
        if (++cb.i === cb.buf.length) cb.i = 0;
        y += o;
      }
      for (let a = 0; a < 2; a++) {
        const ap = aps[a]!, o = ap.buf[ap.i]!, v = y + o * 0.5;
        ap.buf[ap.i] = v; if (++ap.i === ap.buf.length) ap.i = 0;
        y = o - v * 0.5;
      }
      out[k] = y;
    }
    return out;
  };
  return [side(0), side(23)];
}
