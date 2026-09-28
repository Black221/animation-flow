import { comic } from './comic';
import { flat } from './flat';
import { neon } from './neon';
import { papercut } from './papercut';
import { sketch } from './sketch';
import type { StylePack } from './types';
import { watercolor } from './watercolor';

/** every style, in the order the interface shows them */
export const stylePacks: Record<string, StylePack> = { flat, watercolor, papercut, sketch, comic, neon };
/** the requested pack, or `flat` when the id is unknown */
export const getStyle = (id: string | undefined): StylePack => (id && stylePacks[id]) || flat;

export { comic, flat, neon, papercut, sketch, watercolor };
export { DEFAULT_FONTS } from './common';
export { createOutputRenderer, type OutputOptions } from './output';
export type * from './types';
