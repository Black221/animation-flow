// Taking a picture off its plain background (a mascot on white, a logo on a coloured square): what touches the
// border and has the border's colour goes, filled from the edges inwards, so the same colour inside the subject (a
// white shirt within its outline) stays. Pixels at the frontier get a partial transparency and lose the tint of the
// background (no white halo on a dark decor). Done in the browser, before the upload.

export interface Cutout { blob: Blob; removed: number }

const dist = (d: Uint8ClampedArray, i: number, c: [number, number, number]) => Math.hypot(d[i]! - c[0], d[i + 1]! - c[1], d[i + 2]! - c[2]);

/** the border's colour, and whether the border is plain enough to be a background */
export function borderColour(d: Uint8ClampedArray, w: number, h: number): { colour: [number, number, number]; plain: boolean } {
  const idx: number[] = [];
  for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) idx.push(y * w, y * w + w - 1);
  const ch = (k: number) => idx.map((p) => d[p * 4 + k]!).sort((a, b) => a - b)[idx.length >> 1]!;
  const colour: [number, number, number] = [ch(0), ch(1), ch(2)];
  const close = idx.filter((p) => d[p * 4 + 3]! > 200 && dist(d, p * 4, colour) < 28).length;
  return { colour, plain: close / idx.length > 0.8 };
}

export function cutoutPixels(d: Uint8ClampedArray, w: number, h: number, tolerance = 42): number {
  const { colour } = borderColour(d, w, h), n = w * h, bg = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const push = (p: number) => { if (!bg[p] && dist(d, p * 4, colour) < tolerance) { bg[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++]!, x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  // the frontier: a subject pixel next to the background is partly background (anti-aliasing): take it out
  for (let p = 0; p < n; p++) {
    if (bg[p]) { d[p * 4 + 3] = 0; continue; }
    const x = p % w, y = (p / w) | 0;
    const edge = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w]);
    if (!edge) continue;
    const i = p * 4, a = Math.min(1, dist(d, i, colour) / (tolerance * 2.2));
    if (a >= 1) continue;
    const alpha = Math.max(0.05, a);
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k]! - colour[k]! * (1 - alpha)) / alpha));
    d[i + 3] = Math.round(d[i + 3]! * alpha);
  }
  return tail;
}

const load = (f: Blob) => new Promise<HTMLImageElement>((ok, bad) => { const u = URL.createObjectURL(f), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); bad(new Error('image illisible')); }; i.src = u; });

/** whether a picture sits on a plain, opaque background (worth offering to remove) */
export async function hasPlainBackground(f: Blob): Promise<boolean> {
  const img = await load(f), w = Math.min(256, img.naturalWidth), h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h);
  return borderColour(x.getImageData(0, 0, w, h).data, w, h).plain;
}

/** the picture without its background, as a PNG */
export async function cutout(f: Blob): Promise<Cutout> {
  const img = await load(f), w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, w, h), removed = cutoutPixels(data.data, w, h);
  x.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('image illisible'))), 'image/png'));
  return { blob, removed: removed / (w * h) };
}

/** the magic eraser: the region around (x, y) that has its colour goes, with a soft edge */
export function eraseAt(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance = 40): number {
  const x0 = Math.max(0, Math.min(w - 1, Math.round(x))), y0 = Math.max(0, Math.min(h - 1, Math.round(y))), i0 = (y0 * w + x0) * 4;
  if (d[i0 + 3]! === 0) return 0;
  const colour: [number, number, number] = [d[i0]!, d[i0 + 1]!, d[i0 + 2]!], n = w * h, gone = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const push = (p: number) => { if (!gone[p] && d[p * 4 + 3]! > 0 && dist(d, p * 4, colour) < tolerance) { gone[p] = 1; queue[tail++] = p; } };
  push(y0 * w + x0);
  while (head < tail) {
    const p = queue[head++]!, px = p % w, py = (p / w) | 0;
    if (px > 0) push(p - 1); if (px < w - 1) push(p + 1); if (py > 0) push(p - w); if (py < h - 1) push(p + w);
  }
  for (let k = 0; k < tail; k++) d[queue[k]! * 4 + 3] = 0;
  // soften the new edge
  for (let k = 0; k < tail; k++) {
    const p = queue[k]!, px = p % w, py = (p / w) | 0;
    for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1]) {
      if (q < 0 || gone[q] || d[q * 4 + 3]! === 0) continue;
      const a = Math.min(1, dist(d, q * 4, colour) / (tolerance * 2));
      if (a < 1) d[q * 4 + 3] = Math.round(d[q * 4 + 3]! * Math.max(0.1, a));
    }
  }
  return tail;
}
