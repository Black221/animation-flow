// A small frame of a scene for the scene list, drawn by the same engine as the preview (flat style: quick). Redrawn
// a moment after the project stops changing, not on every keystroke.
import type { Evaluator } from '@af/engine';
import { getStyle } from '@af/styles';
import { useEffect, useRef } from 'react';
import { pictureOf } from '../pictures';

export function SceneThumb({ ev, t, width = 128 }: { ev: Evaluator; t: number; width?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const c = canvas.current;
      if (!c) return;
      c.width = width; c.height = Math.round((width * 9) / 16);
      const r = getStyle('flat').create(c, { images: pictureOf });
      try { r.render(ev.frameAt(t)); } catch { /* a scene being edited may not draw yet */ } finally { r.dispose(); }
    }, 350);
    return () => clearTimeout(id);
  }, [ev, t, width]);
  return <span className="scene-thumb" aria-hidden><canvas ref={canvas} /></span>;
}
