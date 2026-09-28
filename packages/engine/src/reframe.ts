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
import { transformPrim, primsBox } from './evaluate';
import type { Prim } from './primitives';

export const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const;
export type Aspect = keyof typeof ASPECTS;
export type Framing = 'follow' | 'center' | 'fit';
export interface Crop { x: number; y: number; w: number; h: number }

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
  let sx = 0, sy = 0, sw = 0;
  for (const s of f.subjects) {
    const wt = (s.type === 'character' ? 1 : 0.3) * (f.speakerId && s.ref === f.speakerId ? 3 : 1);
    sx += ((s.x0 + s.x1) / 2) * wt; sy += ((s.y0 + s.y1) / 2) * wt; sw += wt;
  }
  return [cx ?? sx / sw, cy ?? sy / sw];
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
  return {
    crop: still,
    at(t: number): Crop {
      const s = scenes.find((x) => t < x.start + x.duration) ?? scenes[scenes.length - 1];
      if (!s) return still;
      const u = Math.max(0, (t - s.start) * RATE), i = Math.min(s.xs.length - 1, Math.floor(u)), j = Math.min(s.xs.length - 1, i + 1), k = u - i;
      const x = s.xs[i]! + (s.xs[j]! - s.xs[i]!) * k, y = s.ys[i]! + (s.ys[j]! - s.ys[i]!) * k;
      return { x: clamp(x, w, W), y: clamp(y, h, H), w, h };
    },
  };
}

const OVERLAY_MARGIN = 0.04;

/** the frame as seen through a window: the world moves, overlays are laid out again inside it */
export function reframe(f: Frame, c: Crop): Frame {
  const shift: Mat = translate(-c.x, -c.y), groups = new Map<string, Prim[]>();
  for (const p of f.items) if (p.overlay) { let g = groups.get(p.overlay); if (!g) groups.set(p.overlay, (g = [])); g.push(p); }
  const placed = new Map<string, Mat>();
  for (const [id, ps] of groups) {
    const b = primsBox(ps), bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const mx = c.w * OVERLAY_MARGIN, my = c.h * OVERLAY_MARGIN, s = Math.min(1, (c.w - 2 * mx) / bw, (c.h - 2 * my) / bh);
    // same relative place in the new frame, then pulled inside it
    let nx = (cx / f.width) * c.w, ny = (cy / f.height) * c.h;
    nx = Math.min(c.w - mx - (bw * s) / 2, Math.max(mx + (bw * s) / 2, nx));
    ny = Math.min(c.h - my - (bh * s) / 2, Math.max(my + (bh * s) / 2, ny));
    placed.set(id, mul(mul(translate(nx, ny), scaleM(s)), translate(-cx, -cy)));
  }
  return {
    ...f,
    width: c.w, height: c.h,
    view: mul(shift, f.view),
    items: f.items.map((p) => transformPrim(p, p.overlay ? placed.get(p.overlay)! : shift)),
    subjects: f.subjects.map((s) => ({ ...s, x0: s.x0 - c.x, x1: s.x1 - c.x, y0: s.y0 - c.y, y1: s.y1 - c.y })),
  };
}
