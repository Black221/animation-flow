// `sketch`: pencil on drawing paper, the look of an animator's rough.
//
// A filled shape gets a light coloured-pencil tint that does not quite match its outline, hatching in a darker tone
// of its colour (the angle and spacing seeded by the shape, so a drawing keeps its hand), and a graphite outline
// traced twice with a little overshoot. Shading is cross-hatched graphite. Skies are pale, with a few loose strokes.
// Moving things are redrawn 8 times a second (the boil). Paper grain goes over the frame last.
import { colorAt, darken, mix, rng, type Frame, type GradientPrim, type PathPrim, type Prim, type Pt } from '@af/engine';
import { boxOf, ctxOf, defaultCreateCanvas, drawFade, drawGlow, drawImage, drawPlate, drawSubtitle, drawText, grainTile, multiplyTile, picturesReady, PlateCache, resolveFonts, tracePath } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, StylePack } from './types';

const PAPER = '#FAF8F2';
const GRAPHITE = '#3A3936';

const wobble = (pts: readonly Pt[], rand: () => number, a: number): Pt[] => pts.map(([x, y]) => [x + (rand() - 0.5) * a, y + (rand() - 0.5) * a]);

/** a graphite line, twice, each pass a little off; open lines overshoot their ends */
function pencil(ctx: Ctx2D, pts: readonly Pt[], closed: boolean, color: string, width: number, rand: () => number, smooth?: boolean, passes = 2) {
  ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const base = ctx.globalAlpha;
  for (let k = 0; k < passes; k++) {
    let q = wobble(pts, rand, 1.1 + width * 0.6);
    if (!closed && q.length >= 2) {
      const [a, b] = [q[0]!, q[1]!], [y, z] = [q[q.length - 2]!, q[q.length - 1]!], o = 2 + rand() * 3;
      const da = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, dz = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
      q = [[a[0] + ((a[0] - b[0]) / da) * o, a[1] + ((a[1] - b[1]) / da) * o], ...q, [z[0] + ((z[0] - y[0]) / dz) * o, z[1] + ((z[1] - y[1]) / dz) * o]];
    }
    ctx.globalAlpha = base * (k === 0 ? 0.85 : 0.45); ctx.lineWidth = Math.max(0.7, width * (k === 0 ? 1 : 0.7));
    tracePath(ctx, q, closed, smooth); ctx.stroke();
  }
  ctx.globalAlpha = base;
}

/** parallel strokes across the shape's box, clipped to it */
function hatch(ctx: Ctx2D, pts: readonly Pt[], color: string, alpha: number, angle: number, spacing: number, rand: () => number, smooth?: boolean) {
  const b = boxOf(pts), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, r = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2;
  if (r < 3) return;
  const n = Math.min(260, Math.ceil((2 * r) / spacing)), dx = Math.cos(angle), dy = Math.sin(angle);
  ctx.save(); tracePath(ctx, pts, true, smooth); ctx.clip();
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = 0.9;
  for (let i = 0; i <= n; i++) {
    const d = -r + i * spacing + (rand() - 0.5) * spacing * 0.5, ox = cx - dy * d, oy = cy + dx * d, l = r * (0.9 + rand() * 0.2);
    ctx.globalAlpha = alpha * (0.6 + rand() * 0.4);
    ctx.beginPath(); ctx.moveTo(ox - dx * l, oy - dy * l); ctx.lineTo(ox + dx * l + (rand() - 0.5) * 2, oy + dy * l + (rand() - 0.5) * 2); ctx.stroke();
  }
  ctx.restore();
}

const lead = (c: string | undefined) => mix(c ?? GRAPHITE, GRAPHITE, 0.6);

export function sketchPath(ctx: Ctx2D, p: PathPrim, seed: string, plate: boolean) {
  const a = Math.min(1, p.opacity ?? 1);
  if (a <= 0 || p.points.length < 2) return;
  const rand = rng(seed), hand = rng(p.id.split(':').slice(0, 2).join(':'));
  ctx.save(); ctx.globalAlpha = a;
  if (!p.closed && p.width) {
    // a thick line: tinted body, graphite edges
    const c = p.fill ?? p.stroke ?? GRAPHITE;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = lead(p.stroke ?? darken(c, 0.4)); ctx.lineWidth = p.width + 2.2; tracePath(ctx, wobble(p.points, rand, 1.2), false, p.smooth); ctx.stroke();
    ctx.strokeStyle = mix(c, PAPER, 0.35); ctx.lineWidth = p.width; tracePath(ctx, p.points, false, p.smooth); ctx.stroke();
  } else if (!p.closed || !p.fill) {
    if (p.stroke && p.strokeWidth) pencil(ctx, p.points, p.closed, lead(p.stroke), p.strokeWidth * 0.6, rand, p.smooth);
  } else if (p.role === 'shade') {
    const ang = 0.75 + hand() * 0.3;
    hatch(ctx, p.points, GRAPHITE, a * 0.3, ang, 4.5, rand, p.smooth);
    hatch(ctx, p.points, GRAPHITE, a * 0.2, ang + 1.3, 6, rand, p.smooth);
  } else if (p.role === 'detail') {
    ctx.fillStyle = mix(p.fill, GRAPHITE, 0.15); tracePath(ctx, p.points, true, p.smooth); ctx.fill();
    pencil(ctx, p.points, true, lead(p.stroke ?? darken(p.fill, 0.5)), Math.min(1.4, (p.strokeWidth ?? 1.4) * 0.6), rand, p.smooth, 1);
  } else {
    // the tint, a little off the line, as a coloured pencil laid quickly
    const off = wobble(p.points, rand, 3);
    ctx.fillStyle = mix(p.fill, PAPER, 0.42); tracePath(ctx, off, true, p.smooth); ctx.fill();
    hatch(ctx, p.points, darken(p.fill, 0.28), a * (plate ? 0.42 : 0.34), 0.7 + hand() * 0.5, plate ? 6 + hand() * 3 : 7, rand, p.smooth);
    pencil(ctx, p.points, true, lead(p.stroke ?? darken(p.fill, 0.55)), Math.max(0.9, (p.strokeWidth ?? 2) * 0.55), rand, p.smooth);
  }
  ctx.restore();
}

/** a pale sky, and a few long loose strokes across it */
function sketchSky(ctx: Ctx2D, p: GradientPrim) {
  const rand = rng(p.id), g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
  for (const [t, c] of p.stops) g.addColorStop(Math.max(0, Math.min(1, t)), mix(c, PAPER, 0.6));
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.lineCap = 'round'; ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = p.y + rand() * p.h * 0.8, x = p.x + rand() * p.w, l = 80 + rand() * 260;
    ctx.globalAlpha = 0.12 + rand() * 0.12; ctx.strokeStyle = darken(colorAt(p.stops, (y - p.y) / p.h), 0.25);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + l / 2, y - 3 + rand() * 6, x + l, y + (rand() - 0.5) * 6); ctx.stroke();
  }
  ctx.restore();
}

function drawPrim(ctx: Ctx2D, p: Prim, seed: string, plate: boolean, fonts: ReturnType<typeof resolveFonts>, images?: RenderOptions['images']) {
  if (p.kind === 'path') sketchPath(ctx, p, seed, plate);
  else if (p.kind === 'text') drawText(ctx, { ...p, color: mix(p.color, GRAPHITE, 0.3), font: p.font === 'display' || p.font === 'body' ? 'hand' : p.font }, fonts);
  else if (p.kind === 'glow') drawGlow(ctx, { ...p, opacity: p.opacity * 0.5 });
  else if (p.kind === 'image') { ctx.save(); ctx.globalAlpha = 0.85; drawImage(ctx, p, images); ctx.restore(); }
  else sketchSky(ctx, p);
}

export const sketch: StylePack = {
  id: 'sketch',
  label: 'Crayonné',
  description: 'Crayon sur papier à dessin : hachures, traits repris, teintes de crayon de couleur. Le brouillon d’animateur.',
  speed: 'medium',
  hint: 'pencil sketch on drawing paper: light coloured-pencil tints, hatching, graphite lines; favour clear silhouettes and a few strong colours',
  swatch: ['#FAF8F2', '#3A3936', '#D9825B', '#6D9DC5'],
  create(canvas: CanvasLike, options?: RenderOptions): Renderer {
    const make = options?.createCanvas ?? defaultCreateCanvas, ctx = ctxOf(canvas), fonts = resolveFonts(options);
    const plates = new PlateCache(make), stats = { frames: 0, platesPainted: 0, lastMs: 0 };
    let grain: CanvasLike | null = null;
    return {
      stats,
      render(frame: Frame) {
        const t0 = performance.now(), k = canvas.width / frame.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (frame.decor) {
          const plate = plates.get(frame.decor, frame.decor.maxZoom * k, (c, d) => d.still.forEach((p) => drawPrim(c, p, p.id, true, fonts, options?.images)), picturesReady(frame.decor, options?.images));
          drawPlate(ctx, plate, frame.decor, frame, k);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const p of frame.items) drawPrim(ctx, p, `${p.id}:${frame.boil}`, false, fonts, options?.images);
        grain ??= grainTile(make, { seed: 'drawing-paper', specks: 3000, fibres: 120, tone: [120, 118, 110], strength: 0.7 });
        multiplyTile(ctx, grain, canvas.width, canvas.height);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawFade(ctx, frame);
        if (options?.subtitles) drawSubtitle(ctx, frame, fonts);
        stats.frames++; stats.platesPainted = plates.painted; stats.lastMs = performance.now() - t0;
      },
      dispose() { plates.clear(); grain = null; },
    };
  },
};
