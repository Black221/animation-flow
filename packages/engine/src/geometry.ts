// 2D affine matrices [a, b, c, d, e, f] (same layout as CanvasRenderingContext2D.setTransform) and shape builders.
export type Pt = [number, number];
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
export const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleM = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (r: number): Mat => { const c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
/** translate · rotate · scale, the usual object transform */
export const trs = (x: number, y: number, r: number, sx: number, sy = sx): Mat => mul(mul(translate(x, y), rotate(r)), scaleM(sx, sy));
export const apply = (m: Mat, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** how much a matrix scales lengths (geometric mean of the axes): stroke widths and font sizes follow it */
export const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
export const rotationOf = (m: Mat) => Math.atan2(m[1], m[0]);
export const invert = (m: Mat): Mat => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};

export interface Box { x0: number; y0: number; x1: number; y1: number }
export function bounds(pts: readonly Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

// ---------- shapes (closed polygons, clockwise on screen) ----------
export const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
export function ellipse(cx: number, cy: number, rx: number, ry = rx, n = 32, a0 = 0, a1 = Math.PI * 2): Pt[] {
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9, m = full ? n : n + 1, out: Pt[] = [];
  for (let i = 0; i < m; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}
export function roundRect(x: number, y: number, w: number, h: number, r: number, n = 5): Pt[] {
  r = Math.min(r, w / 2, h / 2);
  const out: Pt[] = [], corner = (cx: number, cy: number, a: number) => { for (let i = 0; i <= n; i++) { const t = a + (Math.PI / 2) * (i / n); out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return out;
}
export function star(cx: number, cy: number, r1: number, r2: number, points = 5, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) { const a = rot + (Math.PI * i) / points, r = i % 2 ? r2 : r1; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
/** a smooth open curve through the points (Catmull-Rom), sampled `n` times per span */
export function spline(pts: readonly Pt[], n = 8): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [], P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  return out;
}
/** a blob: an ellipse whose radius wobbles, seeded */
export function blob(cx: number, cy: number, rx: number, ry: number, rand: () => number, wobble = 0.18, n = 28): Pt[] {
  const k = [rand(), rand(), rand()].map((v) => v * Math.PI * 2);
  return ellipse(0, 0, 1, 1, n).map(([x, y], i) => {
    const a = (i / n) * Math.PI * 2, w = 1 + wobble * (0.5 * Math.sin(3 * a + k[0]!) + 0.3 * Math.sin(5 * a + k[1]!) + 0.2 * Math.sin(7 * a + k[2]!));
    return [cx + x * rx * w, cy + y * ry * w] as Pt;
  });
}
export const mapPts = (pts: readonly Pt[], m: Mat) => pts.map((p) => apply(m, p));
