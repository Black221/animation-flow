// Output formats: a film is composed for 16:9, but it can be delivered vertical (9:16), square (1:1) or portrait
// (4:5). Reframing picks, for every frame, the part of the 16:9 picture to keep: as tall as the frame and narrower.
//
// `follow` (the default) moves that window with the action, like a camera operator: it looks at where the
// characters and props are (the one speaking counts most, and a group that fits is kept whole), then smooths the
// path forwards and backwards (no lag, no jitter) within each scene; a new scene may start elsewhere, as a cut
// does. `center` keeps the middle. Titles and captions (`screen` elements) are not cut: each is laid out again, as
// a whole, inside the new frame (scaled down if it no longer fits). The path is computed from the whole film, so
// every frame of every render chunk gets the same window.
import type { Evaluator, Frame, Subject } from './evaluate';
import { mul, translate, scaleM, type Mat } from './geometry';
import { transformPrim } from './evaluate';
import { primsBox } from './boxes';
import type { Prim } from './primitives';

export const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const;
export type Aspect = keyof typeof ASPECTS;
export type Framing = 'follow' | 'center' | 'fit';
/** `caption`: in a tall window, where the narration line sits (its last line, as a fraction of the height), chosen
 *  once per line where it covers the characters' faces and the titles least */
export interface Crop { x: number; y: number; w: number; h: number; caption?: number }

/** the window of an aspect in a W × H frame: full height for a narrower aspect, full width for a wider one */
export function cropSize(W: number, H: number, ratio: number): { w: number; h: number } {
  return ratio < W / H ? { w: H * ratio, h: H } : { w: W, h: W / ratio };
}

const RATE = 6; // samples per second
const TAU = 0.7; // smoothing time constant (s)

/** where the window should look in a frame: the characters (and a little the props), the speaker most */
export function focusOf(f: Pick<Frame, 'width' | 'height' | 'subjects' | 'speakerId'>, w: number, h: number): [number, number] {
  const chars = f.subjects.filter((s) => s.type === 'character'), pool: Subject[] = chars.length ? chars : f.subjects;
  if (!pool.length) return [f.width / 2, f.height / 2];
  const union = pool.reduce((a, s) => ({ x0: Math.min(a.x0, s.x0), y0: Math.min(a.y0, s.y0), x1: Math.max(a.x1, s.x1), y1: Math.max(a.y1, s.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const cx = union.x1 - union.x0 <= w * 0.86 ? (union.x0 + union.x1) / 2 : null, cy = union.y1 - union.y0 <= h * 0.86 ? (union.y0 + union.y1) / 2 : null;
  if (cx != null && cy != null) return [cx, cy];
  // the group does not fit: the one who matters most, whole (the speaker, else the largest), rather than the empty
  // middle between characters far apart
  const lead = pool.reduce((a, s) => { const v = (s.x1 - s.x0) * (s.y1 - s.y0) * (f.speakerId && s.ref === f.speakerId ? 3 : 1); return v > a.v ? { s, v } : a; }, { s: pool[0]!, v: -1 }).s;
  return [cx ?? (lead.x0 + lead.x1) / 2, cy ?? (lead.y0 + lead.y1) / 2];
}

function smooth(xs: number[]): number[] {
  if (xs.length < 2) return xs;
  const a = 1 - Math.exp(-1 / (RATE * TAU)), f = xs.slice();
  for (let i = 1; i < f.length; i++) f[i] = f[i - 1]! + a * (f[i]! - f[i - 1]!);
  for (let i = f.length - 2; i >= 0; i--) f[i] = f[i + 1]! + a * (f[i]! - f[i + 1]!);
  return f;
}

export interface FramingPath { crop: Crop; at(t: number): Crop }

/** the window, frame by frame, for a film delivered at `ratio` */
export function planFraming(ev: Evaluator, W: number, H: number, ratio: number, mode: Exclude<Framing, 'fit'>): FramingPath {
  const { w, h } = cropSize(W, H, ratio), still: Crop = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  const clamp = (c: number, size: number, full: number) => Math.min(full - size, Math.max(0, c - size / 2));
  if (mode === 'center' || (w >= W - 0.5 && h >= H - 0.5)) return { crop: still, at: () => still };
  const scenes = ev.timeline.scenes.map((s) => {
    const n = Math.max(1, Math.ceil(s.duration * RATE) + 1), xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = focusOf(ev.frameAt(Math.min(s.start + i / RATE, s.start + s.duration - 1e-3)), w, h);
      xs.push(x); ys.push(y);
    }
    return { start: s.start, duration: s.duration, xs: smooth(xs), ys: smooth(ys) };
  });
  const window = (t: number): Crop => {
    const s = scenes.find((x) => t < x.start + x.duration) ?? scenes[scenes.length - 1];
    if (!s) return still;
    const u = Math.max(0, (t - s.start) * RATE), i = Math.min(s.xs.length - 1, Math.floor(u)), j = Math.min(s.xs.length - 1, i + 1), k = u - i;
    const x = s.xs[i]! + (s.xs[j]! - s.xs[i]!) * k, y = s.ys[i]! + (s.ys[j]! - s.ys[i]!) * k;
    return { x: clamp(x, w, W), y: clamp(y, h, H), w, h };
  };
  const captions = h / w > 1.2 ? placeCaptions(ev, window) : null;
  return {
    crop: still,
    at(t: number): Crop {
      const c = window(t), line = captions?.find((l) => t >= l.start && t < l.end);
      return line ? { ...c, caption: line.y } : c;
    },
  };
}

/** where a narration line may sit in a tall window (its last line, as a fraction of the height): above the
 *  characters, lower (clear of the buttons phone apps lay over the bottom), or near the top */
const CAPTION_SLOTS = [0.44, 0.78, 0.2];
/** for each narration line, the slot that covers least, over the whole line: faces (the top of a character) most,
 *  then titles, then the rest of the characters and the props. Chosen once per line: it never jumps while read */
function placeCaptions(ev: Evaluator, window: (t: number) => Crop): { start: number; end: number; y: number }[] {
  const out: { start: number; end: number; y: number }[] = [];
  for (const s of ev.timeline.scenes) for (const l of s.lines) {
    const start = s.start + l.start, end = s.start + l.end, cost = CAPTION_SLOTS.map(() => 0);
    for (let t = start + 0.05; t < end; t += 0.25) {
      const c = window(t), r = reframe(ev.frameAt(t), c), bx0 = c.w * 0.08, bx1 = c.w * 0.92;
      const zones: [number, number, number, number, number][] = [];
      for (const b of r.subjects) {
        if (b.type === 'character') { const head = b.y0 + (b.y1 - b.y0) * 0.35; zones.push([b.x0, b.y0, b.x1, head, 4], [b.x0, head, b.x1, b.y1, 1]); }
        else zones.push([b.x0, b.y0, b.x1, b.y1, 0.5]);
      }
      const groups = new Map<string, Prim[]>();
      for (const p of r.items) if (p.overlay) { let g = groups.get(p.overlay); if (!g) groups.set(p.overlay, (g = [])); g.push(p); }
      for (const ps of groups.values()) { const b = primsBox(ps); zones.push([b.x0, b.y0, b.x1, b.y1, 3]); }
      CAPTION_SLOTS.forEach((y, i) => {
        const y0 = c.h * (y - 0.08), y1 = c.h * (y + 0.03);
        for (const [x0, zy0, x1, zy1, wt] of zones) cost[i]! += Math.max(0, Math.min(x1, bx1) - Math.max(x0, bx0)) * Math.max(0, Math.min(zy1, y1) - Math.max(zy0, y0)) * wt;
      });
    }
    let best = 0;
    cost.forEach((v, i) => { if (v < cost[best]! - 1e-6) best = i; });
    out.push({ start, end, y: CAPTION_SLOTS[best]! });
  }
  return out;
}

const OVERLAY_MARGIN = 0.04;

/** the frame as seen through a window: the world moves, overlays are laid out again inside it */
export function reframe(f: Frame, c: Crop): Frame {
  const shift: Mat = translate(-c.x, -c.y), groups = new Map<string, Prim[]>();
  for (const p of f.items) if (p.overlay) { let g = groups.get(p.overlay); if (!g) groups.set(p.overlay, (g = [])); g.push(p); }
  // overlays on the same row (captions side by side) are laid out together, as one block: each alone would be
  // pulled into the narrower frame and land on its neighbours
  const boxes = [...groups].map(([id, ps]) => ({ ids: [id], b: primsBox(ps) }));
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!.b, b = boxes[j]!.b, overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (overlap > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) {
        boxes[i] = { ids: [...boxes[i]!.ids, ...boxes[j]!.ids], b: { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } };
        boxes.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const placed = new Map<string, Mat>();
  for (const { ids, b } of boxes) {
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const mx = c.w * OVERLAY_MARGIN, my = c.h * OVERLAY_MARGIN, s = Math.min(1, (c.w - 2 * mx) / bw, (c.h - 2 * my) / bh);
    // same relative place in the new frame, then pulled inside it
    let nx = (cx / f.width) * c.w, ny = (cy / f.height) * c.h;
    nx = Math.min(c.w - mx - (bw * s) / 2, Math.max(mx + (bw * s) / 2, nx));
    ny = Math.min(c.h - my - (bh * s) / 2, Math.max(my + (bh * s) / 2, ny));
    const m = mul(mul(translate(nx, ny), scaleM(s)), translate(-cx, -cy));
    for (const id of ids) placed.set(id, m);
  }
  return {
    ...f,
    width: c.w, height: c.h,
    subtitle: f.subtitle && c.caption != null ? { ...f.subtitle, y: c.caption } : f.subtitle,
    view: mul(shift, f.view),
    items: f.items.map((p) => transformPrim(p, p.overlay ? placed.get(p.overlay)! : shift)),
    subjects: f.subjects.map((s) => ({ ...s, x0: s.x0 - c.x, x1: s.x1 - c.x, y0: s.y0 - c.y, y1: s.y1 - c.y })),
  };
}
