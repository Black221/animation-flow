import type { PathPrim, Prim, Pt } from '@af/engine';

export const INK = '#2A2320';
export const P = (params: Record<string, unknown>) => ({
  str: (k: string, d: string) => (typeof params[k] === 'string' ? (params[k] as string) : d),
  num: (k: string, d: number) => (typeof params[k] === 'number' && Number.isFinite(params[k]) ? (params[k] as number) : d),
  bool: (k: string, d: boolean) => (typeof params[k] === 'boolean' ? (params[k] as boolean) : d),
  opt: (k: string) => (typeof params[k] === 'string' && params[k] ? (params[k] as string) : null),
  list: (k: string, d: string[]) => (Array.isArray(params[k]) && (params[k] as unknown[]).every((v) => typeof v === 'string') ? (params[k] as string[]) : d),
});

/** a filled body with an ink outline */
export const body = (id: string, points: Pt[], fill: string, o: Partial<PathPrim> = {}): PathPrim =>
  ({ kind: 'path', id, points, closed: true, fill, stroke: INK, strokeWidth: 3.5, ...o });
/** a thick stroke (limb, stalk) with an ink outline */
export const limb = (id: string, points: Pt[], color: string, width: number, o: Partial<PathPrim> = {}): PathPrim =>
  ({ kind: 'path', id, points, closed: false, fill: color, width, stroke: INK, strokeWidth: 3, ...o });
/** a thin ink line */
export const line = (id: string, points: Pt[], color = INK, strokeWidth = 3.5, o: Partial<PathPrim> = {}): PathPrim =>
  ({ kind: 'path', id, points, closed: false, stroke: color, strokeWidth, role: 'detail', ...o });

export const offset = (prims: Prim[], dx: number, dy: number): Prim[] =>
  prims.map((p) => {
    switch (p.kind) {
      case 'path': return { ...p, points: p.points.map(([x, y]) => [x + dx, y + dy] as Pt) };
      case 'text': case 'glow': return { ...p, x: p.x + dx, y: p.y + dy };
      case 'gradient': return { ...p, x: p.x + dx, y: p.y + dy };
    }
  });
/** rotate primitives about a pivot (a head tilt) */
export const rotateAbout = (prims: Prim[], cx: number, cy: number, r: number): Prim[] => {
  if (!r) return prims;
  const c = Math.cos(r), s = Math.sin(r), f = ([x, y]: Pt): Pt => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  return prims.map((p) => {
    if (p.kind === 'path') return { ...p, points: p.points.map(f) };
    if (p.kind === 'text') { const [x, y] = f([p.x, p.y]); return { ...p, x, y, rotation: p.rotation + r }; }
    if (p.kind === 'glow') { const [x, y] = f([p.x, p.y]); return { ...p, x, y }; }
    return p;
  });
};
