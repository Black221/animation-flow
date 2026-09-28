// `neon`: glowing tubes in the night. Shapes are dim silhouettes of their colour, their outlines neon tubes (a wide
// soft glow, then a bright core); small features light up so a face still reads. Skies turn to night with a few
// stars, texts glow, lights glow twice as much. Scanlines and a dark vignette go over the frame last.
import { lighten, mix, rgba, rng, saturate, type Frame, type GradientPrim, type PathPrim, type Prim } from '@af/engine';
import { ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawImage, drawPlate, drawSubtitle, drawText, picturesReady, PlateCache, pxOf, resolveFonts, tracePath, vignette } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';

const NIGHT = '#0A0718';

/** the colour of the tube: brighter and more vivid than the shape's paint */
const tube = (c: string) => lighten(saturate(c, 0.6), 0.18);
const dim = (c: string) => mix(c, NIGHT, 0.74);

/** stroke the current path as a neon tube: glow, then a thin bright core */
function glowStroke(ctx: Ctx2D, color: string, width: number) {
  const px = pxOf(ctx);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 9 * px; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.strokeStyle = lighten(color, 0.6); ctx.lineWidth = Math.max(0.6, width * 0.35); ctx.stroke();
  ctx.restore();
}

export function neonPath(ctx: Ctx2D, p: PathPrim) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const w = Math.max(1.6, (p.strokeWidth ?? 2) * 0.9);
  if (!p.closed && p.width) {
    const c = p.fill ?? p.stroke ?? '#FFFFFF';
    tracePath(ctx, p.points, false, p.smooth); glowStroke(ctx, tube(c), p.width + w * 2);
    ctx.strokeStyle = dim(c); ctx.lineWidth = p.width; ctx.stroke();
  } else if (!p.closed || !p.fill) {
    if (p.stroke && p.strokeWidth) { tracePath(ctx, p.points, p.closed, p.smooth); glowStroke(ctx, tube(p.stroke), w); }
  } else if (p.role === 'shade') {
    ctx.globalAlpha = a * 0.5; ctx.fillStyle = mix(p.fill, NIGHT, 0.85); tracePath(ctx, p.points, true, p.smooth); ctx.fill();
  } else if (p.role === 'detail') {
    // eyes, mouths, buttons: lit, so a face still reads in the dark
    const c = tube(p.fill);
    tracePath(ctx, p.points, true, p.smooth);
    ctx.shadowColor = c; ctx.shadowBlur = 6 * pxOf(ctx); ctx.fillStyle = lighten(c, 0.35); ctx.fill();
  } else {
    tracePath(ctx, p.points, true, p.smooth); ctx.fillStyle = dim(p.fill); ctx.fill();
    glowStroke(ctx, tube(p.fill), w);
  }
  ctx.restore();
}

/** a sky at night, and stars in its upper half */
function nightSky(ctx: Ctx2D, p: GradientPrim) {
  const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h), rand = rng(p.id);
  for (const [t, c] of p.stops) g.addColorStop(Math.max(0, Math.min(1, t)), mix(c, NIGHT, 0.82));
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
  for (let i = 0; i < 90; i++) {
    const x = p.x + rand() * p.w, y = p.y + rand() * p.h * 0.55, r = 0.6 + rand() * 1.6;
    ctx.globalAlpha = 0.3 + rand() * 0.6; ctx.fillStyle = rand() > 0.8 ? '#FFD6F5' : '#DDEBFF';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPrim(ctx: Ctx2D, p: Prim, fonts: ReturnType<typeof resolveFonts>, images?: RenderOptions['images']) {
  if (p.kind === 'path') neonPath(ctx, p);
  else if (p.kind === 'text') {
    const c = tube(p.color);
    ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = p.size * 0.35 * pxOf(ctx);
    drawText(ctx, { ...p, color: lighten(c, 0.45), outline: undefined }, fonts); ctx.restore();
  } else if (p.kind === 'glow') { drawGlow(ctx, { ...p, radius: p.radius * 1.3 }); drawGlow(ctx, { ...p, opacity: p.opacity * 0.6 }); }
  else if (p.kind === 'image') { ctx.save(); drawImage(ctx, p, images); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgba('#2A1F5C', 0.75); ctx.fillRect(p.x, p.y, p.w, p.h); ctx.restore(); }
  else nightSky(ctx, p);
}

export const neon: StylePack = {
  id: 'neon',
  label: 'Néon',
  description: 'La nuit, des tubes de néon : silhouettes sombres, contours lumineux, étoiles. Pour les pubs et les clips.',
  speed: 'slow',
  hint: 'neon lights at night: every colour becomes a glowing tube on a dark background; choose vivid pinks, cyans, violets and yellows, avoid browns and greys',
  swatch: ['#0A0718', '#FF4FD8', '#39E6FF', '#FFE45C'],
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const make = options?.createCanvas ?? defaultCreateCanvas, ctx = ctxOf(canvas), fonts = resolveFonts(options);
    const plates = new PlateCache(make), stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    let lines: CanvasLike | null = null;
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width, W = canvas.width, H = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, W, H);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, fonts, options?.images)), picturesReady(frame.decor, options?.images));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const p of frame.items) drawPrim(ctx, p, fonts, options?.images);
        // scanlines, every 3 device pixels, and the dark corners
        if (!lines) { lines = make(4, 3); const c = ctxOf(lines); c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, 4, 3); c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(0, 2, 4, 1); }
        const pat = ctx.createPattern(lines as unknown as CanvasImageSource, 'repeat');
        if (pat) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore(); }
        vignette(ctx, W, H, '#000000', 0.45);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); lines = null; },
    };
  },
};
