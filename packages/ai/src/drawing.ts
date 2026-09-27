// Drawing what a story needs: every character, prop and decor is drawn by the model as vector data (an Asset, see
// @af/schema), checked (format, size, feet on the ground, the poses and expressions scenes rely on), then looked
// at: the server renders a sheet of it and the model, if it can see images, reviews its own drawing and corrects
// it (two rounds at most). A drawing that cannot be made valid is replaced by a plain one, and flagged.
import { assetBounds } from '@af/engine';
import type { ChatImage } from '@af/providers';
import { Asset, parseProject, type Asset as AssetT, type Issue, type ProjectInput } from '@af/schema';
import { z } from 'zod';
import { exampleCharacter, exampleDecor, exampleProp } from './examples';
import { extractJson } from './json';
import { ModelError, ask, zIssues, type Check, type Model, type OnStep } from './ask';
import { previewProject, PREVIEW_TIME } from './preview';

export type AssetKind = AssetT['kind'];
/** what to draw: from the storyboard (or an edit), in the story's words */
export interface AssetBrief { id: string; kind: AssetKind; name: string; description: string }
export interface DrawContext {
  title: string;
  style: string;
  /** the film's colours, shared by every drawing */
  palette?: string[] | undefined;
  /** the other things drawn for the film (for consistency) */
  others?: AssetBrief[] | undefined;
}
export interface DrawOptions {
  /** renders a project to a PNG (base64), for the visual review; without it, drawings are only checked as data */
  preview?: ((project: ProjectInput) => Promise<string>) | undefined;
  /** rounds of visual review (default 2) */
  reviewRounds?: number | undefined;
  /** shared between drawings of a job: set when the model turns out not to read images */
  vision?: { unavailable?: string } | undefined;
  onStep?: OnStep | undefined;
  /** paints a decor as a picture with an image model (the "images" task); without it, decors stay vector drawings */
  paint?: ((b: AssetBrief, prompt: string) => Promise<Picture>) | undefined;
}
export type Picture = { ok: true; image: NonNullable<AssetT['image']> } | { ok: false; error: string };
export interface AssetResult { id: string; asset: AssetT; fallback: boolean; rounds: number; issues: Issue[]; review: string[] }

const PAINT_STYLE: Record<string, string> = {
  watercolor: 'soft watercolour on textured paper, transparent washes, gentle ink outlines, calm light',
  flat: 'flat vector illustration, clean solid shapes, crisp edges, simple shading, no texture',
};
/** what an image model is asked for a decor: a stage to act on, in the film's style and colours, empty of people */
export function picturePrompt(b: Pick<AssetBrief, 'name' | 'description'>, c: Pick<DrawContext, 'style' | 'palette'>): string {
  return [
    `Background painting for a 2D animated explainer film: ${b.name}. ${b.description}`,
    `Style: ${PAINT_STYLE[c.style] ?? c.style}.${c.palette?.length ? ` Colour palette: ${c.palette.join(', ')}.` : ''}`,
    'Wide landscape picture, seen from the front at eye level, like a theatre stage. The ground where characters will stand is flat and level and fills the bottom third. Keep the centre uncluttered: characters and objects are added over it later.',
    'No people, no animals, no characters, no text, no letters, no logo, no signature, no frame or border.',
  ].join('\n');
}

export const REQUIRED = {
  poses: ['idle', 'walk', 'talk', 'point', 'wave'],
  expressions: ['neutral', 'happy', 'sad', 'surprised'],
} as const;
const LIMITS = { shapes: 400, points: 40_000 };

const assetSchema = () => z.toJSONSchema(Asset, { io: 'input' }) as Record<string, unknown>;
const compact = (v: unknown) => JSON.stringify(v);

// ---------- what the model is told ----------
const FORMAT = `FORMAT (JSON)
{ "kind", "name", "description", "background"?, "parts": [...], "poses": {...}, "expressions": {...} }
- part: { "id", "parent"?, "pivot": [x, y], "group"?, "variant"?, "shapes": [...] }. Parts are drawn in list order (first = furthest back). A part with a "parent" follows it when the parent turns; "pivot" is the point it turns around, in drawing coordinates at rest.
- shapes:
  { "type": "path", "d": "<SVG path data: M L H V C S Q T A Z>" } or { "type": "path", "points": [[x, y], …] }, with "closed" (default true), "smooth", "width" (open paths only: a thick stroke with round ends, for limbs, stems, hair, cables), "fill", "stroke", "strokeWidth", "opacity", "role" ("detail": small features; "shade": soft shading, no outline)
  { "type": "ellipse", "cx", "cy", "rx", "ry", … }  { "type": "rect", "x", "y", "w", "h", "r", … }
  { "type": "glow", "x", "y", "radius", "color", "opacity" } (soft light)  { "type": "gradient", "x", "y", "w", "h", "stops": [[0, "#…"], [1, "#…"]] } (vertical)
  { "type": "text", "x", "y", "text", "size", "color", "font": "display" | "body" | "marker" | "hand" } (only for lettering that belongs to the object)
  Colours are "#rrggbb".
- "poses": { "<pose>": { "<part id>": { "rot", "swing", "speed", "phase", "spin", "dx", "dy", "bounce" } } } — rot: degrees (positive = clockwise on screen); swing: degrees of back-and-forth around rot, at "speed" cycles per second, "phase" 0–1 shifts it; spin: continuous turn in degrees per second; dx, dy: shift in px; bounce: px up and down, twice per cycle. A pose lists only the parts it moves. "idle" is the default pose.
- "expressions": { "<expression>": { "<group>": "<variant>" } } — parts sharing a "group" are alternatives; an expression shows one variant per group ("neutral" is the default, its choices apply under every other expression).`;

const STYLE = `STYLE: clean, friendly and readable at a glance, as in a good explainer film: bold simple shapes, a clear silhouette, a few colours taken from the film's palette, 15 to 120 shapes. No outlines needed (the renderer adds its own). Avoid tiny details and text.`;

const KIND_RULES: Record<AssetKind, string> = {
  character: `A CHARACTER.
COORDINATES: origin (0, 0) between the feet, on the ground; y grows downwards, so the body is at negative y. A standing adult is about 340 px tall (a child about 250); animals and creatures in proportion to that. The character faces right (+x); the engine mirrors it to face left.
RIG: a root part (hips or body), everything else hanging from it: torso → head → face parts; each limb segment is its own part whose pivot is its joint (shoulder, elbow, hip, knee…) and whose rest shape hangs straight down from that joint, so rotations look natural; hands or paws belong to the lower segment. Far limbs come before the body in the list, near limbs after it. Faces: an "eyes" group and a "mouth" group, each with several variants (open, closed, wide…; flat, smile, open, sad…).
REQUIRED POSES: ${REQUIRED.poses.join(', ')} — idle: gentle breathing (small swings on torso and head); walk: legs swinging in opposite phases (speed about 1.6), arms opposite to the legs, a small bounce on the root; talk: the head moving a little, a hand gesturing; point: the near arm straight ahead (about -85°); wave: the near arm raised (about -135°), the hand swinging. Add any other pose the story needs (sit, run, jump, fly, think, cheer…).
REQUIRED EXPRESSIONS: ${REQUIRED.expressions.join(', ')}, plus any the story needs.
Non-human characters (animals, robots, talking objects) follow the same ideas with their own anatomy; a flying one hovers above its origin.`,
  prop: `A PROP (an object placed in scenes).
COORDINATES: origin (0, 0) at the bottom centre, where it rests on the ground (or where it hangs, for a hanging object); y grows downwards. Size in px as it should look next to a 340-px adult. Parts that move (wheels, blades, flames, leaves, a screen that blinks) move in the "idle" pose: "spin" for wheels, "swing" for the rest. Poses and expressions are optional.`,
  decor: `A DECOR (the background of a scene).
COORDINATES: a 1920 × 1080 frame, y downwards. Draw 300 px beyond it on every side (x from -300 to 2220, y from -300 to 1380): the camera moves. Layers from back to front: sky or far wall (a gradient), far, middle, near. Characters stand on the ground around y = 900: keep a clear floor there, and the middle of the frame calm (characters and captions go on top). Set "background" to the colour of the ground. Things that move slightly (clouds, water, leaves, a windmill) move in the "idle" pose; everything else stays still.`,
};
const EXAMPLE: Record<AssetKind, unknown> = { character: exampleCharacter, prop: exampleProp, decor: exampleDecor };

export function drawPrompt(kind: AssetKind): string {
  return `You draw for a 2D animated explainer film, as vector data. The engine renders your drawing in the film's style (flat vector or watercolour) and animates it with the poses you define. Answer with the drawing JSON only.

${FORMAT}

${KIND_RULES[kind]}

${STYLE}

EXAMPLE of a good ${kind} (a different subject; follow its structure, not its content):
${compact(EXAMPLE[kind])}`;
}

export function drawRequest(b: AssetBrief, c: DrawContext, instruction?: string): string {
  const others = (c.others ?? []).filter((o) => o.id !== b.id).map((o) => `${o.kind} "${o.name}": ${o.description}`).slice(0, 20);
  return `Film: ${c.title}. Style: ${c.style}.${c.palette?.length ? ` Palette: ${c.palette.join(', ')}.` : ''}
${others.length ? `Also drawn for this film (keep them consistent): ${others.join(' | ')}\n` : ''}
Draw the ${b.kind} "${b.name}" (id "${b.id}"): ${b.description}${instruction ? `\n\nChange requested: ${instruction}` : ''}`;
}

const SHEET: Record<AssetKind, string> = {
  character: 'The image shows it four times, left to right: pose idle with expression neutral, walk + happy, point + surprised, wave + sad (the last one mirrored, facing left). The labels under them name the pose and expression.',
  prop: 'The image shows it on the right, next to a faded 355-px person on the left for scale.',
  decor: 'The image shows it as the camera frames a scene (1920 × 1080), with nothing in front.',
};
export const REVIEW_PROMPT = `You review a drawing made for an animated explainer film, as it renders. You get the image and the drawing's JSON.
Check: does it look like what was asked, recognisable at a glance? Are parts attached where they belong (no floating limbs, head on the neck, hands at the ends of the arms)? Proportions, a readable face, poses and expressions that look right, nothing cut off, misplaced or hidden behind another part, colours that fit the film?
Answer JSON only: { "ok": true } when it is good enough for the film; otherwise { "ok": false, "problems": ["…", …], "asset": <the complete corrected drawing JSON> }.`;

const Review = z.object({ ok: z.boolean(), problems: z.array(z.string()).max(20).default([]), asset: z.unknown().optional() });

// ---------- checks ----------
/** valid as data, of the right kind, and usable in a film: size, feet on the ground, the poses scenes rely on */
export function checkAsset(b: AssetBrief): Check<AssetT> {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet JSON (le dessin) est attendu' }] };
    const input = { name: b.name, description: b.description, ...(v as Record<string, unknown>), kind: b.kind };
    const r = Asset.safeParse(input);
    if (!r.success) return { ok: false, issues: zIssues(r.error) };
    const a = r.data, box = assetBounds(a), issues: Issue[] = [];
    if (box.shapes > LIMITS.shapes || box.points > LIMITS.points) issues.push({ path: 'parts', message: `trop détaillé (${box.shapes} formes, ${box.points} points ; ${LIMITS.shapes} formes au plus)` });
    if (!box.shapes) issues.push({ path: 'parts', message: 'aucune forme' });
    if (b.kind === 'character') {
      if (box.h < 120 || box.h > 700) issues.push({ path: 'parts', message: `hauteur ${Math.round(box.h)} px : un adulte debout mesure environ 340 px` });
      if (Math.abs(box.y + box.h) > 30) issues.push({ path: 'parts', message: `le bas du personnage est à y = ${Math.round(box.y + box.h)} : les pieds doivent toucher y = 0 (l'origine est entre les pieds)` });
      if (Math.abs(box.x + box.w / 2) > 150) issues.push({ path: 'parts', message: `le personnage est décalé (centre à x = ${Math.round(box.x + box.w / 2)}) : il doit être centré sur x = 0` });
      for (const p of REQUIRED.poses) if (p !== 'idle' && !a.poses[p]) issues.push({ path: `poses.${p}`, message: `pose « ${p} » manquante` });
      for (const e of REQUIRED.expressions) if (e !== 'neutral' && !a.expressions[e]) issues.push({ path: `expressions.${e}`, message: `expression « ${e} » manquante` });
      const groups = new Map<string, Set<string>>();
      for (const p of a.parts) if (p.group && p.variant) { if (!groups.has(p.group)) groups.set(p.group, new Set()); groups.get(p.group)!.add(p.variant); }
      if (![...groups.values()].some((s) => s.size >= 2)) issues.push({ path: 'parts', message: 'le visage doit changer avec les expressions : un groupe (mouth, eyes…) avec au moins deux variantes' });
    } else if (b.kind === 'prop') {
      if (box.h < 8 || box.h > 1400 || box.w > 2400) issues.push({ path: 'parts', message: `taille ${Math.round(box.w)} × ${Math.round(box.h)} px : à l'échelle d'une personne de 340 px` });
      // resting on the ground (bottom at y = 0) or hanging (top at y = 0)
      if (Math.abs(box.y + box.h) > 40 && Math.abs(box.y) > 40) issues.push({ path: 'parts', message: `l'objet va de y = ${Math.round(box.y)} à y = ${Math.round(box.y + box.h)} : l'origine est en bas au centre (y = 0), ou en haut pour un objet suspendu` });
    } else {
      if (box.x > 0 || box.y > 0 || box.x + box.w < 1920 || box.y + box.h < 1080) issues.push({ path: 'parts', message: `le décor ne couvre pas l'image (de ${Math.round(box.x)}, ${Math.round(box.y)} à ${Math.round(box.x + box.w)}, ${Math.round(box.y + box.h)}) : il doit aller de -300, -300 à 2220, 1380` });
      if (a.parts.length < 3) issues.push({ path: 'parts', message: 'un décor a plusieurs plans (ciel, lointain, sol…)' });
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: a };
  };
}

// ---------- plain drawings, when the model cannot make one ----------
const hashOf = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const pick = (list: string[] | undefined, fallback: string[], seed: number, k: number) => { const l = list?.length ? list : fallback; return l[(seed + k * 7) % l.length]!; };

/** a simple drawing that is always valid, coloured from the palette, flagged as a fallback */
export function fallbackAsset(b: AssetBrief, palette?: string[]): AssetT {
  const seed = hashOf(b.id), base = ['#E07A5F', '#3D405B', '#81B29A', '#F2CC8F', '#6D597A', '#2A9D8F'];
  let input: unknown;
  if (b.kind === 'character') {
    const top = pick(palette, base, seed, 0), bottom = pick(palette, base, seed, 1);
    input = JSON.parse(JSON.stringify(exampleCharacter).replaceAll('#E07A5F', top).replaceAll('#3D405B', bottom));
  } else if (b.kind === 'prop') {
    const c = pick(palette, base, seed, 2);
    input = { kind: 'prop', parts: [{ id: 'box', shapes: [{ type: 'rect', x: -90, y: -120, w: 180, h: 120, r: 16, fill: c }, { type: 'text', x: 0, y: -52, text: b.name.slice(0, 18), size: 26, color: '#FFFFFF', font: 'body' }] }] };
  } else {
    const sky = pick(palette, ['#BFD9E6'], seed, 3), ground = pick(palette, ['#8CC084'], seed, 4);
    input = { kind: 'decor', background: ground, parts: [{ id: 'sky', shapes: [{ type: 'gradient', x: -300, y: -300, w: 2520, h: 1200, stops: [[0, sky], [1, '#FFFFFF']] }] }, { id: 'hills', shapes: [{ type: 'path', d: 'M -300 820 Q 500 700 1100 800 Q 1700 720 2220 790 L 2220 1380 L -300 1380 Z', fill: ground, opacity: 0.6 }] }, { id: 'ground', shapes: [{ type: 'rect', x: -300, y: 880, w: 2520, h: 500, fill: ground }] }] };
  }
  return Asset.parse({ ...(input as object), kind: b.kind, name: b.name, description: b.description, made: { by: 'dessin de secours', rounds: 0 } });
}

// ---------- drawing, then looking at it ----------
export async function drawOne(model: Model, b: AssetBrief, c: DrawContext, o: DrawOptions = {}, instruction?: string, current?: AssetT): Promise<AssetResult> {
  // a decor painted as a picture: its vector drawing is only what shows until the picture loads (no visual review)
  if (b.kind === 'decor' && o.paint) {
    const t0 = Date.now(), pic = await o.paint(b, picturePrompt({ name: b.name, description: instruction ? `${b.description} ${instruction}` : b.description }, c));
    (o.onStep ?? (() => undefined))({ stage: 'picture', target: b.id, attempt: 0, ok: pic.ok, issues: pic.ok ? [] : [{ path: 'image', message: pic.error }], usage: { inputTokens: 0, outputTokens: 0 }, ms: Date.now() - t0 });
    const r = await drawOne(model, b, c, { ...o, paint: undefined, ...(pic.ok ? { reviewRounds: 0 } : {}) }, instruction, current);
    if (!pic.ok) return { ...r, review: [...r.review, `pas d'image : ${pic.error}`] };
    return { ...r, asset: { ...r.asset, image: pic.image }, review: [...r.review, 'peint en image'] };
  }
  const onStep = o.onStep ?? (() => undefined), check = checkAsset(b);
  const first = current ? `${drawRequest(b, c, instruction)}\n\nThe current drawing, to change:\n${compact(current)}` : drawRequest(b, c, instruction);
  const { value, issues } = await ask(model, drawPrompt(b.kind), first, { name: 'drawing', schema: assetSchema() }, check, 'asset', b.id, onStep, 16_000);
  if (!value) return { id: b.id, asset: fallbackAsset(b, c.palette), fallback: true, rounds: 0, issues, review: [] };
  let asset = value, rounds = 0;
  const review: string[] = [];
  const maxRounds = o.reviewRounds ?? 2;
  for (let r = 0; r < maxRounds && o.preview && !o.vision?.unavailable; r++) {
    let png: string;
    try { png = await o.preview(previewProject(b.id, asset, c.style === 'watercolor' ? 'flat' : c.style)); }
    catch (e) { review.push(`aperçu impossible : ${(e as Error).message}`); break; }
    const images: ChatImage[] = [{ mediaType: 'image/png', data: png }];
    const t0 = Date.now();
    const res = await model.call({ system: REVIEW_PROMPT, messages: [{ role: 'user', content: `${drawRequest(b, c, instruction)}\n\n${SHEET[b.kind]} (Rendered at t = ${PREVIEW_TIME} s.)\n\nThe drawing:\n${compact(asset)}`, images }], json: { name: 'review', schema: z.toJSONSchema(Review, { io: 'input' }) as Record<string, unknown> }, maxTokens: 16_000 });
    if (!res.ok) {
      // most often a model that does not take images: stop looking for the rest of the job
      if (res.status && res.status >= 400 && res.status < 500) { if (o.vision) o.vision.unavailable = res.error; review.push(`pas de relecture visuelle : ${res.error}`); }
      else review.push(`relecture interrompue : ${res.error}`);
      onStep({ stage: 'review', target: b.id, attempt: r, ok: false, issues: [{ path: 'relecture', message: res.error }], usage: { inputTokens: 0, outputTokens: 0 }, ms: Date.now() - t0 });
      break;
    }
    let verdict: z.output<typeof Review> | null = null;
    try { const p = Review.safeParse(extractJson(res.text)); if (p.success) verdict = p.data; } catch { /* unreadable review: keep the drawing */ }
    const fixed = verdict && !verdict.ok && verdict.asset ? check(verdict.asset) : null;
    onStep({ stage: 'review', target: b.id, attempt: r, ok: !!verdict?.ok, issues: (verdict?.problems ?? []).map((m) => ({ path: 'relecture', message: m })), usage: res.usage, ms: Date.now() - t0 });
    rounds = r + 1;
    if (!verdict || verdict.ok) { if (verdict?.ok) review.push('relu : bon'); break; }
    review.push(...verdict.problems);
    if (!fixed?.ok) break; // the correction does not hold: keep the version that did
    asset = fixed.value;
  }
  return { id: b.id, asset: { ...asset, made: { by: model.label, rounds, at: new Date().toISOString() } }, fallback: false, rounds, issues: [], review };
}

/** everything a storyboard needs, a few drawings at a time */
export async function drawAll(model: Model, briefs: AssetBrief[], c: DrawContext, o: DrawOptions & { concurrency?: number; signal?: AbortSignal; onAsset?: (r: AssetResult) => void } = {}): Promise<AssetResult[]> {
  const out: AssetResult[] = new Array(briefs.length), shared = { ...o, vision: o.vision ?? {} };
  let next = 0;
  const worker = async () => {
    while (next < briefs.length) {
      if (o.signal?.aborted) throw new ModelError('génération annulée');
      const i = next++, r = await drawOne(model, briefs[i]!, { ...c, others: briefs }, shared);
      out[i] = r; o.onAsset?.(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, briefs.length)) }, worker));
  return out;
}

/** a drawing is valid inside a project too (the cheapest full check: through the project schema) */
export const assetFitsProject = (id: string, a: AssetT) => parseProject({ schemaVersion: 1, title: 'x', scenes: [{ id: 's', decor: { kind: 'plain' } }], assets: { [id]: a } }).ok;
