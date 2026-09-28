// An output renderer: a style pack drawing into a canvas of another shape than the film (vertical, square,
// portrait). With a window (`follow`, `center`) the style draws the reframed frame straight into the canvas; with
// `fit` it draws the whole picture, as large as it fits, over a blurred and darkened copy of itself that fills the
// rest. Subtitles are drawn by the style inside the picture, or, in `fit`, in the band under it.
import { reframe, type Crop, type Frame, type Framing } from '@af/engine';
import { ctxOf, defaultCreateCanvas, drawSubtitle, resolveFonts } from './common';
import type { CanvasLike, Ctx2D, RenderOptions, Renderer, RenderStats, StylePack } from './types';

export interface OutputOptions extends RenderOptions {
  framing: Framing;
  /** the window at a time (from planFraming); required unless `framing` is `fit` */
  window?: ((t: number) => Crop) | undefined;
}

export function createOutputRenderer(pack: StylePack, canvas: CanvasLike, o: OutputOptions): Renderer {
  const make = o.createCanvas ?? defaultCreateCanvas;
  if (o.framing !== 'fit') {
    const inner = pack.create(canvas, o);
    return {
      get stats() { return inner.stats; },
      render(frame: Frame) { inner.render(o.window ? reframe(frame, o.window(frame.time)) : frame); },
      dispose() { inner.dispose(); },
    };
  }
  // fit: the picture on its own canvas, then composed
  let picture: CanvasLike | null = null, small: CanvasLike | null = null, inner: Renderer | null = null;
  const ctx = ctxOf(canvas), fonts = resolveFonts(o), stats: RenderStats = { frames: 0, platesPainted: 0, lastMs: 0 };
  return {
    stats,
    render(frame: Frame) {
      const t0 = performance.now(), W = canvas.width, H = canvas.height, s = Math.min(W / frame.width, H / frame.height);
      const pw = Math.max(2, Math.round(frame.width * s)), ph = Math.max(2, Math.round(frame.height * s));
      if (!picture || picture.width !== pw || picture.height !== ph) {
        inner?.dispose(); picture = make(pw, ph); inner = pack.create(picture, { ...o, subtitles: false });
        small = make(Math.max(2, Math.round(pw / 16)), Math.max(2, Math.round(ph / 16)));
      }
      inner!.render(frame);
      // the backdrop: the picture shrunk and stretched back (a cheap, identical-everywhere blur), darkened
      const sc = ctxOf(small!) as Ctx2D;
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.imageSmoothingEnabled = true; sc.drawImage(picture as unknown as CanvasImageSource, 0, 0, small!.width, small!.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true;
      const cover = Math.max(W / small!.width, H / small!.height), bw = small!.width * cover, bh = small!.height * cover;
      ctx.drawImage(small as unknown as CanvasImageSource, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.fillStyle = 'rgba(8,8,14,0.45)'; ctx.fillRect(0, 0, W, H);
      const x = Math.round((W - pw) / 2), y = Math.round((H - ph) / 2);
      ctx.drawImage(picture as unknown as CanvasImageSource, x, y);
      if (o.subtitles && frame.subtitle) {
        // in the band under the picture when there is one, otherwise over its bottom
        const band = H - (y + ph);
        drawSubtitle(ctx, { ...frame, width: W, height: H }, fonts, band > H * 0.12 ? y + ph + band * 0.6 : undefined);
      }
      stats.frames++; stats.platesPainted = inner!.stats.platesPainted; stats.lastMs = performance.now() - t0;
    },
    dispose() { inner?.dispose(); picture = null; small = null; },
  };
}
