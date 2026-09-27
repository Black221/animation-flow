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
