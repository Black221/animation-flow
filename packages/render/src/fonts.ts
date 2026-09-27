// The editor loads its fonts with CSS; on a server they must be registered with the canvas library once per thread.
import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FAMILIES: Record<string, string> = { 'Fredoka.ttf': 'Fredoka', 'PermanentMarker-Regular.ttf': 'Permanent Marker', 'PatrickHand-Regular.ttf': 'Patrick Hand' };
const done = new Set<string>();

/** register the known font files found in `dir`; returns the families registered */
export function registerFonts(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const fam = FAMILIES[f];
    if (!fam) continue;
    if (!done.has(fam)) { GlobalFonts.registerFromPath(join(dir, f), fam); done.add(fam); }
    out.push(fam);
  }
  return out;
}
