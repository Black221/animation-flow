// `watercolor`: painted look, in plain Canvas 2D so it renders fast and identically in the browser and on a server.
//
// A filled shape is painted as: an opaque base (the shape, barely deformed, so it still hides what is behind it),
// then a few translucent washes of lighter and darker pigment on randomly deformed copies of the shape, then a thin
// darker rim where pigment pools at the edge. Outlines are wobbly ink in two passes. Randomness is seeded by the
// primitive id and, for moving elements, by `frame.boil` (8 times a second), which gives the hand-drawn "boil".
// Decors are painted once per scene at higher quality (more washes, blooms in the sky) and reused as a plate.
// Paper grain and a soft vignette go over the whole frame last.
import { darken, lighten, mix, rgba, rng, type Frame, type PathPrim, type Prim, type Pt } from '@af/engine';
import { ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawGradient, drawImage, drawPlate, drawSubtitle, drawText, picturesReady, PlateCache, resolveFonts, tracePath } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';

const PAPER = '#FBF3E6';

/** displace each edge's midpoint along its normal, `depth` times: the ragged edge of a wash */
export function deform(pts: readonly Pt[], rand: () => number, amount: number, depth: number, closed = true): Pt[] {
  let cur = pts.slice() as Pt[];
  for (let d = 0; d < depth; d++) {
    const out: Pt[] = [], n = cur.length, last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i]!, b = cur[(i + 1) % n]!, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const g = (rand() + rand() + rand() - 1.5) * 0.9; // roughly gaussian
      const off = Math.min(len * amount, 18) * g;
      out.push(a, [(a[0] + b[0]) / 2 - (dy / (len || 1)) * off, (a[1] + b[1]) / 2 + (dx / (len || 1)) * off]);
    }
    if (!closed) out.push(cur[n - 1]!);
    cur = out;
  }
  return cur;
}

const jitter = (pts: readonly Pt[], rand: () => number, a: number): Pt[] => pts.map(([x, y]) => [x + (rand() - 0.5) * a, y + (rand() - 0.5) * a]);

function inkStroke(ctx: Ctx2D, pts: readonly Pt[], closed: boolean, color: string, width: number, rand: () => number, smooth?: boolean) {
  const w = Math.max(0.6, width);
  ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalAlpha *= 0.92; ctx.lineWidth = w * 0.95;
  tracePath(ctx, jitter(pts, rand, w * 0.35), closed, smooth); ctx.stroke();
  ctx.globalAlpha *= 0.4; ctx.lineWidth = w * 0.55;
  tracePath(ctx, jitter(pts, rand, w * 0.7), closed, smooth); ctx.stroke();
}

interface Quality { washes: number; depth: number; amount: number; granulation: boolean }
const PLATE: Quality = { washes: 6, depth: 2, amount: 0.12, granulation: true };
const LIVE: Quality = { washes: 3, depth: 1, amount: 0.1, granulation: false };

/** pigment settling in the paper's grain: fine darker specks, clipped to the shape (plates only: it is costly) */
function granulate(ctx: Ctx2D, pts: readonly Pt[], c: string, rand: () => number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const area = (x1 - x0) * (y1 - y0), n = Math.min(2500, Math.floor(area / 260));
  if (n < 4) return;
  ctx.save(); tracePath(ctx, pts, true); ctx.clip();
  ctx.fillStyle = darken(c, 0.3);
  for (let i = 0; i < n; i++) { ctx.globalAlpha = 0.05 + rand() * 0.12; const s = 0.8 + rand() * 1.8; ctx.fillRect(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), s, s); }
  // one soft bloom: pigment gathers on one side of the wash
  const bx = x0 + rand() * (x1 - x0), by = y0 + rand() * (y1 - y0), br = Math.max(x1 - x0, y1 - y0) * (0.4 + rand() * 0.4);
  const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
  g.addColorStop(0, rgba(darken(c, 0.18), 0.22)); g.addColorStop(1, rgba(c, 0));
  ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

export function paintPath(ctx: Ctx2D, p: PathPrim, seed: string, q: Quality) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  const rand = rng(seed);
  ctx.save(); ctx.globalAlpha = a;
  if (!p.closed && p.width) {
    // a thick stroke: ink body, then pigment, then a lighter core
    const c = p.fill ?? p.stroke ?? '#000', pts = deform(p.points, rand, 0.02, 1, false);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (p.stroke && p.strokeWidth) { tracePath(ctx, jitter(pts, rand, 1), false, p.smooth); ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width + p.strokeWidth * 2; ctx.stroke(); }
    tracePath(ctx, pts, false, p.smooth); ctx.strokeStyle = c; ctx.lineWidth = p.width; ctx.stroke();
    ctx.globalAlpha = a * 0.22; ctx.strokeStyle = lighten(c, 0.35); ctx.lineWidth = p.width * 0.45;
    tracePath(ctx, jitter(pts, rand, p.width * 0.15), false, p.smooth); ctx.stroke();
  } else if (!p.closed || !p.fill) {
    if (p.stroke && p.strokeWidth) inkStroke(ctx, p.points, p.closed, p.stroke, p.strokeWidth, rand, p.smooth);
  } else if (p.role === 'shade') {
    // soft shading: two loose washes, no base, no outline
    for (let k = 0; k < 2; k++) { ctx.globalAlpha = a * 0.55; ctx.fillStyle = p.fill; tracePath(ctx, deform(p.points, rand, q.amount * 1.5, 1), true, true); ctx.fill(); }
  } else {
    const detail = p.role === 'detail', c = p.fill;
    const base = detail ? p.points : deform(p.points, rand, q.amount * 0.35, 1);
    ctx.fillStyle = mix(c, PAPER, detail ? 0.05 : 0.22); tracePath(ctx, base, true, p.smooth); ctx.fill();
    if (!detail) {
      for (let k = 0; k < q.washes; k++) {
        const tone = k % 2 ? darken(c, 0.1 + rand() * 0.12) : lighten(c, 0.04 + rand() * 0.14);
        ctx.globalAlpha = a * (0.22 + rand() * 0.18); ctx.fillStyle = k === 0 ? c : tone;
        tracePath(ctx, deform(base, rand, q.amount, q.depth), true, true); ctx.fill();
      }
      ctx.globalAlpha = a;
      if (q.granulation) granulate(ctx, base, c, rand);
      // pigment pooling at the rim
      ctx.globalAlpha = a * 0.3; ctx.strokeStyle = darken(c, 0.25); ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      tracePath(ctx, base, true, p.smooth); ctx.stroke();
    }
    ctx.globalAlpha = a;
    if (p.stroke && p.strokeWidth) inkStroke(ctx, detail ? p.points : base, true, p.stroke, p.strokeWidth, rand, p.smooth);
  }
  ctx.restore();
}

/** a sky: the gradient, then large soft blooms of lighter and darker pigment */
function paintSky(ctx: Ctx2D, p: Extract<Prim, { kind: 'gradient' }>) {
  drawGradient(ctx, p);
  const rand = rng(p.id), stops = p.stops.map((s) => s[1]);
  for (let k = 0; k < 9; k++) {
    const x = p.x + rand() * p.w, y = p.y + rand() * p.h, r = 120 + rand() * 360, c = stops[Math.floor(rand() * stops.length)]!;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r), tone = k % 2 ? lighten(c, 0.25) : darken(c, 0.08);
    g.addColorStop(0, rgba(tone, 0.16)); g.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** paper: fibres and speckles on a tile, multiplied over the frame, plus a warm vignette */
function makePaper(make: (w: number, h: number) => CanvasLike, size = 512): CanvasLike {
  const c = make(size, size), ctx = ctxOf(c), rand = rng('paper');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const x = rand() * size, y = rand() * size, v = 185 + rand() * 60;
    ctx.fillStyle = `rgba(${v},${v - 10},${v - 26},${0.14 + rand() * 0.22})`; ctx.fillRect(x, y, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  // large soft unevenness of the sheet
  for (let i = 0; i < 14; i++) {
    const x = rand() * size, y = rand() * size, r = 40 + rand() * 120, g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(170,140,100,${0.05 + rand() * 0.06})`); g.addColorStop(1, 'rgba(170,140,100,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 380; i++) {
    const x = rand() * size, y = rand() * size, l = 6 + rand() * 22, a = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(140,110,75,${0.08 + rand() * 0.1})`; ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return c;
}

function drawPrim(ctx: Ctx2D, p: Prim, seed: string, q: Quality, fonts: ReturnType<typeof resolveFonts>, images?: RenderOptions['images']) {
  if (p.kind === 'path') paintPath(ctx, p, seed, q);
  else if (p.kind === 'text') drawText(ctx, p, fonts, true);
  else if (p.kind === 'glow') drawGlow(ctx, p);
  else if (p.kind === 'image') drawImage(ctx, p, images);
  else paintSky(ctx, p);
}

export const watercolor: StylePack = {
  id: 'watercolor',
  label: 'Aquarelle',
  description: 'Lavis superposés, encre qui tremble, grain du papier. Plus lent que le vectoriel plat.',
  speed: 'slow',
  hint: 'painted watercolour on paper: soft, slightly muted colours, warm light, gentle contrasts',
  swatch: ['#FBF3E6', '#5B4636', '#7FB3C8', '#E4A672'],
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const make = options?.createCanvas ?? defaultCreateCanvas, ctx = ctxOf(canvas), fonts = resolveFonts(options);
    const plates = new PlateCache(make), stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    let paper: CanvasLike | null = null;
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, p.id, PLATE, fonts, options?.images)), picturesReady(frame.decor, options?.images));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const p of frame.items) drawPrim(ctx, p, `${p.id}:${frame.boil}`, LIVE, fonts, options?.images);
        // paper grain over everything, then the vignette
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        paper ??= makePaper(make);
        const pattern = ctx.createPattern(paper as unknown as CanvasImageSource, 'repeat');
        if (pattern) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = pattern; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
        const W = canvas.width, H = canvas.height, v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
        v.addColorStop(0, 'rgba(150,115,85,0)'); v.addColorStop(1, 'rgba(150,115,85,0.28)');
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); paper = null; },
    };
  },
};
