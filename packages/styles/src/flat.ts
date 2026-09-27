// `flat`: clean vector look (solid fills, crisp outlines). Fast: also the default for scrubbing in the editor.
import type { Frame, PathPrim, Prim } from '@af/engine';
import { ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawGradient, drawPlate, drawSubtitle, drawText, PlateCache, resolveFonts, tracePath } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';

const BACKGROUND = '#F4EFE6';

export function drawFlatPath(ctx: Ctx2D, p: PathPrim) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (!p.closed && p.width) {
    tracePath(ctx, p.points, false, p.smooth);
    if (p.stroke && p.strokeWidth) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width + p.strokeWidth * 2; ctx.stroke(); }
    ctx.strokeStyle = p.fill ?? p.stroke ?? '#000'; ctx.lineWidth = p.width; ctx.stroke();
  } else {
    tracePath(ctx, p.points, p.closed, p.smooth);
    if (p.fill && p.closed) { ctx.fillStyle = p.fill; ctx.fill(); }
    if (p.stroke && p.strokeWidth && p.role !== 'shade') { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.stroke(); }
  }
  ctx.restore();
}

function drawPrim(ctx: Ctx2D, p: Prim, fonts: ReturnType<typeof resolveFonts>) {
  if (p.kind === 'path') drawFlatPath(ctx, p);
  else if (p.kind === 'text') drawText(ctx, p, fonts);
  else if (p.kind === 'glow') drawGlow(ctx, p);
  else drawGradient(ctx, p);
}

export const flat: StylePack = {
  id: 'flat',
  label: 'Vectoriel plat',
  description: 'Aplats de couleur et contours nets. Rapide : idéal pour prévisualiser.',
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const ctx = ctxOf(canvas), fonts = resolveFonts(options), plates = new PlateCache(options?.createCanvas ?? defaultCreateCanvas);
    const stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, fonts)));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const p of frame.items) drawPrim(ctx, p, fonts);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); },
    };
  },
};
