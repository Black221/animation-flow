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
  create(canvas: CanvasLike, options?: RenderOptions): Renderer;
}
