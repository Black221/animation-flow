// `papercut`: cut paper on a kraft board, as in stop-motion cut-out animation.
//
// Every filled shape is a piece of paper: its edge is cut by hand (slightly irregular straight runs), it casts a soft
// shadow on what is behind it, and its colour is a little creamy, like dyed paper. Outlines are not ink: an open line
// is a thin strip, a closed shape only gets a faint darker cut edge. Skies become stacked strips of paper with wavy
// edges. Moving pieces are re-cut 4 times a second (half the engine's boil), the jerk of stop-motion. A fibre texture
// and a warm vignette go over the frame last.
import { colorAt, darken, lighten, mix, rng, type Frame, type GradientPrim, type PathPrim, type Prim, type Pt } from '@af/engine';
import { boxOf, ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawImage, drawPlate, drawSubtitle, drawText, grainTile, multiplyTile, picturesReady, PlateCache, pxOf, resolveFonts, tracePath, vignette } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';
import { deform } from './watercolor';

const BOARD = '#E6D5B8';
const CREAM = '#F6EBD8';
const SHADOW = 'rgba(58,38,18,0.34)';

/** dyed paper: the colour, slightly creamy and flat */
const paper = (c: string) => mix(c, CREAM, 0.1);

function shadow(ctx: Ctx2D, lift: number) {
  const px = pxOf(ctx);
  ctx.shadowColor = SHADOW; ctx.shadowBlur = 5 * lift * px; ctx.shadowOffsetX = 1.6 * lift * px; ctx.shadowOffsetY = 3 * lift * px;
}
const noShadow = (ctx: Ctx2D) => { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

/** the scissors: more points on long edges, each nudged a little off the line */
function cut(pts: readonly Pt[], rand: () => number, closed: boolean): Pt[] {
  const out: Pt[] = [], n = pts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.min(6, Math.floor(len / 26));
    out.push([a[0] + (rand() - 0.5) * 0.8, a[1] + (rand() - 0.5) * 0.8]);
    for (let k = 1; k <= steps; k++) {
      const t = k / (steps + 1), nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1), off = (rand() - 0.5) * 2.2;
      out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    }
  }
  if (!closed) out.push(pts[n - 1]!);
  return out;
}

export function paperPath(ctx: Ctx2D, p: PathPrim, seed: string, plate: boolean) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  const rand = rng(seed);
  ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (!p.closed && p.width) {
    // a strip of paper: its shadow, the strip, a lighter fold along it
    const c = paper(p.fill ?? p.stroke ?? '#000'), pts = deform(p.points, rand, 0.015, 1, false);
    shadow(ctx, 0.8); tracePath(ctx, pts, false, p.smooth); ctx.strokeStyle = c; ctx.lineWidth = p.width; ctx.stroke();
    noShadow(ctx); ctx.globalAlpha = a * 0.25; ctx.strokeStyle = lighten(c, 0.4); ctx.lineWidth = Math.max(1, p.width * 0.18);
    tracePath(ctx, pts, false, p.smooth); ctx.stroke();
  } else if (!p.closed || !p.fill) {
    // a drawn line becomes a thin strip laid on top
    if (p.stroke && p.strokeWidth) {
      shadow(ctx, 0.35); ctx.strokeStyle = paper(p.stroke); ctx.lineWidth = Math.max(1.2, p.strokeWidth * 0.9);
      tracePath(ctx, cut(p.points, rand, p.closed), p.closed, p.smooth); ctx.stroke();
    }
  } else {
    const detail = p.role === 'detail', shade = p.role === 'shade', pts = detail ? p.points : cut(p.points, rand, true);
    if (shade) {
      // a thinner, darker sheet glued on: no shadow of its own
      ctx.globalAlpha = a * 0.75; ctx.fillStyle = paper(p.fill); tracePath(ctx, pts, true, p.smooth); ctx.fill();
    } else {
      shadow(ctx, detail ? 0.25 : plate ? 1.2 : 1);
      ctx.fillStyle = paper(p.fill); tracePath(ctx, pts, true, p.smooth); ctx.fill();
      noShadow(ctx);
      if (!detail) {
        // light catches the top of the piece, the cut edge is a hair darker
        const b = boxOf(pts), g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
        g.addColorStop(0, 'rgba(255,248,235,0.16)'); g.addColorStop(0.5, 'rgba(255,248,235,0)'); g.addColorStop(1, 'rgba(60,40,20,0.08)');
        ctx.fillStyle = g; ctx.fill();
        ctx.globalAlpha = a * 0.45; ctx.strokeStyle = darken(p.fill, 0.22); ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** a sky: strips of paper, lighter at the top, each with a wavy edge and a shadow cast upwards */
function paperSky(ctx: Ctx2D, p: GradientPrim) {
  const rand = rng(p.id), bands = 6, px = pxOf(ctx);
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1;
  ctx.fillStyle = paper(colorAt(p.stops, 0)); ctx.fillRect(p.x, p.y, p.w, p.h);
  for (let i = 1; i < bands; i++) {
    const y = p.y + (p.h * i) / bands, amp = 6 + rand() * 10, waves = 2 + Math.floor(rand() * 3), phase = rand() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h);
    const steps = 48;
    for (let s = 0; s <= steps; s++) { const x = p.x + (p.w * s) / steps; ctx.lineTo(x, y + Math.sin(phase + (s / steps) * Math.PI * 2 * waves) * amp + (rand() - 0.5) * 2); }
    ctx.lineTo(p.x + p.w, p.y + p.h); ctx.closePath();
    ctx.shadowColor = 'rgba(58,38,18,0.22)'; ctx.shadowBlur = 6 * px; ctx.shadowOffsetY = -2 * px;
    ctx.fillStyle = paper(colorAt(p.stops, (i + 0.5) / bands)); ctx.fill();
  }
  ctx.restore();
}

function drawPrim(ctx: Ctx2D, p: Prim, seed: string, plate: boolean, fonts: ReturnType<typeof resolveFonts>, images?: RenderOptions['images']) {
  if (p.kind === 'path') paperPath(ctx, p, seed, plate);
  else if (p.kind === 'text') { ctx.save(); shadow(ctx, 0.6); drawText(ctx, { ...p, color: paper(p.color) }, fonts); ctx.restore(); }
  else if (p.kind === 'glow') drawGlow(ctx, { ...p, opacity: p.opacity * 0.7 });
  else if (p.kind === 'image') drawImage(ctx, p, images);
  else paperSky(ctx, p);
}

export const papercut: StylePack = {
  id: 'papercut',
  label: 'Papier découpé',
  description: 'Pièces de papier coupées aux ciseaux, ombres portées, carton kraft : l’animation image par image.',
  speed: 'medium',
  hint: 'cut paper collage on kraft board: flat saturated paper colours, clear shapes, strong contrast between near and far layers',
  swatch: ['#E6D5B8', '#8C4A2F', '#E7B64B', '#4E8A7A'],
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const make = options?.createCanvas ?? defaultCreateCanvas, ctx = ctxOf(canvas), fonts = resolveFonts(options);
    const plates = new PlateCache(make), stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    let fibre: CanvasLike | null = null;
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = BOARD; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, p.id, true, fonts, options?.images)), picturesReady(frame.decor, options?.images));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        const step = Math.floor(frame.boil / 2);
        for (const p of frame.items) drawPrim(ctx, p, `${p.id}:${step}`, false, fonts, options?.images);
        fibre ??= grainTile(make, { seed: 'kraft', specks: 4200, fibres: 520, tone: [150, 112, 70], strength: 0.9 });
        multiplyTile(ctx, fibre, canvas.width, canvas.height);
        vignette(ctx, canvas.width, canvas.height, '#5A3C1E', 0.22);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); fibre = null; },
    };
  },
};
