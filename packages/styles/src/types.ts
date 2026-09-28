// A style pack draws engine frames on a 2D canvas. Only Canvas 2D is used (no WebGL), so the same code runs in the
// editor's preview, in a headless browser and in Node (@napi-rs/canvas) on a render worker, without a GPU.
import type { FontRole, Frame } from '@af/engine';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface CanvasLike { width: number; height: number; getContext(type: '2d'): unknown }

export interface RenderOptions {
  /** makes the offscreen canvases used for plates and paper (defaults to OffscreenCanvas or a DOM canvas) */
  createCanvas?: (w: number, h: number) => CanvasLike;
  /** CSS font families per role */
  fonts?: Partial<Record<FontRole, string>>;
  /** draw the current narration line at the bottom (editor preview) */
  subtitles?: boolean;
  /** pictures by name (decors made by an image model); an image not there yet is drawn once it is */
  images?: (src: string) => CanvasImageSource | null | undefined;
}

export interface RenderStats { frames: number; platesPainted: number; lastMs: number }

export interface Renderer {
  render(frame: Frame): void;
  readonly stats: RenderStats;
  dispose(): void;
}

export interface StylePack {
  id: string;
  label: string;
  description: string;
  /** how costly a frame is: the editor scrubs in a fast style, a render worker takes the time */
  speed: 'fast' | 'medium' | 'slow';
  /** for a language model writing a film in this style (colours, contrasts that suit it) */
  hint: string;
  /** colours of the style, for its card in the interface: paper (background), ink, accents */
  swatch: [string, string, string, string];
  create(canvas: CanvasLike, options?: RenderOptions): Renderer;
}
