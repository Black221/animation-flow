import { createCanvas } from '@napi-rs/canvas';
import { createEvaluator } from '@af/engine';
import { registry } from '@af/library';
import { exampleProject, parseProject } from '@af/schema';
import { describe, expect, it } from 'vitest';
import { getStyle, stylePacks, type CanvasLike } from '../src';

const r = parseProject(exampleProject);
if (!r.ok) throw new Error('example project is invalid');
const ev = createEvaluator(r.project, registry);
const make = (w: number, h: number) => createCanvas(w, h) as unknown as CanvasLike;

function renderAt(style: string, t: number, w = 480, h = 270) {
  const canvas = createCanvas(w, h), renderer = getStyle(style).create(canvas as unknown as CanvasLike, { createCanvas: make, subtitles: true });
  renderer.render(ev.frameAt(t));
  return { canvas, renderer, pixels: canvas.getContext('2d').getImageData(0, 0, w, h).data };
}

describe.each(Object.keys(stylePacks))('style %s', (style) => {
  it('paints a non-empty, varied image', () => {
    const { pixels } = renderAt(style, 3);
    const colours = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4 * 97) colours.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
    expect(colours.size).toBeGreaterThan(40);
  });

  it('renders the same frame identically (deterministic)', () => {
    const a = renderAt(style, 5.5).pixels, b = renderAt(style, 5.5).pixels;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('paints the decor plate once per scene and reuses it', () => {
    const canvas = createCanvas(320, 180), rd = getStyle(style).create(canvas as unknown as CanvasLike, { createCanvas: make });
    for (const t of [1, 2, 3, 4]) rd.render(ev.frameAt(t));
    expect(rd.stats.platesPainted).toBe(1);
    expect(rd.stats.frames).toBe(4);
  });
});

it('falls back to flat for an unknown style', () => {
  expect(getStyle('nope').id).toBe('flat');
});
