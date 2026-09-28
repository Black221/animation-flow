// Stills of a project in the output formats: pnpm --filter @af/styles exec tsx scripts/formats.ts [--style=flat] [--t=2,6] [--out=out/formats]
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { ASPECTS, createEvaluator, planFraming, type Aspect, type Framing } from '@af/engine';
import { registry } from '@af/library';
import { exampleProject, parseProject } from '@af/schema';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputRenderer, getStyle, type CanvasLike } from '../src';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k!, v ?? 'true']; }));
const fontDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/fonts');
const families: Record<string, string> = { 'Fredoka.ttf': 'Fredoka', 'PermanentMarker-Regular.ttf': 'Permanent Marker', 'PatrickHand-Regular.ttf': 'Patrick Hand' };
for (const f of readdirSync(fontDir)) if (families[f]) GlobalFonts.registerFromPath(join(fontDir, f), families[f]);
const p = parseProject(exampleProject);
if (!p.ok) throw new Error('bad example');
const ev = createEvaluator(p.project, registry), out = args.out ?? 'out/formats', style = getStyle(args.style ?? 'flat');
mkdirSync(out, { recursive: true });
const make = (a: number, b: number) => createCanvas(a, b) as unknown as CanvasLike;
for (const [aspect, framing] of [['9:16', 'follow'], ['9:16', 'fit'], ['1:1', 'follow'], ['4:5', 'center']] as [Aspect, Framing][]) {
  const r = ASPECTS[aspect], w = r < 1 ? 540 : 720, h = Math.round(w / r), canvas = createCanvas(w, h);
  const path = framing === 'fit' ? null : planFraming(ev, 1920, 1080, r, framing);
  const rd = createOutputRenderer(style, canvas as unknown as CanvasLike, { createCanvas: make, framing, window: path ? (t) => path.at(t) : undefined, subtitles: true });
  for (const t of (args.t ?? '2,6,14').split(',').map(Number)) {
    rd.render(ev.frameAt(t));
    writeFileSync(join(out, `${style.id}_${aspect.replace(':', 'x')}_${framing}_${t}.png`), canvas.toBuffer('image/png'));
  }
}
console.log('ok');
