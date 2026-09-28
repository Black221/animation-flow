// Pictures a project uses (decors painted by an image model), decoded from their files before rendering starts
// (images decode asynchronously: drawn too early, they come out empty).
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';

/** asset id → file, decoded; a missing or unreadable file leaves the decor's drawing in its place */
export async function loadPictures(files: Record<string, string> | undefined): Promise<(src: string) => Image | null> {
  const loaded = new Map<string, Image>();
  await Promise.all(Object.entries(files ?? {}).map(async ([src, file]) => {
    try { if (existsSync(file)) { const img = await loadImage(readFileSync(file)); if (img.width && img.height) loaded.set(src, img); } } catch { /* unreadable: skipped */ }
  }));
  return (src) => loaded.get(src) ?? null;
}

/** a picture from an image model, checked and stored the same way: JPEG, at most `maxWidth` wide */
export async function normalizePicture(bytes: Uint8Array, maxWidth = 2560): Promise<{ data: Buffer; width: number; height: number }> {
  let img: Image;
  try { img = await loadImage(Buffer.from(bytes)); } catch { throw new Error('image illisible'); }
  if (!img.width || !img.height) throw new Error('image illisible');
  const k = Math.min(1, maxWidth / img.width), w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { data: c.toBuffer('image/jpeg', 90), width: w, height: h };
}

/** what a picture file is, from its first bytes (SVG and anything else: not accepted) */
export function pictureType(b: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (s(0, 4) === 'GIF8') return 'gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 2) === 'BM') return 'bmp';
  return null;
}

export interface Upload { data: Buffer; ext: 'png' | 'jpg'; width: number; height: number; alpha: boolean; color: string }
/** a picture someone imports (a logo, a product, a photo): decoded and drawn again, so nothing of the file but its
 *  pixels is kept (no metadata, no hidden content). PNG when it has transparency, JPEG otherwise, at most `max` px
 *  on its longer side. `color`: its average colour (a decor's ground under it). */
export async function normalizeUpload(bytes: Uint8Array, max = 2560): Promise<Upload> {
  if (!pictureType(bytes)) throw new Error('format d’image non pris en charge (PNG, JPEG, WebP, GIF ou BMP)');
  let img: Image;
  try { img = await loadImage(Buffer.from(bytes)); } catch { throw new Error('image illisible'); }
  if (!img.width || !img.height) throw new Error('image illisible');
  if (img.width * img.height > 80e6) throw new Error('image trop grande');
  const k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  // transparency and the average colour, on a small copy
  const sw = Math.max(1, Math.min(128, w)), sh = Math.max(1, Math.round((sw * h) / w)), small = createCanvas(sw, sh), sctx = small.getContext('2d');
  sctx.drawImage(c, 0, 0, sw, sh);
  const px = sctx.getImageData(0, 0, sw, sh).data;
  let alpha = false, r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 250) alpha = true;
    if (px[i + 3]! > 128) { r += px[i]!; g += px[i + 1]!; bl += px[i + 2]!; n++; }
  }
  const hex = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return { data: alpha ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 90), ext: alpha ? 'png' : 'jpg', width: w, height: h, alpha, color: `#${hex(r)}${hex(g)}${hex(bl)}` };
}
