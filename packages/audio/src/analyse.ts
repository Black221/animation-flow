// What a music brought as a model sounds like, in words a composer (a language model) can use: tempo, how marked the
// beat is, energy, brightness, probable key. Read from mono samples (11 025 Hz is enough); the file is not kept.

export interface MusicFeatures { seconds: number; bpm: number | null; pulse: number; rmsDb: number; brightness: number; key: string | null; mode: 'major' | 'minor' | null; keyConfidence: number }

const NOTES = ['do', 'do♯', 'ré', 'mi♭', 'mi', 'fa', 'fa♯', 'sol', 'la♭', 'la', 'si♭', 'si'];
// Krumhansl–Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

export function musicFeatures(x: Float32Array, rate: number): MusicFeatures {
  const seconds = x.length / rate;
  // at most two minutes, from a little after the start (intros are quiet)
  const from = Math.min(Math.floor(x.length * 0.1), Math.max(0, x.length - 120 * rate)), y = x.subarray(from, Math.min(x.length, from + 120 * rate));
  let sq = 0, zc = 0;
  for (let i = 0; i < y.length; i++) { sq += y[i]! * y[i]!; if (i && (y[i]! >= 0) !== (y[i - 1]! >= 0)) zc++; }
  const rmsDb = 10 * Math.log10(sq / Math.max(1, y.length) + 1e-12), brightness = zc / Math.max(1, y.length) * rate / 2;

  // tempo: the autocorrelation of the onset envelope (rises of the compressed energy of 46 ms windows every 128
  // samples, slightly smoothed), read at fractional lags, summed over the first multiples of the beat (a comb: the
  // true tempo gathers them all)
  const hop = 128, win = 512, frames = Math.max(0, Math.floor((y.length - win) / hop)), raw = new Float32Array(frames), env = new Float32Array(frames);
  const mean = sq / Math.max(1, y.length) + 1e-12;
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0; for (let i = f * hop; i < f * hop + win; i++) e += y[i]! * y[i]!;
    const l = Math.log1p((10 * e) / win / mean); raw[f] = f ? Math.max(0, l - prev) : 0; prev = l;
  }
  for (let f = 0; f < frames; f++) env[f] = 0.25 * (raw[f - 1] ?? 0) + 0.5 * raw[f]! + 0.25 * (raw[f + 1] ?? 0);
  const fps = rate / hop, maxLag = Math.min(frames - 1, Math.ceil((60 / 60) * fps * 4) + 2), ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i + lag < frames; i++) s += env[i]! * env[i + lag]!; ac[lag] = s / Math.max(1, frames - lag); }
  const at = (lag: number) => { const i = Math.floor(lag), t = lag - i; return i + 1 > maxLag ? 0 : ac[i]! * (1 - t) + ac[i + 1]! * t; };
  let best = 0, bestBpm = 0, bestRaw = 0, sum = 0, count = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    let s = 0, w = 0;
    for (let k = 1; k <= 4 && k * lag <= maxLag; k++) { s += at(k * lag); w++; }
    const rawScore = w ? s / w : 0, score = rawScore * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.2) ** 2); // tempos near 120 are likelier
    sum += rawScore; count++;
    if (score > best) { best = score; bestBpm = bpm; bestRaw = rawScore; }
  }
  // how marked the beat is: how far the tempo's comb stands above the average one, against the envelope's own energy
  const floor = count ? sum / count : 0, pulse = ac[0]! > floor ? Math.max(0, Math.min(1, ((bestRaw - floor) / (ac[0]! - floor)) * 2)) : 0;
  const bpm = bestBpm && frames > fps * 4 && pulse > 0.35 ? Math.round(bestBpm) : null;

  // key: the energy of each pitch class (C3–B5, Goertzel on 4096-sample frames), against the key profiles
  const chroma = new Array<number>(12).fill(0), N = 4096, step = Math.max(N, Math.floor(y.length / 60));
  for (let start = 0; start + N <= y.length; start += step) {
    for (let midi = 48; midi < 84; midi++) {
      const f = 440 * 2 ** ((midi - 69) / 12), w = (2 * Math.PI * f) / rate, c = 2 * Math.cos(w);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); s0 = y[start + i]! * h + c * s1 - s2; s2 = s1; s1 = s0; }
      chroma[midi % 12]! += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
    }
  }
  let key: string | null = null, mode: 'major' | 'minor' | null = null, top = -1, second = -1;
  if (chroma.some((v) => v > 0)) for (let k = 0; k < 12; k++) for (const [m, prof] of [['major', MAJOR], ['minor', MINOR]] as const) {
    const r = correlation(chroma, prof.map((_, i) => prof[(i - k + 12) % 12]!));
    if (r > top) { second = top; top = r; key = NOTES[k]!; mode = m; } else if (r > second) second = r;
  }
  return { seconds, bpm, pulse, rmsDb, brightness, key, mode, keyConfidence: Math.max(0, top - second) };
}

/** the features in a sentence, in French (the storyboard and the composer read it) */
export function describeMusic(m: MusicFeatures): string {
  const t = `${Math.floor(m.seconds / 60)} min ${String(Math.round(m.seconds % 60)).padStart(2, '0')} s`;
  const energy = m.rmsDb > -13 ? 'très énergique' : m.rmsDb > -18 ? 'énergique' : m.rmsDb > -25 ? 'modérée' : 'douce';
  const beat = m.pulse > 0.75 ? 'rythme très marqué (percussions en avant)' : m.pulse > 0.45 ? 'rythme net' : 'rythme léger, flottant';
  const light = m.brightness > 2600 ? 'son brillant, aigus présents' : m.brightness > 1400 ? 'son clair' : 'son chaud, rond';
  const tonality = m.key && m.mode ? `tonalité probable ${m.key} ${m.mode === 'major' ? 'majeur' : 'mineur'}${m.keyConfidence < 0.05 ? ' (incertaine)' : ''}` : 'tonalité indéterminée';
  return [m.bpm ? `environ ${m.bpm} BPM` : 'tempo libre', beat, energy, light, tonality, t].join(', ');
}
