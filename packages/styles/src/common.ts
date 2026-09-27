// Drawing shared by the style packs: text, glows, gradients, subtitles, fades, and the plate cache.
import { rgba, type FontRole, type Frame, type FrameDecor, type GlowPrim, type GradientPrim, type Pt, type TextPrim } from '@af/engine';
import type { CanvasLike, Ctx2D, RenderOptions } from './types';

export const DEFAULT_FONTS: Record<FontRole, string> = {
  display: '"Fredoka", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif',
  body: '"Fredoka", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif',
  marker: '"Permanent Marker", "Comic Sans MS", cursive',
  hand: '"Patrick Hand", "Comic Sans MS", cursive',
};

export const ctxOf = (c: CanvasLike) => c.getContext('2d') as Ctx2D;

export function defaultCreateCanvas(w: number, h: number): CanvasLike {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as CanvasLike;
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  throw new Error('no canvas available: pass options.createCanvas (e.g. from @napi-rs/canvas)');
}

/** straight segments, or a smooth curve through the midpoints */
export function tracePath(ctx: Ctx2D, pts: readonly Pt[], closed: boolean, smooth = false) {
  ctx.beginPath();
  if (!pts.length) return;
  if (!smooth || pts.length < 3) {
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  } else {
    const n = pts.length, mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = closed ? mid(pts[n - 1]!, pts[0]!) : pts[0]!;
    ctx.moveTo(start[0], start[1]);
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) { const m = mid(pts[i]!, pts[(i + 1) % n]!); ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], m[0], m[1]); }
    if (!closed) ctx.lineTo(pts[n - 1]![0], pts[n - 1]![1]);
  }
  if (closed) ctx.closePath();
}

export function drawText(ctx: Ctx2D, p: TextPrim, fonts: Record<FontRole, string>, inkShadow = false) {
  if (p.opacity <= 0 || p.size < 1) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, p.opacity);
  ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
  ctx.font = `${p.weight} ${p.size}px ${fonts[p.font]}`;
  ctx.textAlign = p.align; ctx.textBaseline = 'middle';
  const lines = p.text.split('\n'), lh = p.size * 1.15;
  lines.forEach((ln, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    if (p.outline) { ctx.lineJoin = 'round'; ctx.lineWidth = p.size * 0.16; ctx.strokeStyle = p.outline; ctx.strokeText(ln, 0, y); }
    if (inkShadow) { ctx.fillStyle = 'rgba(42,35,32,0.28)'; ctx.fillText(ln, p.size * 0.04, y + p.size * 0.05); }
    ctx.fillStyle = p.color; ctx.fillText(ln, 0, y);
  });
  ctx.restore();
}

export function drawGlow(ctx: Ctx2D, p: GlowPrim) {
  if (p.opacity <= 0 || p.radius <= 0) return;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
  g.addColorStop(0, rgba(p.color, Math.min(1, p.opacity)));
  g.addColorStop(0.4, rgba(p.color, Math.min(1, p.opacity) * 0.45));
  g.addColorStop(1, rgba(p.color, 0));
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
  ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2); ctx.restore();
}

export function drawGradient(ctx: Ctx2D, p: GradientPrim) {
  const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
  for (const [k, c] of p.stops) g.addColorStop(Math.max(0, Math.min(1, k)), c);
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.restore();
}

/** the narration line in the lower band (y > 89 % of the height), as in a subtitled film */
export function drawSubtitle(ctx: Ctx2D, frame: Frame, fonts: Record<FontRole, string>) {
  if (!frame.subtitle) return;
  const { width: W, height: H } = frame, size = Math.round(H * 0.034), text = (frame.subtitle.speaker ? frame.subtitle.speaker.toUpperCase() + ' — ' : '') + frame.subtitle.text;
  ctx.save();
  ctx.font = `600 ${size}px ${fonts.body}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const words = text.split(' '), lines: string[] = []; let cur = '';
  for (const w of words) { const next = cur ? cur + ' ' + w : w; if (ctx.measureText(next).width > W * 0.8 && cur) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur);
  const lh = size * 1.3, y0 = H * 0.945 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => { ctx.lineWidth = size * 0.22; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(20,20,28,0.85)'; ctx.strokeText(l, W / 2, y0 + i * lh); ctx.fillStyle = '#FFFFFF'; ctx.fillText(l, W / 2, y0 + i * lh); });
  ctx.restore();
}

export function drawFade(ctx: Ctx2D, frame: Frame) {
  if (frame.fade <= 0) return;
  ctx.save(); ctx.globalAlpha = Math.min(1, frame.fade); ctx.fillStyle = '#0B0F18'; ctx.fillRect(0, 0, frame.width, frame.height); ctx.restore();
}

export interface Plate { canvas: CanvasLike; scale: number }

/** painted decors, by decor key and resolution; the last few are kept */
export class PlateCache {
  private map = new Map<string, Plate>();
  painted = 0;
  constructor(private make: (w: number, h: number) => CanvasLike, private keep = 4) {}
  get(decor: FrameDecor, scale: number, paint: (ctx: Ctx2D, decor: FrameDecor) => void): Plate {
    const s = Math.round(scale * 100) / 100, key = `${decor.key}@${s}`;
    let p = this.map.get(key);
    if (p) { this.map.delete(key); this.map.set(key, p); return p; }
    const w = Math.max(1, Math.ceil(decor.bounds.w * s)), h = Math.max(1, Math.ceil(decor.bounds.h * s));
    const canvas = this.make(w, h), ctx = ctxOf(canvas);
    ctx.setTransform(s, 0, 0, s, -decor.bounds.x * s, -decor.bounds.y * s);
    paint(ctx, decor);
    p = { canvas, scale: s };
    this.map.set(key, p); this.painted++;
    while (this.map.size > this.keep) this.map.delete(this.map.keys().next().value!);
    return p;
  }
  clear() { this.map.clear(); }
}

/** draw a plate with the camera: world → screen, then project pixels → canvas pixels (k) */
export function drawPlate(ctx: Ctx2D, plate: Plate, decor: FrameDecor, frame: Frame, k: number) {
  const v = frame.view;
  ctx.save();
  ctx.setTransform(v[0] * k, v[1] * k, v[2] * k, v[3] * k, v[4] * k, v[5] * k);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(plate.canvas as unknown as CanvasImageSource, decor.bounds.x, decor.bounds.y, decor.bounds.w, decor.bounds.h);
  ctx.restore();
}

export const resolveFonts = (o?: RenderOptions) => ({ ...DEFAULT_FONTS, ...(o?.fonts ?? {}) });
