// One image of a project at a moment, as PNG: previews of drawings for a model to look at, thumbnails.
import { createEvaluator } from '@af/engine';
import { registry } from '@af/library';
import { parseProject } from '@af/schema';
import { getStyle, type CanvasLike } from '@af/styles';
import { createCanvas } from '@napi-rs/canvas';
import { registerFonts } from './fonts';

export function renderStill(project: unknown, o: { t?: number; width?: number; style?: string; fontsDir?: string } = {}): Buffer {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(`projet invalide : ${parsed.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join(' ; ')}`);
  const p = parsed.project, w = Math.round(o.width ?? 1200), h = Math.round((w * p.height) / p.width);
  if (o.fontsDir) registerFonts(o.fontsDir);
  const canvas = createCanvas(w, h), make = (a: number, b: number) => createCanvas(a, b) as unknown as CanvasLike;
  const renderer = getStyle(o.style ?? p.style).create(canvas as unknown as CanvasLike, { createCanvas: make });
  renderer.render(createEvaluator(p, registry).frameAt(o.t ?? 0));
  renderer.dispose();
  return canvas.toBuffer('image/png');
}
