// What the models are told. The instructions are in English (models follow them best); the narration is written
// in the project's language. Nothing is taken from a fixed catalogue: the storyboard says what the film needs, each
// thing is drawn for it, and scenes are written with those drawings (their poses, expressions and sizes).
import { assetBounds } from '@af/engine';
import { assetExpressions, assetPoses, type Asset, type Project } from '@af/schema';
import type { Storyboard, StoryScene } from './storyboard';

export const LANGUAGE_NAMES: Record<string, string> = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', wo: 'Wolof', ar: 'Arabic' };

/** the drawings and sounds of a project, as a model writing scenes needs them */
export function drawingsBrief(p: Pick<Project, 'assets' | 'cast'> & Partial<Pick<Project, 'sounds'>>): string {
  const assets = Object.entries(p.assets ?? {}) as [string, Asset][];
  const size = (a: Asset) => { const b = assetBounds(a); return { width: Math.round(b.w), height: Math.round(b.h), ...(a.kind === 'prop' && Math.abs(b.y) < 40 && Math.abs(b.y + b.h) > 40 ? { hangs: true } : {}) }; };
  return JSON.stringify({
    characters: Object.entries(p.cast).map(([ref, c]) => { const a = p.assets?.[c.kind]; return a ? { ref, name: c.name, poses: assetPoses(a), expressions: assetExpressions(a), ...size(a) } : { ref, name: c.name }; }),
    props: assets.filter(([, a]) => a.kind === 'prop').map(([ref, a]) => ({ ref, name: a.name, poses: assetPoses(a), ...size(a) })),
    decors: assets.filter(([, a]) => a.kind === 'decor').map(([kind, a]) => ({ kind, name: a.name, description: a.description.slice(0, 200) })),
    sounds: Object.entries(p.sounds ?? {}).map(([kind, s]) => ({ kind, name: s.name, description: s.description.slice(0, 160) })),
  });
}

export interface StoryboardOptions { language: string; style: string; targetSeconds?: number | undefined; instructions?: string | undefined }

export function storyboardPrompt(o: StoryboardOptions): string {
  const lang = LANGUAGE_NAMES[o.language] ?? o.language;
  return `You are the director of a short animated explainer film. You turn the user's text into a STORYBOARD (JSON). Everything in the film is made for it from your descriptions (drawn, composed, sound-designed): there is no stock library.

Rules:
- Cut the film into scenes of 5 to 40 seconds${o.targetSeconds ? `, about ${o.targetSeconds} seconds in total` : ''}. Each scene: id ("s1", "s2"…), title, duration (seconds), decor (the id of one of your "decors"), props (ids of your "props" seen in it), music (a few words: mood, energy, instruments — the score is composed from them; "none" for silence), narration lines, shots.
- Narration is spoken by "narrator" or by a cast member (their id). Write it in ${lang}, for the ear: short sentences, one idea per line, faithful to the user's text (keep its facts and numbers exactly; do not invent any).
- About 14 characters of narration per second of scene: a 20 s scene holds about 280 characters.
- "shots": what we see, in plain English, one entry per shot: who is where, what they do, which prop appears, when (tie actions to narration lines: "on l2, the padlock snaps shut").
- "cast": 1 to 5 characters the story needs (people, animals, robots, talking objects): id, name, and a "description" precise enough for an illustrator: what they are, age and build, face and hair, clothes and their colours, one distinctive detail; plus how they move if it matters (flies, rolls…). Optionally "voice".
- "props": every object that must be seen (id, name, description: shape, colours, size compared to a person, what moves on it). Reuse a prop across scenes rather than inventing near-duplicates.
- "decors": every place (id, name, description: what is seen, from where, time of day, colours, the ground where characters stand). Scenes may share a decor.
- "sounds": every sound effect the shots need (id, name, description: what makes the sound, how it feels: "a soft paper whoosh", "a robot's happy double beep"); each is designed for the film.
- ids are short (letters, digits, - and _) and unique across cast, props, decors and sounds.
- "palette": 5 to 8 colours ("#rrggbb") shared by the whole film, harmonious and readable.
- The film's style is "${o.style}".
${o.instructions ? `\nThe user adds: ${o.instructions}\n` : ''}
Answer with the storyboard JSON only: { "title", "language": "${o.language}", "style": "${o.style}", "palette": [...], "cast": [...], "props": [...], "decors": [...], "sounds": [...], "scenes": [...] }.`;
}

export const FORMAT_GUIDE = `THE ANIMATION FORMAT (one scene)
{
  "id": "s1", "title": "…", "duration": 20,
  "decor": { "kind": "<decor id>" },
  "music": { "mood": "<already chosen: keep it>", "gain": 0 },
  "narration": [ { "id": "l1", "speaker": "narrator", "text": "…" } ],
  "camera": [ { "t": 0, "x": 960, "y": 540, "zoom": 1 } ],
  "elements": [ … ],
  "sfx": [ { "t": { "line": "l2", "edge": "start", "offset": 0.3 }, "kind": "<sound kind>", "gain": 0, "pan": 0 } ],
  "transition": "cut" | "fade"
}
Screen: 1920 × 1080 world pixels; x grows to the right, y downwards. The ground line is around y = 900.
Times ("t", "enter", "exit"): seconds from the scene start, or a narration line { "line": "l2", "edge": "start" | "end", "offset": seconds }. Prefer line references: they follow the voice when it is recorded.
Elements:
- { "id", "type": "character", "ref": "<cast ref>", "layer": 5, "keys": [ … ] } — a character's position is its FEET (put them near y = 900; a flying one higher). Its size at scale 1 is given with the drawings. "facing": 1 looks right, -1 looks left.
- { "id", "type": "prop", "ref": "<prop ref>", "layer": 3, "keys": [ … ] } — a prop's position is its base (bottom centre), or its top for one that hangs; things on the ground at y ≈ 850–930.
- { "id", "type": "text", "space": "screen", "params": { "text": "…", "size": 64, "color": "#1F3A5F", "font": "display" | "body" | "marker" | "hand", "frame": false, "subtitle": "…" }, "keys": [ … ] } — titles and captions ("space": "screen" ignores the camera). Keep titles in the top third (y 80–300); the bottom band (y > 960) belongs to subtitles.
- "enter" / "exit" (optional): the element exists only between them.
- "layer": drawing order, higher is in front (decor is always behind).
Keys: [ { "t": …, "x": …, "y": …, "scale": 1, "rotation": 0, "opacity": 1, "pose": "…", "expression": "…", "facing": 1, "ease": "linear" | "in" | "out" | "inOut" | "backOut" | "step" } ]
- Numbers (x, y, scale, rotation, opacity) glide between the two keys that set them, with the "ease" of the later key. pose, expression, facing and text hold from their key until the next one that sets them.
- A key may set only some fields: { "t": { "line": "l3" }, "pose": "point" } changes the pose without moving.
- Walking: pose "walk" while x changes (about 250 px per second), then back to "idle".
- A pop-in: opacity 0 and scale 0.3, then on the next key opacity 1, scale 1, ease "backOut", 0.4–0.6 s later.
Camera keys: { "t", "x", "y", "zoom", "rotation", "ease" }; x, y is the world point at the centre of the screen. Keep zoom between 0.9 and 1.6; move it slowly (≥ 1 s).
Good animation: something changes on every narration line (a pose, an expression, a prop appearing, the camera); characters stay inside the frame (x 150–1770); nothing important is hidden behind the subtitles band; 4 to 10 elements per scene.`;

export function scenePrompt(lang: string, drawings: string): string {
  return `You animate one scene of a short explainer film, in a declarative JSON format. Answer with the scene JSON only.

${FORMAT_GUIDE}

The film's drawings and sounds (the only characters, props, decors and sound effects there are; use their refs, kinds, poses and expressions exactly): ${drawings}
The scene's music is already composed and chosen: keep "music" as given.

The narration is already written (in ${LANGUAGE_NAMES[lang] ?? lang}) and must be kept exactly: same line ids, speakers and texts, in the same order. Every element id is unique within the scene.`;
}

export function sceneRequest(sb: Storyboard, scene: StoryScene): string {
  return `Film: ${sb.title}. Style: ${sb.style}.
Other scenes, for continuity: ${sb.scenes.filter((s) => s.id !== scene.id).map((s) => `${s.id} "${s.title}"`).join('; ') || 'none'}.

Write scene ${scene.id} from this storyboard entry (decor "${scene.decor}"${scene.props.length ? `, props ${scene.props.map((p) => `"${p}"`).join(', ')}` : ''}):
${JSON.stringify(scene, null, 1)}`;
}

export function editRequest(sceneJson: string, instruction: string): string {
  return `Here is a scene in the animation format:
${sceneJson}

Change it as follows, keeping everything else as it is (same narration lines, same ids where elements stay): ${instruction}

Answer with the complete modified scene JSON only.`;
}

export const PLAN_PROMPT = `You prepare a change to one scene of an animated film. Everything in it is made for the film. Given the drawings and sounds that exist and the change asked, list what NEW things the change needs: characters, props or decors to draw, or sound effects to design, that do not exist yet (not ones that can be reused). Describe each well enough for an illustrator or a sound designer (what it is, shape, colours, size compared to a person, what moves; for a sound, what makes it and how it feels). Answer JSON only: { "new": [ { "id", "kind": "character" | "prop" | "decor" | "sound", "name", "description" } ] } — an empty list when nothing new is needed. ids: short, letters, digits, - and _, different from the existing ones.`;

export function planRequest(drawings: string, sceneJson: string, instruction: string): string {
  return `Existing drawings: ${drawings}\n\nThe scene: ${sceneJson}\n\nThe change asked: ${instruction}`;
}

export function repairRequest(issues: { path: string; message: string }[]): string {
  return `That JSON has problems:
${issues.slice(0, 20).map((i) => `- ${i.path}: ${i.message}`).join('\n')}
Return the corrected complete JSON only.`;
}
