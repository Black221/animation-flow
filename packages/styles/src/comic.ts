// `comic`: a comic-book panel. Bold black ink around every shape, bright flat colours, halftone dots for shading
// and on the large pieces of the decor (the Ben-Day dots of printed comics), lettering with a black outline and a
// drop shadow, and a black panel border. Clean and fast enough for long films.
import { darken, luma, saturate, type Frame, type GradientPrim, type PathPrim, type Prim, type Pt } from '@af/engine';
import { boxOf, ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawImage, drawPlate, drawSubtitle, drawText, picturesReady, PlateCache, resolveFonts, tracePath } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';

const PAGE = '#FFF4DC';
const INK = '#15120E';

const vivid = (c: string) => saturate(c, 0.35);

/** a tile of dots on a hexagonal grid, kept per colour and size */
const tiles = new WeakMap<object, Map<string, CanvasLike>>();
function dotTile(make: (w: number, h: number) => CanvasLike, color: string, step: number, radius: number): CanvasLike {
  let m = tiles.get(make);
  if (!m) { m = new Map(); tiles.set(make, m); }
  const key = `${color}|${step}|${radius}`;
  let t = m.get(key);
  if (!t) {
    const w = step, h = Math.round(step * 1.732);
    t = make(w, h);
    const c = ctxOf(t);
    c.clearRect(0, 0, w, h); c.fillStyle = color; c.beginPath();
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]] as const) { c.moveTo(x + radius, y); c.arc(x, y, radius, 0, Math.PI * 2); }
    c.fill();
    m.set(key, t);
    if (m.size > 64) m.delete(m.keys().next().value!);
  }
  return t;
}

/** printed dots over the shape; `side` keeps them to its lower right (the shaded side) */
function halftone(ctx: Ctx2D, make: (w: number, h: number) => CanvasLike, pts: readonly Pt[], color: string, alpha: number, step: number, radius: number, side: boolean, smooth?: boolean) {
  const b = boxOf(pts), w = b.x1 - b.x0, h = b.y1 - b.y0;
  if (w < step || h < step) return;
  const pattern = ctx.createPattern(dotTile(make, color, step, radius) as unknown as CanvasImageSource, 'repeat');
  if (!pattern) return;
  ctx.save(); tracePath(ctx, pts, true, smooth); ctx.clip();
  if (side) { ctx.beginPath(); ctx.moveTo(b.x0 + w * 0.25, b.y1 + 1); ctx.lineTo(b.x1 + 1, b.y0 + h * 0.25); ctx.lineTo(b.x1 + 1, b.y1 + 1); ctx.closePath(); ctx.clip(); }
  ctx.globalAlpha *= alpha; ctx.fillStyle = pattern; ctx.fillRect(b.x0, b.y0, w, h);
  ctx.restore();
}

export function comicPath(ctx: Ctx2D, p: PathPrim, plate: boolean, make: (w: number, h: number) => CanvasLike) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  const ink = Math.max(2, (p.strokeWidth ?? 1.6) * 1.5);
  ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (!p.closed && p.width) {
    tracePath(ctx, p.points, false, p.smooth);
    ctx.strokeStyle = INK; ctx.lineWidth = p.width + ink * 2; ctx.stroke();
    ctx.strokeStyle = vivid(p.fill ?? p.stroke ?? INK); ctx.lineWidth = p.width; ctx.stroke();
  } else if (!p.closed || !p.fill) {
    if (p.stroke && p.strokeWidth) { tracePath(ctx, p.points, p.closed, p.smooth); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.6, p.strokeWidth * 1.3); ctx.stroke(); }
  } else if (p.role === 'shade') {
    // pale shading (clouds, mist, highlights) stays a flat light tone; darker shading is printed dots
    if (luma(p.fill) > 0.72) { ctx.globalAlpha = a * 0.85; tracePath(ctx, p.points, true, p.smooth); ctx.fillStyle = p.fill; ctx.fill(); }
    else halftone(ctx, make, p.points, darken(p.fill, 0.35), 0.9, 7, 2.2, false, p.smooth);
  } else {
    const c = vivid(p.fill);
    tracePath(ctx, p.points, true, p.smooth); ctx.fillStyle = c; ctx.fill();
    // the printed dots: on the decor's big pieces, darker on the shaded side
    if (plate && p.role !== 'detail') {
      const b = boxOf(p.points);
      if ((b.x1 - b.x0) * (b.y1 - b.y0) > 9000) halftone(ctx, make, p.points, luma(c) > 0.6 ? darken(c, 0.25) : darken(c, 0.4), 0.55, 9, 2.6, true, p.smooth);
    }
    tracePath(ctx, p.points, true, p.smooth); ctx.strokeStyle = INK;
    ctx.lineWidth = p.role === 'detail' ? Math.max(1.2, ink * 0.6) : ink; ctx.stroke();
  }
  ctx.restore();
}

/** a sky: the colours brighter, and big pale dots across it */
function comicSky(ctx: Ctx2D, p: GradientPrim, make: (w: number, h: number) => CanvasLike) {
  const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
  for (const [t, c] of p.stops) g.addColorStop(Math.max(0, Math.min(1, t)), vivid(c));
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.restore();
  halftone(ctx, make, [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]], '#FFFFFF', 0.22, 22, 5.5, false);
}

function drawPrim(ctx: Ctx2D, p: Prim, plate: boolean, make: (w: number, h: number) => CanvasLike, fonts: ReturnType<typeof resolveFonts>, images?: RenderOptions['images']) {
  if (p.kind === 'path') comicPath(ctx, p, plate, make);
  else if (p.kind === 'text') {
    const d = p.size * 0.06;
    // dark lettering gets a white edge, light lettering a black one; both cast an ink shadow
    drawText(ctx, { ...p, x: p.x + d, y: p.y + d, color: INK, outline: INK }, fonts);
    drawText(ctx, { ...p, color: p.color, outline: luma(p.color) < 0.4 ? '#FFFFFF' : INK }, fonts);
  } else if (p.kind === 'glow') drawGlow(ctx, p);
  else if (p.kind === 'image') drawImage(ctx, p, images);
  else comicSky(ctx, p, make);
}

export const comic: StylePack = {
  id: 'comic',
  label: 'Bande dessinée',
  description: 'Encrage noir épais, couleurs franches, trames de points et case de BD. Lisible et rapide.',
  speed: 'fast',
  hint: 'comic book: bold black ink, bright primary colours, strong contrasts, expressive poses; captions read like comic lettering',
  swatch: ['#FFF4DC', '#15120E', '#E63946', '#2A9DF4'],
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const make = options?.createCanvas ?? defaultCreateCanvas, ctx = ctxOf(canvas), fonts = resolveFonts(options);
    const plates = new PlateCache(make), stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width, W = canvas.width, H = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = PAGE; ctx.fillRect(0, 0, W, H);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, true, make, fonts, options?.images)), picturesReady(frame.decor, options?.images));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const p of frame.items) drawPrim(ctx, p, false, make, fonts, options?.images);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        // the panel: a black border on the page's margin
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const m = Math.round(Math.min(W, H) * 0.014), b = Math.max(2, Math.round(Math.min(W, H) * 0.008));
        ctx.fillStyle = PAGE; ctx.fillRect(0, 0, W, m); ctx.fillRect(0, H - m, W, m); ctx.fillRect(0, 0, m, H); ctx.fillRect(W - m, 0, m, H);
        ctx.strokeStyle = INK; ctx.lineWidth = b; ctx.strokeRect(m + b / 2, m + b / 2, W - 2 * m - b, H - 2 * m - b);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); },
    };
  },
};
