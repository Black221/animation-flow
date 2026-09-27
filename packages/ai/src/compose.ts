// Composing the film's sound: the model writes a score (a few pieces, one per kind of scene, in one key for the
// film) and assigns one to each scene, then designs every sound effect the storyboard asks for as a synthesis
// recipe. Both are checked as data and played once (nothing silent, nothing broken). If the model cannot write
// them, the built-in moods and a plain sound stand in, flagged.
import { MOOD_NAMES, pieceNotes, recipeSound, SR } from '@af/audio';
import { DRUMS, INSTRUMENTS, Piece, SoundRecipe, type Issue, type Piece as PieceT, type SoundRecipe as SoundRecipeT } from '@af/schema';
import { z } from 'zod';
import { ask, zIssues, type Check, type Model, type OnStep } from './ask';
import type { Storyboard } from './storyboard';

export interface Score { score: Record<string, PieceT>; music: Record<string, string> }
export interface SoundBrief { id: string; name: string; description: string }

const EXAMPLE_PIECE = {
  name: 'Matin au champ', description: 'calme et lumineux, sous la voix', bpm: 84, key: 'D', mode: 'major', chords: ['I', 'vi', 'IV', 'V'], swing: 0, reverb: 0.4,
  parts: [
    { instrument: 'pad', play: 'chords', pattern: 'x---------------', gain: -4 },
    { instrument: 'marimba', play: 'arp', pattern: 'x.x.x.x.x.x.x.x.', arp: 'updown', octave: 1, gain: -6 },
    { instrument: 'flute', play: 'melody', notes: ['5 - - - 3 - 2 - 1 - - - . . . .', '3 - - - 5 - 6 - 5 - - - . . . .'], octave: 1, gain: -9 },
    { instrument: 'bass', play: 'bass', pattern: 'x.......x.......' },
    { instrument: 'shaker', play: 'drum', pattern: '..x...x...x...x.', gain: -12 },
  ],
};
const EXAMPLE_SOUND = { name: 'Porte qui grince', description: 'une vieille porte en bois', layers: [
  { wave: 'saw', freq: [220, 340], duration: 0.9, attack: 0.05, decay: 0.6, filter: { type: 'bandpass', freq: [900, 1600], q: 6 }, vibrato: { rate: 9, depth: 0.6 }, gain: -6 },
  { wave: 'noise', duration: 0.15, start: 0.85, decay: 0.05, filter: { type: 'lowpass', freq: [600], q: 0.7 }, gain: -2 },
] };

const SCORE_PROMPT = `You compose the music of a short animated explainer film, as a score that a synthesiser plays. Answer with JSON only: { "pieces": { "<id>": <piece>, … }, "music": { "<scene id>": "<piece id>" | "none", … } }.

A PIECE loops bars: { "name", "description", "bpm" (40–200), "key" ("C", "F#", "Bb"…), "mode" ("major", "minor", "dorian", "mixolydian", "lydian", "phrygian", "pentatonic", "blues"), "chords": [one chord per bar, roman numerals over the key's MAJOR scale: I ii iii IV V vi vii°, lower case = minor, "b"/"#" before (bVII, bVI), "7" "maj7" "m7" "sus2" "sus4" "6" "9" "dim" "aug" after], "parts": [...], "swing" (0–0.5), "reverb" (0–1) }.
A PART: { "instrument", "play", "pattern", "notes", "arp", "octave" (-3…3), "gain" (dB, -30…6), "pan" (-1…1) }.
- instruments: ${INSTRUMENTS.join(', ')}; percussion: ${DRUMS.join(', ')}.
- play: "chords" (the bar's chord), "bass" (its root, low), "arp" (its notes one at a time; "arp": up, down, updown, random), "melody" (the "notes"), "drum" (percussion only).
- "pattern": 16 steps per bar, "x" a hit, "X" an accent, "-" holds the previous hit, "." silence; one string for every bar, or a list of strings (one per bar, looped). "x---------------" holds a whole bar.
- "notes" (melody): a list of bars, each 16 tokens separated by spaces: a scale degree of the mode (1 = tonic, 8 = an octave up; "#"/"b" before, "'" or "," after for an octave up/down), "-" to hold, "." for silence.
RULES: the music sits UNDER a narrator's voice: soft, simple, not busy; 2 to 5 parts; melodies sparse, in the middle register. Keep one key for the whole film (or closely related keys) so it holds together; tempo and instruments follow each scene's energy. Write 2 to 5 pieces for the film and reuse them across scenes of the same feeling; "none" for a scene that must be silent.

EXAMPLE PIECE: ${JSON.stringify(EXAMPLE_PIECE)}`;

const SOUND_PROMPT = `You design sound effects for a short animated explainer film, as synthesis recipes a synthesiser plays. Answer with JSON only: { "<sound id>": <recipe>, … }, one recipe for every sound asked.

A RECIPE: { "name", "description", "layers": [1 to 8 layers] }. A LAYER: { "wave": "sine" | "triangle" | "square" | "saw" | "noise", "freq": [from Hz, to Hz] (an exponential glide; [Hz] for a steady pitch), "start" (s), "duration" (s, ≤ 4), "attack" (s), "decay" (s: time to fall to about a third after the attack), "filter": { "type": "lowpass" | "highpass" | "bandpass", "freq": [from, to] (a sweep) or [Hz], "q" }, "vibrato": { "rate" (Hz), "depth" (semitones) }, "repeat": { "count", "every" (s) }, "gain" (dB) }.
Think like a foley artist: noise through a band-pass for air, wind, water, paper; low sines gliding down for thuds and impacts; short high sines for clicks and chimes; a square or saw through a sweeping filter for machines and robots; repeats for rattles and footsteps. Short and clean (most under 1 s), cartoon-friendly, never harsh.

EXAMPLE: ${JSON.stringify(EXAMPLE_SOUND)}`;

// ---------- checks ----------
const peakOf = (x: Float32Array) => { let p = 0; for (const v of x) { if (!Number.isFinite(v)) return NaN; p = Math.max(p, Math.abs(v)); } return p; };

/** a piece is written right, and plays something */
export function checkPiece(v: unknown, path: string): { piece: PieceT | null; issues: Issue[] } {
  const r = Piece.safeParse(v);
  if (!r.success) return { piece: null, issues: zIssues(r.error).map((i) => ({ ...i, path: `${path}.${i.path}` })) };
  const notes = pieceNotes(r.data, 0, (60 / r.data.bpm) * 4 * Math.min(4, r.data.chords.length));
  if (!notes.length) return { piece: null, issues: [{ path, message: 'la pièce ne joue aucune note (motifs vides ?)' }] };
  return { piece: r.data, issues: [] };
}
export function checkRecipe(v: unknown, path: string): { recipe: SoundRecipeT | null; issues: Issue[] } {
  const r = SoundRecipe.safeParse(v);
  if (!r.success) return { recipe: null, issues: zIssues(r.error).map((i) => ({ ...i, path: `${path}.${i.path}` })) };
  const buf = recipeSound(r.data), peak = peakOf(buf);
  if (!Number.isFinite(peak)) return { recipe: null, issues: [{ path, message: 'le son produit des valeurs invalides' }] };
  if (peak < 0.01) return { recipe: null, issues: [{ path, message: 'le son est inaudible (gain trop bas ou filtre hors de la fréquence)' }] };
  if (buf.length / SR > 6) return { recipe: null, issues: [{ path, message: 'le son dure plus de 6 s' }] };
  return { recipe: r.data, issues: [] };
}

// ---------- the score ----------
const ScoreAnswer = z.object({ pieces: z.record(z.string(), z.unknown()), music: z.record(z.string(), z.string()) });

export async function composeScore(model: Model, sb: Storyboard, onStep: OnStep = () => undefined): Promise<Score & { fallback: boolean; issues: Issue[] }> {
  const check: Check<Score> = (v) => {
    const a = ScoreAnswer.safeParse(v);
    if (!a.success) return { ok: false, issues: zIssues(a.error) };
    const issues: Issue[] = [], score: Record<string, PieceT> = {};
    for (const [id, p] of Object.entries(a.data.pieces)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id)) { issues.push({ path: `pieces.${id}`, message: 'identifiant : lettres, chiffres, _ . -' }); continue; }
      const c = checkPiece(p, `pieces.${id}`);
      if (c.piece) score[id] = c.piece; else issues.push(...c.issues);
    }
    const music: Record<string, string> = {};
    for (const s of sb.scenes) {
      const m = a.data.music[s.id];
      if (m === undefined) issues.push({ path: `music.${s.id}`, message: `la scène ${s.id} n'a pas de musique (une pièce ou "none")` });
      else if (m !== 'none' && !a.data.pieces[m]) issues.push({ path: `music.${s.id}`, message: `pièce « ${m} » inconnue (${Object.keys(a.data.pieces).join(', ')})` });
      else music[s.id] = m;
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: { score, music } };
  };
  const request = `Film: ${sb.title} (${sb.language}). Scenes, with the music asked for each:\n${sb.scenes.map((s) => `- ${s.id} "${s.title}", ${s.duration} s: ${s.music}`).join('\n')}`;
  const schema = z.toJSONSchema(z.object({ pieces: z.record(z.string(), Piece), music: z.record(z.string(), z.string()) }), { io: 'input' }) as Record<string, unknown>;
  const { value, issues } = await ask(model, SCORE_PROMPT, request, { name: 'score', schema }, check, 'music', 'score', onStep, 12_000);
  if (value) return { ...value, fallback: false, issues: [] };
  return { score: {}, music: Object.fromEntries(sb.scenes.map((s) => [s.id, moodFromWords(s.music)])), fallback: true, issues };
}

/** the built-in mood that best matches a description (the fallback) */
export function moodFromWords(words: string): string {
  const w = words.toLowerCase();
  if (/^\s*(none|aucune|silence)\s*$/.test(w)) return 'none';
  const table: [RegExp, string][] = [[/nuit|night|myst|rêve|dream|calme nocturne/, 'night'], [/épique|epic|héro|triomph|grand/, 'epic'], [/tendu|tense|danger|suspense|inqui/, 'tense'], [/joy|enjou|playful|gai|fun|drôle|fête/, 'playful'], [/curieu|curious|découv|question|explor/, 'curious']];
  for (const [re, mood] of table) if (re.test(w)) return mood;
  return MOOD_NAMES.includes(w.trim()) ? w.trim() : 'calm';
}

// ---------- sound effects ----------
export async function designSounds(model: Model, briefs: SoundBrief[], film: string, onStep: OnStep = () => undefined): Promise<{ sounds: Record<string, SoundRecipeT>; fallbacks: string[]; issues: Issue[] }> {
  if (!briefs.length) return { sounds: {}, fallbacks: [], issues: [] };
  const check: Check<Record<string, SoundRecipeT>> = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet { id: recette } est attendu' }] };
    const issues: Issue[] = [], out: Record<string, SoundRecipeT> = {};
    for (const b of briefs) {
      const r = (v as Record<string, unknown>)[b.id];
      if (r === undefined) { issues.push({ path: b.id, message: `son « ${b.id} » manquant` }); continue; }
      const c = checkRecipe({ name: b.name, description: b.description, ...(r as object) }, b.id);
      if (c.recipe) out[b.id] = c.recipe; else issues.push(...c.issues);
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: out };
  };
  const request = `Film: ${film}. Sounds to design:\n${briefs.map((b) => `- "${b.id}" (${b.name}): ${b.description}`).join('\n')}`;
  const schema = z.toJSONSchema(z.record(z.string(), SoundRecipe), { io: 'input' }) as Record<string, unknown>;
  const { value, issues } = await ask(model, SOUND_PROMPT, request, { name: 'sounds', schema }, check, 'sound', 'sounds', onStep, 8000);
  if (value) return { sounds: value, fallbacks: [], issues: [] };
  // a plain, soft blip for each: better than silence where a sound was asked
  const plain = (b: SoundBrief): SoundRecipeT => SoundRecipe.parse({ name: b.name, description: b.description, layers: [{ wave: 'sine', freq: [700, 420], duration: 0.18, decay: 0.08, gain: -4 }] });
  return { sounds: Object.fromEntries(briefs.map((b) => [b.id, plain(b)])), fallbacks: briefs.map((b) => `son ${b.id}`), issues };
}
