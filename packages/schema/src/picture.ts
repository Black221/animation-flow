// A drawing made of one imported picture (a mascot, a logo, a photo of a place). A character or an object stands on
// its base (the origin at its feet, y up is negative); a decor covers the frame and a little around it. So that a
// still picture still acts, it turns and bounces on its feet: the poses a character needs (idle, talk, walk, jump,
// cheer, wave, dance) and a few for an object (float, spin, wobble).
import type { z } from 'zod';
import type { Asset } from './index';

type AssetIn = z.input<typeof Asset>;
export interface PictureRef { asset: string; width: number; height: number; color?: string | undefined }

/** the size a picture takes: a character as tall as a person (340 px), an object 320 px on its longer side */
export function pictureSize(kind: 'character' | 'prop', p: Pick<PictureRef, 'width' | 'height'>): { w: number; h: number } {
  const k = kind === 'character' ? 340 / p.height : 320 / Math.max(p.width, p.height);
  return { w: Math.round(p.width * k), h: Math.round(p.height * k) };
}

export const PICTURE_CHARACTER_POSES = ['idle', 'talk', 'walk', 'jump', 'cheer', 'wave', 'dance'] as const;
export const PICTURE_PROP_POSES = ['idle', 'float', 'spin', 'wobble'] as const;

export function pictureAsset(kind: 'character' | 'prop' | 'decor', p: PictureRef, name: string, description: string, by = 'image importée'): AssetIn {
  // a picture is never mirrored: the writing on a mascot's shirt or on a logo would read backwards
  const made = { by, rounds: 0 }, flip = false;
  if (kind === 'decor') {
    return { kind, name, description, flip, ...(p.color ? { background: p.color } : {}), parts: [{ id: 'photo', shapes: [{ type: 'image', asset: p.asset, x: -120, y: -67.5, w: 2160, h: 1215 }] }], made };
  }
  // a character turns on its feet, an object around its middle
  const { w, h } = pictureSize(kind, p), parts = [{ id: 'image', pivot: (kind === 'character' ? [0, 0] : [0, -h / 2]) as [number, number], shapes: [{ type: 'image' as const, asset: p.asset, x: -w / 2, y: -h, w, h }] }];
  if (kind === 'character') {
    return {
      kind, name, description, parts, made, flip,
      poses: {
        idle: { image: { swing: 1.2, speed: 0.35, bounce: 2 } },
        talk: { image: { swing: 2.5, speed: 1.3, bounce: 4 } },
        walk: { image: { swing: 4, speed: 1.8, bounce: 9 } },
        jump: { image: { bounce: 45, speed: 1.2, swing: 2 } },
        cheer: { image: { bounce: 22, speed: 1.6, swing: 5 } },
        wave: { image: { rot: -2, swing: 6, speed: 1.1, bounce: 3 } },
        dance: { image: { swing: 9, speed: 1.5, bounce: 14 } },
      },
    };
  }
  return { kind, name, description, parts, made, flip, poses: { float: { image: { bounce: 12, speed: 0.4 } }, spin: { image: { spin: 180 } }, wobble: { image: { swing: 8, speed: 1.2 } } } };
}
