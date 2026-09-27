// What the models are told. The instructions are in English (models follow them best); the narration is written
// in the project's language. The library catalogue is generated from the code, so a model can only be asked to use
// what actually exists.
import { MOOD_NAMES, soundCatalog } from '@af/audio';
import { catalog } from '@af/library';
import type { Storyboard, StoryScene } from './storyboard';

export const LANGUAGE_NAMES: Record<string, string> = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', wo: 'Wolof', ar: 'Arabic' };

export function libraryBrief(): string {
  return JSON.stringify({
    characters: catalog.characters.map((c) => ({ kind: c.kind, label: c.label, poses: c.poses, expressions: c.expressions, params: c.params })),
    props: catalog.props.map((p) => ({ kind: p.kind, label: p.label, params: p.params })),
    decors: catalog.decors.map((d) => ({ kind: d.kind, label: d.label, params: d.params })),
    musicMoods: ['none', ...MOOD_NAMES],
    sounds: soundCatalog.map((s) => s.kind),
  });
}

export interface StoryboardOptions { language: string; style: string; targetSeconds?: number | undefined; instructions?: string | undefined }

export function storyboardPrompt(o: StoryboardOptions): string {
  const lang = LANGUAGE_NAMES[o.language] ?? o.language;
  return `You are the director of a short animated explainer film. You turn the user's text into a STORYBOARD (JSON).

Rules:
- Cut the film into scenes of 5 to 40 seconds${o.targetSeconds ? `, about ${o.targetSeconds} seconds in total` : ''}. Each scene: id ("s1", "s2"…), title, duration (seconds), decor, music mood, narration lines, shots.
- Narration is spoken by "narrator" or by a cast member (their id). Write it in ${lang}, for the ear: short sentences, one idea per line, faithful to the user's text (keep its facts and numbers exactly; do not invent any).
- About 14 characters of narration per second of scene: a 20 s scene holds about 280 characters.
- "shots": what we see, in plain English, one entry per shot: who is where, what they do, which prop appears, when (tie actions to narration lines: "on l2, the padlock snaps shut").
- Cast: 1 to 5 characters. Use only these kinds; give them colours through params. A "person" is a human (skin, hair, clothes); a "drone" is a small flying robot sidekick.
- Decor, props, music moods and sounds must come from the library below; nothing else can be drawn or heard.
- The film's style is "${o.style}".
${o.instructions ? `\nThe user adds: ${o.instructions}\n` : ''}
Library: ${libraryBrief()}

Answer with the storyboard JSON only: { "title", "language": "${o.language}", "style": "${o.style}", "cast": [...], "scenes": [...] }.`;
}

export const FORMAT_GUIDE = `THE ANIMATION FORMAT (one scene)
{
  "id": "s1", "title": "…", "duration": 20,
  "decor": { "kind": "<decor kind>", "params": {…} },
  "music": { "mood": "<mood>", "gain": 0 },
  "narration": [ { "id": "l1", "speaker": "narrator", "text": "…" } ],
  "camera": [ { "t": 0, "x": 960, "y": 540, "zoom": 1 } ],
  "elements": [ … ],
  "sfx": [ { "t": { "line": "l2", "edge": "start", "offset": 0.3 }, "kind": "<sound>", "gain": 0, "pan": 0 } ],
  "transition": "cut" | "fade"
}
Screen: 1920 × 1080 world pixels; x grows to the right, y downwards. The ground line is around y = 900.
Times ("t", "enter", "exit"): seconds from the scene start, or a narration line { "line": "l2", "edge": "start" | "end", "offset": seconds }. Prefer line references: they follow the voice when it is recorded.
Elements:
- { "id", "type": "character", "ref": "<cast id>", "layer": 5, "keys": [ … ] } — a character's position is its FEET. A person is about 340 px tall at scale 1 (put its feet near y = 900); a drone hovers (y 350–650). "facing": 1 looks right, -1 looks left.
- { "id", "type": "prop", "ref": "<prop kind>", "params": {…}, "layer": 3, "keys": [ … ] } — trees, houses, tractors stand on the ground (y ≈ 800–930); signs and padlocks are centred on their position.
- { "id", "type": "text", "space": "screen", "params": { "text": "…", "size": 64, "color": "#1F3A5F", "font": "display" | "body" | "marker" | "hand", "frame": false, "subtitle": "…" }, "keys": [ … ] } — titles and captions ("space": "screen" ignores the camera). Keep titles in the top third (y 80–300); the bottom band (y > 960) belongs to subtitles.
- "enter" / "exit" (optional): the element exists only between them.
- "layer": drawing order, higher is in front (decor is always behind).
Keys: [ { "t": …, "x": …, "y": …, "scale": 1, "rotation": 0, "opacity": 1, "pose": "…", "expression": "…", "facing": 1, "ease": "linear" | "in" | "out" | "inOut" | "backOut" | "step" } ]
- Numbers (x, y, scale, rotation, opacity) glide between the two keys that set them, with the "ease" of the later key. pose, expression, facing and text hold from their key until the next one that sets them.
- A key may set only some fields: { "t": { "line": "l3" }, "pose": "point" } changes the pose without moving.
- A pop-in: opacity 0 and scale 0.3, then on the next key opacity 1, scale 1, ease "backOut", 0.4–0.6 s later.
Camera keys: { "t", "x", "y", "zoom", "rotation", "ease" }; x, y is the world point at the centre of the screen. Keep zoom between 0.9 and 1.6; move it slowly (≥ 1 s).
Good animation: something changes on every narration line (a pose, an expression, a prop appearing, the camera); characters stay inside the frame (x 150–1770); nothing important is hidden behind the subtitles band; 4 to 10 elements per scene.`;

export function scenePrompt(lang: string): string {
  return `You animate one scene of a short explainer film, in a declarative JSON format. Answer with the scene JSON only.

${FORMAT_GUIDE}

Library (use only these kinds, poses, expressions, props, decors, moods and sounds): ${libraryBrief()}

The narration is already written (in ${LANGUAGE_NAMES[lang] ?? lang}) and must be kept exactly: same line ids, speakers and texts, in the same order. Characters are the cast ids given; every element id is unique within the scene.`;
}

export function sceneRequest(sb: Storyboard, scene: StoryScene, castJson: string): string {
  return `Film: ${sb.title}. Style: ${sb.style}. Cast (ids to use in "ref"): ${castJson}
Other scenes, for continuity: ${sb.scenes.filter((s) => s.id !== scene.id).map((s) => `${s.id} "${s.title}"`).join('; ') || 'none'}.

Write scene ${scene.id} from this storyboard entry:
${JSON.stringify(scene, null, 1)}`;
}

export function editRequest(sceneJson: string, instruction: string): string {
  return `Here is a scene in the animation format:
${sceneJson}

Change it as follows, keeping everything else as it is (same narration lines, same ids where elements stay): ${instruction}

Answer with the complete modified scene JSON only.`;
}

export function repairRequest(issues: { path: string; message: string }[]): string {
  return `That JSON has problems:
${issues.slice(0, 20).map((i) => `- ${i.path}: ${i.message}`).join('\n')}
Return the corrected complete JSON only.`;
}
