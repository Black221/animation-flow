// What a model is shown to check its own drawing: a small project that stages it. A character appears four times
// (standing, walking, pointing, waving, each with another expression), a prop next to a person for scale, a decor
// alone, as the camera frames the film.
import type { ProjectInput } from '@af/schema';
import type { z } from 'zod';
import type { Asset } from '@af/schema';
import { exampleCharacter } from './examples';

type AssetIn = z.input<typeof Asset>;
export const PREVIEW_TIME = 0.35;
const label = (id: string, x: number, text: string) => ({ id, type: 'text' as const, space: 'screen' as const, params: { text, size: 30, color: '#555555' }, keys: [{ t: 0, x, y: 1040 }] });

export function previewProject(id: string, asset: AssetIn, style = 'flat'): ProjectInput {
  const base = { schemaVersion: 1 as const, title: `aperçu ${id}`, style, fps: 24 as const, width: 1920, height: 1080 };
  if (asset.kind === 'decor') return { ...base, assets: { [id]: asset }, scenes: [{ id: 'p', duration: 2, decor: { kind: id } }] };
  if (asset.kind === 'prop') {
    return {
      ...base, assets: { [id]: asset, 'repere-echelle': exampleCharacter }, cast: { ref: { kind: 'repere-echelle', name: 'repère' } },
      scenes: [{ id: 'p', duration: 2, decor: { kind: 'plain', params: { color: '#F4EFE6' } }, elements: [
        { id: 'ref', type: 'character', ref: 'ref', keys: [{ t: 0, x: 560, y: 900, opacity: 0.35 }] },
        { id: 'it', type: 'prop', ref: id, keys: [{ t: 0, x: 1100, y: 900 }] },
        label('l1', 560, 'repère : une personne de 355 px'), label('l2', 1100, asset.name),
      ] }],
    };
  }
  const shots: [string, string][] = [['idle', 'neutral'], ['walk', 'happy'], ['point', 'surprised'], ['wave', 'sad']];
  return {
    ...base, assets: { [id]: asset }, cast: { c: { kind: id, name: asset.name } },
    scenes: [{ id: 'p', duration: 2, decor: { kind: 'plain', params: { color: '#F4EFE6' } }, elements: shots.flatMap(([pose, expression], k) => [
      { id: `c${k}`, type: 'character' as const, ref: 'c', keys: [{ t: 0, x: 260 + k * 470, y: 940, pose, expression, ...(k === 3 ? { facing: -1 as const } : {}) }] },
      label(`l${k}`, 260 + k * 470, `${pose} · ${expression}`),
    ]) }],
  };
}
