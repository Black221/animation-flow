import { flat } from './flat';
import type { StylePack } from './types';
import { watercolor } from './watercolor';

export const stylePacks: Record<string, StylePack> = { flat, watercolor };
/** the requested pack, or `flat` when the id is unknown */
export const getStyle = (id: string | undefined): StylePack => (id && stylePacks[id]) || flat;

export { flat, watercolor };
export { DEFAULT_FONTS } from './common';
export type * from './types';
