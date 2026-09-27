// Components turn an element's state into primitives, in LOCAL coordinates (origin at the element's anchor: a
// character's feet, a prop's base, a text's centre); the engine then places them with the element's transform and the
// camera. Components never know the style: the library (@af/library) supplies them and style packs draw the result.
import type { Prim } from './primitives';

export interface ElementState {
  pose: string;
  expression: string;
  facing: 1 | -1;
  text: string | undefined;
}

export interface DrawArgs {
  /** time since the scene started (s) */
  t: number;
  /** time since the element entered (s) */
  local: number;
  /** stable id prefix: every primitive id should start with it */
  id: string;
  params: Record<string, unknown>;
  state: ElementState;
}

export type ComponentFn = (a: DrawArgs) => Prim[];

export interface DecorArgs { params: Record<string, unknown>; width: number; height: number; id: string }
/** A decor is split in two: `still` is painted once per scene (and cached as a "plate"), `live` is drawn every frame. */
export interface DecorOut {
  /** world-space rectangle the still part covers (larger than the frame, so camera moves never show an edge) */
  bounds: { x: number; y: number; w: number; h: number };
  still: Prim[];
  live?: (t: number) => Prim[];
}
export type DecorFn = (a: DecorArgs) => DecorOut;

export interface Registry {
  characters: Record<string, ComponentFn>;
  props: Record<string, ComponentFn>;
  decors: Record<string, DecorFn>;
  /** draws `text` elements */
  text: ComponentFn;
}

/** metadata for the editor and for model prompts: what the library offers */
export interface Catalog {
  characters: { kind: string; label: string; poses: string[]; expressions: string[]; params: Record<string, string> }[];
  props: { kind: string; label: string; params: Record<string, string> }[];
  decors: { kind: string; label: string; params: Record<string, string> }[];
}
