// What the engine hands to a style pack: a flat list of drawing primitives, already in screen pixels. Primitives say
// what a shape IS (a filled body, an ink line, a glow, a text) and a style decides how it looks. `id` is stable from
// frame to frame, so a style can seed its randomness on it (brush wobble, paper blooms) and stay deterministic.
import type { Pt } from './geometry';

/** A filled and/or outlined shape. `width` on an open path makes a thick stroke (limbs, stalks, ribbons). */
/** set by the engine on the primitives of a `screen` element (a title, a caption): the element's id. A reframed
 *  output (vertical, square) lays each overlay out again as a whole instead of cropping it. */
interface Overlay { overlay?: string }

export interface PathPrim extends Overlay {
  kind: 'path';
  id: string;
  points: Pt[];
  closed: boolean;
  fill?: string;
  /** outline colour (the style may render it as ink, a crisp line, …) */
  stroke?: string;
  strokeWidth?: number;
  /** for open paths: body thickness, drawn with round caps and outlined with `stroke` */
  width?: number;
  opacity?: number;
  /** `smooth`: draw as a curve through the points instead of straight segments */
  smooth?: boolean;
  /** hint for the style: `detail` (small features, drawn cleaner), `shade` (soft shading, no outline) */
  role?: 'body' | 'detail' | 'shade';
}

export type FontRole = 'display' | 'body' | 'marker' | 'hand';

export interface TextPrim extends Overlay {
  kind: 'text';
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  font: FontRole;
  weight: number;
  align: 'left' | 'center' | 'right';
  rotation: number;
  opacity: number;
  /** outline behind the letters, for legibility on busy backgrounds */
  outline?: string;
}

/** A soft radial light (screens, sensors, sun halo). */
export interface GlowPrim extends Overlay { kind: 'glow'; id: string; x: number; y: number; radius: number; color: string; opacity: number }

/** A linear gradient over a rectangle (skies). Coordinates are in the space of the list holding it. */
export interface GradientPrim extends Overlay { kind: 'gradient'; id: string; x: number; y: number; w: number; h: number; stops: [number, string][]; opacity?: number }

/** A picture over a rectangle (a decor made by an image model). `src` names the image; the style gets it from the
 *  renderer's image source, and draws nothing until it is there. */
export interface ImagePrim extends Overlay { kind: 'image'; id: string; src: string; x: number; y: number; w: number; h: number; opacity?: number }

export type Prim = PathPrim | TextPrim | GlowPrim | GradientPrim | ImagePrim;
