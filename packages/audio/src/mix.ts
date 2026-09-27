// The soundtrack of a project: voices placed on their lines, music under them (lowered further while someone
// speaks), sound effects, then loudness to −16 LUFS with peaks under −1.5 dBFS. The editor's preview and the video
// render call this same function, so what you hear while editing is what the MP4 gets.
import { refResolver, timeProject, type Timeline } from '@af/engine';
import { voiceIsCurrent, type Project } from '@af/schema';
import { addInto, dbToGain, SR } from './dsp';
import { integratedLoudness, limit, normalize, truePeak } from './loudness';
import { pieceFor, renderMusic } from './music';
import { soundFor } from './sfx';

/** Voices are stored at VOICE_LUFS (normalizeVoice, when a line is recorded). The music bus is measured and set
 * to MUSIC_LUFS whatever the mood, then `musicDb` adjusts it; sound effects keep their synthesized level + `sfxDb`. */
export const VOICE_LUFS = -18;
export const MUSIC_LUFS = -26;
export interface Levels { voiceDb: number; musicDb: number; sfxDb: number; duckDb: number }
export const DEFAULT_LEVELS: Levels = { voiceDb: 0, musicDb: 0, sfxDb: -4, duckDb: -8 };

export interface MixInput {
  project: Project;
  timeline?: Timeline;
  /** decoded voice assets, mono at 48 kHz, by asset id */
  voices: Map<string, Float32Array>;
  /** seconds; default: the whole film */
  range?: { from: number; to: number };
  levels?: Partial<Levels>;
  /** −16 by default; null leaves the level as mixed */
  targetLufs?: number | null;
  /** leave out a bus (e.g. music: false to listen to the voices alone) */
  include?: { voices?: boolean; music?: boolean; sfx?: boolean };
}
export interface MixResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  duration: number;
  /** loudness after normalisation (LUFS) */
  lufs: number;
  /** true peak (dBTP) */
  peakDb: number;
  /** lines without an up-to-date recording, as "scene/line" */
  missing: string[];
  /** sound kinds the synthesizer does not know */
  unknownSounds: string[];
}

/** how much of a voice is sounding: an envelope follower (fast attack, slow release) */
function activity(v: Float32Array): Float32Array {
  const out = new Float32Array(v.length), att = Math.exp(-1 / (0.02 * SR)), rel = Math.exp(-1 / (0.35 * SR));
  let e = 0;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]!); e = a > e ? a + (e - a) * att : a + (e - a) * rel; out[i] = e; }
  return out;
}

/** bring one recorded line to VOICE_LUFS, peaks under −1 dBFS (short lines, too brief to gate, go by their RMS) */
export function normalizeVoice(x: Float32Array): Float32Array {
  let lufs = integratedLoudness([x]);
  if (!Number.isFinite(lufs)) { let s = 0; for (const v of x) s += v * v; lufs = x.length ? 10 * Math.log10(s / x.length + 1e-12) - 0.691 : -Infinity; }
  if (!Number.isFinite(lufs)) return x;
  const out = new Float32Array(x), g = dbToGain(VOICE_LUFS - lufs);
  for (let i = 0; i < out.length; i++) out[i]! *= g;
  limit([out], -1);
  return out;
}

export function mixSoundtrack(input: MixInput): MixResult {
  const { project, voices } = input, tl = input.timeline ?? timeProject(project), lv = { ...DEFAULT_LEVELS, ...input.levels };
  const inc = { voices: true, music: true, sfx: true, ...input.include };
  const from = Math.max(0, input.range?.from ?? 0), to = Math.min(tl.duration, input.range?.to ?? tl.duration);
  const n = Math.max(1, Math.round((to - from) * SR)), L = new Float32Array(n), R = new Float32Array(n), voice = new Float32Array(n);
  const at = (t: number) => Math.round((t - from) * SR);
  const missing: string[] = [], unknownSounds = new Set<string>();

  // voices, centred
  tl.scenes.forEach((ts, si) => {
    const scene = project.scenes[si]!;
    scene.narration.forEach((line, li) => {
      const timed = ts.lines[li]!, a0 = ts.start + timed.start;
      if (a0 >= to || ts.start + timed.end <= from) return;
      const buf = line.audio && voiceIsCurrent(line) ? voices.get(line.audio.asset) : undefined;
      if (!buf) { missing.push(`${scene.id}/${line.id}`); return; }
      if (!inc.voices) return;
      const s = at(a0), g = dbToGain(lv.voiceDb);
      for (let i = Math.max(0, -s); i < buf.length && s + i < n; i++) voice[s + i]! += buf[i]! * g;
    });
  });
  for (let i = 0; i < n; i++) { L[i]! += voice[i]!; R[i]! += voice[i]!; }

  // music under the voice: its gain drops by duckDb while the voice sounds
  if (inc.music) {
    // each scene plays its piece of the project's score (or a built-in mood)
    const sections = tl.scenes.map((ts, si) => ({ start: ts.start - from, duration: ts.duration, piece: pieceFor(project.scenes[si]!.music.mood, project.score), gainDb: project.scenes[si]!.music.gain }))
      .filter((s) => s.start + s.duration > 0 && s.start < to - from);
    if (sections.some((s) => s.piece)) {
      const [ml, mr] = renderMusic(sections, to - from, 7), act = activity(voice), duck = dbToGain(lv.duckDb);
      const measured = integratedLoudness([ml, mr]), base = dbToGain((Number.isFinite(measured) ? MUSIC_LUFS - measured : 0) + lv.musicDb);
      for (let i = 0; i < n; i++) {
        const k = Math.min(1, act[i]! * 12), g = base * (1 + (duck - 1) * k);
        L[i]! += ml[i]! * g; R[i]! += mr[i]! * g;
      }
    }
  }

  // sound effects at their moments
  if (inc.sfx) tl.scenes.forEach((ts, si) => {
    const scene = project.scenes[si]!, res = refResolver(ts.lines);
    scene.sfx.forEach((fx, k) => {
      const t = ts.start + res(fx.t, 0);
      if (t >= to) return;
      const buf = soundFor(fx.kind, project.sounds, k);
      if (!buf) { unknownSounds.add(fx.kind); return; }
      if (t + buf.length / SR <= from) return;
      addInto(L, R, buf, at(t), dbToGain(lv.sfxDb + fx.gain), fx.pan);
    });
  });

  let lufs = integratedLoudness([L, R]);
  if (input.targetLufs !== null && Number.isFinite(lufs)) lufs = normalize([L, R], input.targetLufs ?? -16).after;
  const peak = truePeak([L, R]);
  return { sampleRate: SR, left: L, right: R, duration: n / SR, lufs, peakDb: 20 * Math.log10(Math.max(1e-9, peak)), missing, unknownSounds: [...unknownSounds] };
}
