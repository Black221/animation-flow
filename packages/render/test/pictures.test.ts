import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePicture, renderStill } from '../src';

const dir = mkdtempSync(join(tmpdir(), 'af-pictures-'));

function painted(w: number, h: number, color: string) {
  const c = createCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
  return new Uint8Array(c.toBuffer('image/png'));
}
const pixel = async (png: Buffer, x: number, y: number) => {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
};

describe('pictures', () => {
  it('stores what an image model sends as a JPEG no wider than 2560 px', async () => {
    const p = await normalizePicture(painted(3000, 2000, '#ff0000'));
    expect(p).toMatchObject({ width: 2560, height: 1707 });
    expect([...p.data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    await expect(normalizePicture(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const [r, g] = await pixel(p.data, 10, 10);
    expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(40);
  });

  it('paints a decor picture over its drawing, which shows when the picture is missing', async () => {
    const pic = await normalizePicture(painted(1536, 1024, '#d02020')), asset = 'a'.repeat(32), file = join(dir, `${asset}.jpg`);
    writeFileSync(file, pic.data);
    const project = {
      schemaVersion: 1, title: 'x', width: 1920, height: 1080,
      assets: { lieu: { kind: 'decor', name: 'Lieu', description: 'un lieu', background: '#2040d0', parts: [{ id: 'fond', shapes: [{ type: 'rect', x: -300, y: -300, w: 2520, h: 1680, fill: '#2040d0' }] }], image: { asset, width: pic.width, height: pic.height } } },
      scenes: [{ id: 's1', duration: 2, decor: { kind: 'lieu' } }],
    };
    for (const style of ['flat', 'watercolor']) {
      const [r, , b] = await pixel(await renderStill(project, { width: 320, style, images: { [asset]: file } }), 160, 90);
      expect(r, style).toBeGreaterThan(150); expect(b, style).toBeLessThan(90);
      const [r2, , b2] = await pixel(await renderStill(project, { width: 320, style }), 160, 90);
      expect(b2, style).toBeGreaterThan(r2!);
    }
  });
});
