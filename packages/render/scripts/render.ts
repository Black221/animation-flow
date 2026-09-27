// Render a project to MP4 from the command line:
//   pnpm --filter @af/render render -- [--project=file.json] [--out=out/video.mp4] [--style=watercolor]
//        [--width=1280] [--from=0 --to=10] [--crf=20] [--threads=3]
// Without --project it renders the example project.
import { exampleProject } from '@af/schema';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVideo } from '../src';

const a = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--') && x.length > 2).map((x) => { const [k, v] = x.slice(2).split('='); return [k!, v ?? 'true']; }));
const num = (k: string) => (a[k] != null ? Number(a[k]) : undefined);
const r = await renderVideo({
  project: a.project ? JSON.parse(readFileSync(a.project, 'utf8')) : exampleProject,
  out: a.out ?? 'out/video.mp4',
  style: a.style,
  width: num('width'),
  crf: num('crf'),
  threads: num('threads') ?? Math.max(1, availableParallelism() - 1),
  range: a.from != null || a.to != null ? { from: num('from') ?? 0, to: num('to') ?? Infinity } : undefined,
  fontsDir: resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/fonts'),
  onProgress: (p) => process.stdout.write(`\r${p.done}/${p.total} images · ${p.fps.toFixed(1)} i/s   `),
});
console.log(`\n${r.file}: ${r.width}×${r.height}, ${r.frames} images, ${r.duration.toFixed(2)} s, ${(r.bytes / 1e6).toFixed(1)} Mo, en ${(r.ms / 1000).toFixed(1)} s`);
