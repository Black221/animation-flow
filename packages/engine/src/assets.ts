// Drawings made for a project (`project.assets`, see @af/schema): turned into components and decors the engine
// draws like the library's, in every style. A character's parts turn around their pivots as its pose says (with
// swings for walk cycles, waving, breathing), and its expression picks one variant per group (mouth, eyes…).
import type { Asset, AssetMotion, AssetPart, AssetShape, Project } from '@af/schema';
import type { ComponentFn, DecorFn, Registry } from './components';
import { apply, ellipse, mul, roundRect, scaleOf, type Mat, type Pt } from './geometry';
import type { Prim } from './primitives';

const I: Mat = [1, 0, 0, 1, 0, 0];
/** turn by `deg` around (px, py), then shift by (dx, dy) */
const turnAbout = (deg: number, px: number, py: number, dx: number, dy: number): Mat => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, px - c * px + s * py + dx, py - s * px - c * py + dy];
};

// ---------- SVG path data → point lists ----------
const CURVE_STEPS = 12;
/** every subpath of an SVG `d` attribute as points (curves and arcs sampled); bad data ends the path where it is */
export function pathPoints(d: string): { points: Pt[]; closed: boolean }[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: { points: Pt[]; closed: boolean }[] = [];
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0], pts: Pt[] = [], lastCtrl: Pt | null = null, lastQ: Pt | null = null;
  const num = () => { const v = Number(toks[i++]); if (!Number.isFinite(v)) throw new Error('nombre attendu'); return v; };
  const more = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]!);
  const flush = (closed: boolean) => { if (pts.length > 1) out.push({ points: pts, closed }); pts = []; };
  const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => { for (let k = 1; k <= CURVE_STEPS; k++) { const t = k / CURVE_STEPS, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
  const quad = (p0: Pt, p1: Pt, p2: Pt) => { for (let k = 1; k <= CURVE_STEPS; k++) { const t = k / CURVE_STEPS, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); } };
  const arc = (p0: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p1: Pt) => {
    // SVG endpoint → centre parameterisation (SVG 1.1, F.6.5)
    if (!rx || !ry) { pts.push(p1); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sign = large === sweep ? -1 : 1;
    const co = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
    const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2, cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * CURVE_STEPS / 2));
    for (let k = 1; k <= n; k++) { const t = t1 + (dt * k) / n; pts.push([cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp]); }
  };
  try {
    while (i < toks.length) {
      if (/^[a-zA-Z]$/.test(toks[i]!)) cmd = toks[i++]!;
      else if (!cmd) throw new Error('commande attendue');
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const at = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
      if (C === 'Z') { cur = start; flush(true); lastCtrl = lastQ = null; if (!more()) continue; }
      do {
        if (C === 'M') { flush(false); cur = at(num(), num()); start = cur; pts = [cur]; cmd = rel ? 'l' : 'L'; lastCtrl = lastQ = null; break; }
        if (C === 'L') { cur = at(num(), num()); pts.push(cur); lastCtrl = lastQ = null; }
        else if (C === 'H') { const x = num(); cur = [rel ? cur[0] + x : x, cur[1]]; pts.push(cur); lastCtrl = lastQ = null; }
        else if (C === 'V') { const y = num(); cur = [cur[0], rel ? cur[1] + y : y]; pts.push(cur); lastCtrl = lastQ = null; }
        else if (C === 'C') { const p1 = at(num(), num()), p2 = at(num(), num()), p3 = at(num(), num()); cubic(cur, p1, p2, p3); lastCtrl = p2; lastQ = null; cur = p3; }
        else if (C === 'S') { const p1: Pt = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur, p2 = at(num(), num()), p3 = at(num(), num()); cubic(cur, p1, p2, p3); lastCtrl = p2; lastQ = null; cur = p3; }
        else if (C === 'Q') { const p1 = at(num(), num()), p2 = at(num(), num()); quad(cur, p1, p2); lastQ = p1; lastCtrl = null; cur = p2; }
        else if (C === 'T') { const p1: Pt = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur, p2 = at(num(), num()); quad(cur, p1, p2); lastQ = p1; lastCtrl = null; cur = p2; }
        else if (C === 'A') { const rx = num(), ry = num(), rot = num(), large = num() !== 0, sweep = num() !== 0, p1 = at(num(), num()); arc(cur, rx, ry, rot, large, sweep, p1); lastCtrl = lastQ = null; cur = p1; }
        else if (C === 'Z') break;
        else throw new Error(`commande « ${cmd} » inconnue`);
        if (!pts.length) pts = [cur];
      } while (more());
    }
  } catch { /* keep what was read */ }
  flush(false);
  return out;
}

// ---------- drawing ----------
const shapeCache = new WeakMap<AssetShape, { points: Pt[]; closed: boolean }[]>();
function outlines(s: AssetShape): { points: Pt[]; closed: boolean }[] {
  let o = shapeCache.get(s);
  if (!o) {
    if (s.type === 'path') o = s.d ? pathPoints(s.d).map((p) => ({ points: p.points, closed: p.closed || s.closed })) : [{ points: s.points as Pt[], closed: s.closed }];
    else if (s.type === 'ellipse') o = [{ points: ellipse(s.cx, s.cy, s.rx, s.ry, 36), closed: true }];
    else if (s.type === 'rect') o = [{ points: s.r ? roundRect(s.x, s.y, s.w, s.h, Math.min(s.r, s.w / 2, s.h / 2)) : [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]], closed: true }];
    else o = [];
    shapeCache.set(s, o);
  }
  return o;
}

function shapePrims(s: AssetShape, m: Mat, id: string): Prim[] {
  if (s.type === 'glow') { const [x, y] = apply(m, [s.x, s.y]); return [{ kind: 'glow', id, x, y, radius: s.radius * scaleOf(m), color: s.color, opacity: s.opacity }]; }
  if (s.type === 'gradient') {
    // gradients stay upright: their box follows the part
    const c = [apply(m, [s.x, s.y]), apply(m, [s.x + s.w, s.y]), apply(m, [s.x, s.y + s.h]), apply(m, [s.x + s.w, s.y + s.h])];
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return [{ kind: 'gradient', id, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, stops: s.stops, ...(s.opacity != null ? { opacity: s.opacity } : {}) }];
  }
  if (s.type === 'text') {
    const [x, y] = apply(m, [s.x, s.y]), rot = Math.atan2(m[1], m[0]);
    return [{ kind: 'text', id, x, y, text: s.text, size: s.size * scaleOf(m), color: s.color, font: s.font, weight: s.weight, align: s.align, rotation: rot, opacity: 1 }];
  }
  const k = scaleOf(m);
  return outlines(s).map((o, j) => ({
    kind: 'path' as const, id: `${id}.${j}`, points: o.points.map((p) => apply(m, p)), closed: o.closed,
    ...(s.fill ? { fill: s.fill } : {}), ...(s.stroke ? { stroke: s.stroke } : {}), ...(s.strokeWidth != null ? { strokeWidth: s.strokeWidth * k } : {}),
    ...(s.type === 'path' && s.width != null ? { width: s.width * k } : {}), ...(s.opacity != null ? { opacity: s.opacity } : {}),
    ...(s.type === 'path' && s.smooth ? { smooth: true } : {}), ...(s.role ? { role: s.role } : {}),
  }));
}

const REST: AssetMotion = { rot: 0, swing: 0, speed: 1, phase: 0, dx: 0, dy: 0, bounce: 0, spin: 0 };

/** the matrix of every part at time t in a pose (parents first, whatever their order in the list) */
function partMatrices(a: Asset, pose: string, t: number): Map<string, Mat> {
  const motions = a.poses[pose] ?? a.poses.idle ?? {}, byId = new Map(a.parts.map((p) => [p.id, p]));
  const out = new Map<string, Mat>();
  const of = (p: AssetPart, depth = 0): Mat => {
    const known = out.get(p.id);
    if (known) return known;
    const parent = p.parent && depth < 64 ? byId.get(p.parent) : undefined;
    const base = parent ? of(parent, depth + 1) : I;
    const mo = motions[p.id] ?? REST, w = 2 * Math.PI * (mo.speed * t + mo.phase);
    const deg = mo.rot + mo.spin * t + mo.swing * Math.sin(w), lift = mo.bounce * Math.abs(Math.sin(w));
    // the pivot moves with the parent: turn in the parent's frame
    const m = mul(base, turnAbout(deg, p.pivot[0], p.pivot[1], mo.dx, mo.dy - lift));
    out.set(p.id, m);
    return m;
  };
  for (const p of a.parts) of(p);
  return out;
}

/** which variant of each group shows for an expression (by default, the first variant listed) */
function shownVariants(a: Asset, expression: string): Map<string, string> {
  const pick = new Map<string, string>();
  for (const p of a.parts) if (p.group && p.variant && !pick.has(p.group)) pick.set(p.group, p.variant);
  for (const [g, v] of Object.entries(a.expressions.neutral ?? {})) pick.set(g, v);
  for (const [g, v] of Object.entries(a.expressions[expression] ?? {})) pick.set(g, v);
  return pick;
}

/** prims of a drawing at time t, pose and expression, under matrix `m` */
export function drawAsset(a: Asset, o: { t: number; pose?: string; expression?: string; id: string; m?: Mat; only?: (p: AssetPart) => boolean }): Prim[] {
  const mats = partMatrices(a, o.pose ?? 'idle', o.t), shown = shownVariants(a, o.expression ?? 'neutral'), top = o.m ?? I, out: Prim[] = [];
  const hidden = new Set<string>();
  for (const p of a.parts) {
    // a hidden variant hides what hangs from it too
    if ((p.group && shown.get(p.group) !== p.variant) || (p.parent && hidden.has(p.parent))) { hidden.add(p.id); continue; }
    if (o.only && !o.only(p)) continue;
    const m = mul(top, mats.get(p.id)!);
    p.shapes.forEach((s, k) => out.push(...shapePrims(s, m, `${o.id}:${p.id}:${k}`)));
  }
  return out;
}

export const assetComponent = (a: Asset): ComponentFn => ({ t, id, state }) => drawAsset(a, { t, pose: state.pose, expression: state.expression, id });

/** decors are drawn for a 1920×1080 frame and scaled to the project; parts that move (in the idle pose) are live */
export const DECOR_FRAME = { w: 1920, h: 1080, margin: 300 } as const;
export const assetDecor = (a: Asset): DecorFn => ({ width: W, height: H, id }) => {
  const sx = W / DECOR_FRAME.w, sy = H / DECOR_FRAME.h, m: Mat = [sx, 0, 0, sy, 0, 0], M = DECOR_FRAME.margin;
  const idle = a.poses.idle ?? {};
  const moving = new Set(a.parts.filter((p) => { const mo = idle[p.id]; return !!mo && (((mo.swing > 0 || mo.bounce > 0) && mo.speed > 0) || mo.spin !== 0); }).map((p) => p.id));
  // what hangs from a moving part moves too
  for (let changed = true; changed;) { changed = false; for (const p of a.parts) if (p.parent && moving.has(p.parent) && !moving.has(p.id)) { moving.add(p.id); changed = true; } }
  // the plate is painted behind what moves: parts drawn after the first moving one are redrawn with it, every
  // frame, so the drawing order holds (a tablecloth stays in front of turning rays)
  const first = a.parts.findIndex((p) => moving.has(p.id));
  if (first >= 0) for (const p of a.parts.slice(first)) moving.add(p.id);
  const bounds = { x: -M * sx, y: -M * sy, w: (DECOR_FRAME.w + 2 * M) * sx, h: (DECOR_FRAME.h + 2 * M) * sy };
  const ground: Prim[] = a.background ? [{ kind: 'path', id: `${id}:bg`, points: [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x + bounds.w, bounds.y + bounds.h], [bounds.x, bounds.y + bounds.h]], closed: true, fill: a.background, role: 'shade' }] : [];
  // a decor painted by an image model: the picture over everything (the drawing stays under it, for when it is missing)
  const picture: Prim[] = a.image ? [{ kind: 'image', id: `${id}:image`, src: a.image.asset, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }] : [];
  return {
    bounds,
    still: [...ground, ...drawAsset(a, { t: 0, id, m, only: (p) => !moving.has(p.id) }), ...picture],
    ...(moving.size && !a.image ? { live: (t: number) => drawAsset(a, { t, id, m, only: (p) => moving.has(p.id) }) } : {}),
  };
};

/** the library plus the project's own drawings (these win on a name clash) */
const resolved = new WeakMap<object, { reg: Registry; base: Registry }>();
export function registryFor(project: Pick<Project, 'assets'>, reg: Registry): Registry {
  const assets = project.assets ?? {};
  if (!Object.keys(assets).length) return reg;
  const hit = resolved.get(assets);
  if (hit && hit.base === reg) return hit.reg;
  const pick = (kind: Asset['kind']) => Object.entries(assets).filter(([, a]) => a.kind === kind);
  const out: Registry = {
    ...reg,
    characters: { ...reg.characters, ...Object.fromEntries(pick('character').map(([k, a]) => [k, assetComponent(a)])) },
    props: { ...reg.props, ...Object.fromEntries(pick('prop').map(([k, a]) => [k, assetComponent(a)])) },
    decors: { ...reg.decors, ...Object.fromEntries(pick('decor').map(([k, a]) => [k, assetDecor(a)])) },
  };
  resolved.set(assets, { reg: out, base: reg });
  return out;
}

/** the box a drawing covers at rest (idle pose, neutral expression), and how many shapes and points it has */
export function assetBounds(a: Asset): { x: number; y: number; w: number; h: number; shapes: number; points: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, points = 0;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const prims = drawAsset(a, { t: 0, id: 'b' });
  for (const p of prims) {
    if (p.kind === 'path') { const r = (p.width ?? 0) / 2; for (const [x, y] of p.points) { add(x - r, y - r); add(x + r, y + r); } points += p.points.length; }
    else if (p.kind === 'glow') { add(p.x, p.y); } // a halo is not the drawing's size
    else if (p.kind === 'gradient') { add(p.x, p.y); add(p.x + p.w, p.y + p.h); }
    else { add(p.x, p.y); }
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0, shapes: 0, points: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, shapes: a.parts.reduce((n, p) => n + p.shapes.length, 0), points };
}
