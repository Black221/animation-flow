// evaluate(project, registry, t) → Frame: everything a style pack needs to draw the image at time t, in screen pixels.
//
// Order of work: find the scene, sample the camera, place every visible element (sampled keys → component primitives
// in local space → element transform → camera), cull what falls outside the frame (a style may be expensive per
// shape: the watercolour one layers several washes), then sort back to front. The still part of the decor is passed
// in world space with a cache key, so a style paints it once per scene (a "plate") and only moves it with the camera.
import { assetExpressions, assetPoses, type Element, type Project, type Scene } from '@af/schema';
import { registryFor } from './assets';
import { sampleCamera, sampleElement, type CameraSample } from './animate';
import type { ComponentFn, DecorOut, Registry } from './components';
import { apply, bounds, mul, rotationOf, scaleM, scaleOf, translate, trs, rotate, type Mat } from './geometry';
import { hashString, seg } from './math';
import { primBox, primsBox } from './boxes';
import type { Prim } from './primitives';
import { sceneAt, timeProject, type Timeline, type TimedScene } from './timing';

export interface FrameDecor {
  /** stable key of the still part: same decor, same key, so the painted plate can be reused */
  key: string;
  bounds: DecorOut['bounds'];
  still: Prim[];
  /** highest camera zoom in the scene: paint the plate at this resolution so it stays sharp */
  maxZoom: number;
}

export interface Frame {
  width: number;
  height: number;
  /** project time (s) */
  time: number;
  sceneId: string;
  sceneIndex: number;
  /** time since the scene started (s) */
  sceneTime: number;
  camera: CameraSample;
  /** world → screen */
  view: Mat;
  decor: FrameDecor | null;
  /** screen-space primitives, back to front */
  items: Prim[];
  /** 0 = none … 1 = black, for fade transitions */
  fade: number;
  subtitle: { speaker: string; text: string } | null;
  /** the cast id of who speaks now (null: the narrator, or silence) */
  speakerId: string | null;
  /** where the characters and props of the world are on screen: what a reframed output follows */
  subjects: Subject[];
  /** changes 8 times a second: styles re-seed hand-drawn wobble on it ("boil") */
  boil: number;
}

export interface Subject { id: string; type: 'character' | 'prop'; ref: string | null; x0: number; y0: number; x1: number; y1: number }

const FADE = 0.5;
const CULL_PAD = 60;

export function viewMatrix(cam: CameraSample, width: number, height: number): Mat {
  return mul(mul(mul(translate(width / 2, height / 2), rotate(-cam.rotation)), scaleM(cam.zoom)), translate(-cam.x, -cam.y));
}

// letters are never mirrored: under a flip (a character facing left) keep the rotation of the unflipped axis
const textRotation = (m: Mat) => (m[0] * m[3] - m[1] * m[2] < 0 ? Math.atan2(-m[1], -m[0]) : rotationOf(m));

/** Map a primitive through a matrix: stroke widths, font sizes and glow radii follow the matrix's scale. */
export function transformPrim(p: Prim, m: Mat, opacity = 1): Prim {
  const s = scaleOf(m);
  switch (p.kind) {
    case 'path': {
      const q = { ...p, points: p.points.map((pt) => apply(m, pt)), opacity: (p.opacity ?? 1) * opacity };
      if (p.strokeWidth != null) q.strokeWidth = p.strokeWidth * s;
      if (p.width != null) q.width = p.width * s;
      return q;
    }
    case 'text': { const [x, y] = apply(m, [p.x, p.y]); return { ...p, x, y, size: p.size * s, rotation: p.rotation + textRotation(m), opacity: p.opacity * opacity }; }
    case 'glow': { const [x, y] = apply(m, [p.x, p.y]); return { ...p, x, y, radius: p.radius * s, opacity: p.opacity * opacity }; }
    case 'image':
      // a picture that turns or flips keeps its matrix; an upright one stays a plain box
      if (p.matrix || Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9 || m[0] < 0 || m[3] < 0) return { ...p, matrix: mul(m, p.matrix ?? [1, 0, 0, 1, 0, 0]), opacity: (p.opacity ?? 1) * opacity };
    // falls through
    case 'gradient': {
      const c = [apply(m, [p.x, p.y]), apply(m, [p.x + p.w, p.y + p.h])], b = bounds(c);
      return { ...p, x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, opacity: (p.opacity ?? 1) * opacity };
    }
  }
}

function visibleBox(p: Prim, w: number, h: number): boolean {
  let x0: number, y0: number, x1: number, y1: number;
  if (p.kind === 'path') { const b = bounds(p.points), pad = (p.width ?? 0) / 2 + (p.strokeWidth ?? 0); x0 = b.x0 - pad; y0 = b.y0 - pad; x1 = b.x1 + pad; y1 = b.y1 + pad; }
  else if (p.kind === 'text') { const half = (p.text.length * p.size) / 2; x0 = p.x - half; x1 = p.x + half; y0 = p.y - p.size * 2; y1 = p.y + p.size * 2; }
  else if (p.kind === 'glow') { x0 = p.x - p.radius; x1 = p.x + p.radius; y0 = p.y - p.radius; y1 = p.y + p.radius; }
  else ({ x0, y0, x1, y1 } = primBox(p));
  return !(x1 < -CULL_PAD || x0 > w + CULL_PAD || y1 < -CULL_PAD || y0 > h + CULL_PAD);
}

/** drawn for a component the registry does not know, so a project with a typo still renders and shows where */
const placeholder: ComponentFn = ({ id, params }) => [
  { kind: 'path', id: id + ':box', points: [[-60, -140], [60, -140], [60, 0], [-60, 0]], closed: true, fill: '#EEE3D0', stroke: '#C8553D', strokeWidth: 3 },
  { kind: 'text', id: id + ':q', x: 0, y: -70, text: `? ${String(params.__missing ?? '')}`, size: 26, color: '#C8553D', font: 'body', weight: 600, align: 'center', rotation: 0, opacity: 1 },
];

/** the project's own drawing an element shows, if it is one */
function assetOf(project: Project, e: Element) {
  if (e.type === 'character') { const c = e.ref ? project.cast[e.ref] : undefined; return c ? project.assets?.[c.kind] : undefined; }
  return e.type === 'prop' && e.ref ? project.assets?.[e.ref] : undefined;
}

export function componentFor(project: Project, base: Registry, e: Element): { fn: ComponentFn; params: Record<string, unknown> } {
  const reg = registryFor(project, base);
  if (e.type === 'text') return { fn: reg.text, params: e.params };
  if (e.type === 'character') {
    const c = e.ref ? project.cast[e.ref] : undefined, fn = c ? reg.characters[c.kind] : undefined;
    return fn ? { fn, params: { ...c!.params, ...e.params } } : { fn: placeholder, params: { __missing: c?.kind ?? e.ref } };
  }
  const fn = e.ref ? reg.props[e.ref] : undefined;
  return fn ? { fn, params: e.params } : { fn: placeholder, params: { __missing: e.ref } };
}

// decors are pure functions of their parameters: keep the last few so the still part is built once per scene
const decorCache = new Map<string, DecorOut>();
/** a drawing's fingerprint: an edited decor must not come back from the cache */
const drawnHash = new WeakMap<object, string>();
const hashOf = (a: object) => { let h = drawnHash.get(a); if (!h) { h = hashString(JSON.stringify(a)).toString(36); drawnHash.set(a, h); } return h; };
function decorOf(project: Project, base: Registry, scene: Scene): { key: string; out: DecorOut } | null {
  const reg = registryFor(project, base), fn = reg.decors[scene.decor.kind];
  if (!fn) return null;
  const drawn = project.assets?.[scene.decor.kind];
  const key = `${scene.decor.kind}:${drawn ? hashOf(drawn) : ''}:${hashString(JSON.stringify(scene.decor.params)).toString(36)}:${project.width}x${project.height}`;
  let out = decorCache.get(key);
  if (!out) {
    out = fn({ params: scene.decor.params, width: project.width, height: project.height, id: 'decor' });
    decorCache.set(key, out);
    if (decorCache.size > 24) decorCache.delete(decorCache.keys().next().value!);
  }
  return { key, out };
}

export interface Evaluator { timeline: Timeline; frameAt: (t: number) => Frame }

/** Resolve the timeline once, then evaluate frames cheaply. */
export function createEvaluator(project: Project, base: Registry): Evaluator {
  const reg = registryFor(project, base);
  const timeline = timeProject(project);
  const zooms = project.scenes.map((s) => Math.max(1, ...s.camera.map((k) => k.zoom ?? 1)));
  const frameAt = (time: number): Frame => {
    const t = Math.max(0, Math.min(time, Math.max(0, timeline.duration - 1e-6)));
    const ts: TimedScene = sceneAt(timeline, t), scene = project.scenes[ts.index]!, st = t - ts.start, at = ts.at;
    const { width: W, height: H } = project;
    const cam = sampleCamera(scene.camera, st, at, W, H), view = viewMatrix(cam, W, H);
    const items: { layer: number; order: number; prims: Prim[] }[] = [], subjects: Subject[] = [];

    const d = decorOf(project, reg, scene);
    if (d?.out.live) items.push({ layer: -1e9, order: 0, prims: d.out.live(st).map((p) => transformPrim(p, view)).filter((p) => visibleBox(p, W, H)) });

    scene.elements.forEach((e, order) => {
      const t0 = at(e.enter, 0), t1 = at(e.exit, Infinity);
      if (st < t0 || st >= t1) return;
      const s = sampleElement(e.keys, st, at);
      if (s.opacity <= 0.001) return;
      const { fn, params } = componentFor(project, reg, e);
      const local = fn({ t: st, local: st - t0, id: e.id, params, state: { pose: s.pose, expression: s.expression, facing: s.facing, text: s.text } });
      // a drawing that must not be mirrored (a picture with writing on it) keeps facing the way it was made
      const facing = assetOf(project, e)?.flip === false ? 1 : s.facing;
      const screen = e.space === 'screen', m = mul(screen ? [1, 0, 0, 1, 0, 0] : view, trs(s.x, s.y, s.rotation, s.scale * facing, s.scale));
      const prims = local.map((p) => (screen ? { ...transformPrim(p, m, s.opacity), overlay: e.id } : transformPrim(p, m, s.opacity))).filter((p) => visibleBox(p, W, H));
      items.push({ layer: e.layer, order: order + 1, prims });
      if (!screen && e.type !== 'text' && prims.length) { const b = primsBox(prims); subjects.push({ id: e.id, type: e.type, ref: e.ref ?? null, ...b }); }
    });
    items.sort((a, b) => a.layer - b.layer || a.order - b.order);

    const next = project.scenes[ts.index + 1];
    const fadeIn = scene.transition === 'fade' ? 1 - seg(st, 0, FADE) : 0;
    const fadeOut = next?.transition === 'fade' ? seg(st, ts.duration - FADE, ts.duration) : 0;
    const line = ts.lines.find((l) => st >= l.start && st < l.end);
    const speaker = line ? (line.speaker === 'narrator' ? '' : project.cast[line.speaker]?.name ?? line.speaker) : '';
    return {
      width: W, height: H, time: t, sceneId: scene.id, sceneIndex: ts.index, sceneTime: st, camera: cam, view,
      decor: d ? { key: d.key, bounds: d.out.bounds, still: d.out.still, maxZoom: Math.min(2, zooms[ts.index]!) } : null,
      items: items.flatMap((i) => i.prims),
      fade: Math.max(fadeIn, fadeOut),
      subtitle: line ? { speaker, text: line.text } : null,
      speakerId: line && line.speaker !== 'narrator' ? line.speaker : null,
      subjects,
      boil: Math.floor(st * 8),
    };
  };
  return { timeline, frameAt };
}

export interface Warning { path: string; message: string }
/** What the schema cannot know: kinds, decors, poses and expressions the library does not provide. */
export function checkAgainstLibrary(project: Project, base: Registry, libraryCatalog?: { characters: { kind: string; poses: string[]; expressions: string[] }[] }): Warning[] {
  const out: Warning[] = [], reg = registryFor(project, base), assets = project.assets ?? {};
  // the project's drawings: right kind of drawing for the use, and their own poses and expressions
  const catalog = libraryCatalog && { characters: [...libraryCatalog.characters, ...Object.entries(assets).filter(([, a]) => a.kind === 'character').map(([kind, a]) => ({ kind, poses: assetPoses(a), expressions: assetExpressions(a) }))] };
  const wrong = (id: string, want: string, path: string, what: string) => { const a = assets[id]; if (a && a.kind !== want) out.push({ path, message: `« ${id} » est un dessin de type ${a.kind}, pas ${what}` }); };
  for (const [id, c] of Object.entries(project.cast)) wrong(c.kind, 'character', `cast.${id}.kind`, 'un personnage');
  project.scenes.forEach((s, si) => {
    wrong(s.decor.kind, 'decor', `scenes.${si}.decor.kind`, 'un décor');
    s.elements.forEach((e, ei) => { if (e.type === 'prop' && e.ref) wrong(e.ref, 'prop', `scenes.${si}.elements.${ei}.ref`, 'un accessoire'); });
  });
  for (const [id, c] of Object.entries(project.cast)) if (!reg.characters[c.kind]) out.push({ path: `cast.${id}.kind`, message: `type de personnage « ${c.kind} » inconnu de la bibliothèque` });
  project.scenes.forEach((s, si) => {
    if (!reg.decors[s.decor.kind]) out.push({ path: `scenes.${si}.decor.kind`, message: `décor « ${s.decor.kind} » inconnu de la bibliothèque` });
    s.elements.forEach((e, ei) => {
      if (e.type === 'prop' && e.ref && !reg.props[e.ref]) out.push({ path: `scenes.${si}.elements.${ei}.ref`, message: `accessoire « ${e.ref} » inconnu de la bibliothèque` });
      if (e.type !== 'character' || !catalog) return;
      const kind = e.ref ? project.cast[e.ref]?.kind : undefined, info = catalog.characters.find((c) => c.kind === kind);
      if (!info) return;
      e.keys.forEach((k, ki) => {
        if (k.pose && !info.poses.includes(k.pose)) out.push({ path: `scenes.${si}.elements.${ei}.keys.${ki}.pose`, message: `pose « ${k.pose} » inconnue pour « ${kind} » (${info.poses.join(', ')})` });
        if (k.expression && !info.expressions.includes(k.expression)) out.push({ path: `scenes.${si}.elements.${ei}.keys.${ki}.expression`, message: `expression « ${k.expression} » inconnue pour « ${kind} » (${info.expressions.join(', ')})` });
      });
    });
  });
  return out;
}
