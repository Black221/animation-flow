// Render still images of a project with a style, in Node (no browser, no GPU):
//   pnpm --filter @af/styles still -- [--project=file.json] [--style=watercolor] [--t=1,4.5,9] [--width=960] [--out=out/stills]
// Without --project it renders the example project.
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { createEvaluator } from '@af/engine';
import { registry } from '@af/library';
import { exampleProject, parseProject } from '@af/schema';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStyle, type CanvasLike } from '../src';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k!, v ?? 'true']; }));
const fontDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/fonts');
const families: Record<string, string> = { 'Fredoka.ttf': 'Fredoka', 'PermanentMarker-Regular.ttf': 'Permanent Marker', 'PatrickHand-Regular.ttf': 'Patrick Hand' };
for (const f of readdirSync(fontDir)) if (families[f]) GlobalFonts.registerFromPath(join(fontDir, f), families[f]);

const input = args.project ? JSON.parse(readFileSync(args.project, 'utf8')) : exampleProject;
const parsed = parseProject(input);
if (!parsed.ok) { console.error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n')); process.exit(1); }
const project = parsed.project, ev = createEvaluator(project, registry);
const style = getStyle(args.style ?? project.style), w = +(args.width ?? 960), h = Math.round((w * project.height) / project.width);
const out = args.out ?? 'out/stills'; mkdirSync(out, { recursive: true });
const make = (a: number, b: number) => createCanvas(a, b) as unknown as CanvasLike;
const canvas = createCanvas(w, h), renderer = style.create(canvas as unknown as CanvasLike, { createCanvas: make, subtitles: args.subtitles === 'true' });
for (const t of (args.t ?? '1,4').split(',').map(Number)) {
  renderer.render(ev.frameAt(t));
  const file = join(out, `${style.id}_${t.toFixed(2).replace('.', '_')}.png`);
  writeFileSync(file, canvas.toBuffer('image/png'));
  console.log(`${file}  ${renderer.stats.lastMs.toFixed(0)} ms`);
}
