// Screen boxes of primitives: for culling, reframing and the size of a drawing.
import { apply, bounds } from './geometry';
import type { Prim } from './primitives';

/** the screen box of a primitive (texts and glows approximately) */
export function primBox(p: Prim): { x0: number; y0: number; x1: number; y1: number } {
  if (p.kind === 'path') { const b = bounds(p.points), pad = (p.width ?? 0) / 2 + (p.strokeWidth ?? 0); return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }; }
  if (p.kind === 'text') { const lines = p.text.split('\n'), half = (Math.max(...lines.map((l) => l.length)) * p.size * 0.55) / 2, hh = (lines.length * p.size * 1.15) / 2; const x = p.align === 'left' ? p.x + half : p.align === 'right' ? p.x - half : p.x; return { x0: x - half, y0: p.y - hh, x1: x + half, y1: p.y + hh }; }
  if (p.kind === 'glow') return { x0: p.x - p.radius * 0.5, y0: p.y - p.radius * 0.5, x1: p.x + p.radius * 0.5, y1: p.y + p.radius * 0.5 };
  if (p.kind === 'image' && p.matrix) {
    const c = [apply(p.matrix, [p.x, p.y]), apply(p.matrix, [p.x + p.w, p.y]), apply(p.matrix, [p.x, p.y + p.h]), apply(p.matrix, [p.x + p.w, p.y + p.h])], b = bounds(c);
    return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }
  return { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h };
}
export function primsBox(ps: readonly Prim[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) { const b = primBox(p); if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0; if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1; }
  return { x0, y0, x1, y1 };
}

