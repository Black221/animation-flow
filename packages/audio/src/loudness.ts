// Loudness as broadcasters measure it (ITU-R BS.1770-4 / EBU R128): K-weighting, 400 ms blocks with 75 % overlap,
// absolute gate at −70 LUFS, relative gate 10 LU below. Here at 48 kHz, the rate the mixer works at.
import { Biquad, dbToGain, gainToDb, SR } from './dsp';

const kWeight = () => [
  new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585),
  new Biquad(1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621),
];

export function integratedLoudness(channels: Float32Array[], sr = SR): number {
  if (sr !== SR) throw new Error('loudness is measured at 48 kHz');
  const n = channels[0]?.length ?? 0, block = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
  if (n < block) return -Infinity;
  // squared K-weighted signal, summed over channels (L and R weigh 1)
  const sq = new Float64Array(n);
  for (const ch of channels) { const [f1, f2] = kWeight(); for (let i = 0; i < n; i++) { const y = f2!.process(f1!.process(ch[i]!)); sq[i]! += y * y; } }
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + sq[i]!;
  const powers: number[] = [];
  for (let s = 0; s + block <= n; s += step) powers.push((prefix[s + block]! - prefix[s]!) / block);
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function samplePeak(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]!); if (a > p) p = a; }
  return p;
}

// True peak (BS.1770 annex 2): the waveform between samples can rise above every sample, and lossy encoders make
// that visible. Estimated with 4× oversampling: three interpolated points between neighbours (windowed sinc, 16 taps).
const TAPS = 8;
const PHASES = [0.25, 0.5, 0.75].map((d) => {
  const h = new Float32Array(2 * TAPS);
  for (let m = -TAPS + 1; m <= TAPS; m++) {
    const x = d - m, w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 0.5));
    h[m + TAPS - 1] = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
  }
  return h;
});
/** the highest absolute value of the oversampled signal around each sample */
function truePeaks(ch: Float32Array): Float32Array {
  const n = ch.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = Math.abs(ch[i]!);
    if (i >= TAPS - 1 && i + TAPS < n) for (const h of PHASES) {
      let y = 0;
      for (let k = 0; k < 2 * TAPS; k++) y += ch[i - TAPS + 1 + k]! * h[k]!;
      if (Math.abs(y) > p) p = Math.abs(y);
    }
    out[i] = p;
  }
  return out;
}
export function truePeak(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) { const t = truePeaks(ch); for (let i = 0; i < t.length; i++) if (t[i]! > p) p = t[i]!; }
  return p;
}

/** a look-ahead limiter on true peaks: never above `ceilingDb` (dBTP), the gain recovers smoothly */
export function limit(channels: Float32Array[], ceilingDb = -1.5, sr = SR, lookaheadMs = 5, releaseMs = 80) {
  const n = channels[0]?.length ?? 0, ceiling = dbToGain(ceilingDb), la = Math.max(1, Math.round((lookaheadMs / 1000) * sr));
  const need = new Float32Array(n).fill(1);
  for (const ch of channels) { const t = truePeaks(ch); for (let i = 0; i < n; i++) if (t[i]! > ceiling) need[i] = Math.min(need[i]!, ceiling / t[i]!); }
  // the gain at i is the smallest needed within the look-ahead window, released exponentially
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr)), gain = new Float32Array(n);
  const q: number[] = []; let head = 0, g = 1;
  for (let i = 0; i < n + la; i++) {
    if (i < n) { while (q.length > head && need[q[q.length - 1]!]! >= need[i]!) q.pop(); q.push(i); }
    const j = i - la;
    if (j < 0) continue;
    while (q[head]! < j) head++;
    const target = need[q[head]!]!;
    g = target < g ? target : target + (g - target) * rel;
    gain[j] = g;
  }
  for (const ch of channels) for (let i = 0; i < n; i++) ch[i]! *= gain[i]!;
}

/** bring the mix to the target loudness, keeping the true peaks under the ceiling (−2 dBTP leaves room for what
 * AAC encoding adds: the file stays under −1 dBTP, the EBU R128 limit). Limiting lowers the loudness a little
 * (a lot for peaky material), so gain and limiting repeat until the result is within 0.2 LU of the target. */
export function normalize(channels: Float32Array[], targetLufs = -16, ceilingDb = -2): { before: number; after: number; gainDb: number } {
  const before = integratedLoudness(channels);
  if (!Number.isFinite(before)) return { before, after: before, gainDb: 0 };
  let now = before, total = 0;
  for (let pass = 0; pass < 4 && Math.abs(targetLufs - now) > 0.2; pass++) {
    const gainDb = targetLufs - now, g = dbToGain(gainDb);
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
    limit(channels, ceilingDb);
    total += gainDb;
    now = integratedLoudness(channels);
  }
  return { before, after: now, gainDb: total };
}

export { gainToDb };
