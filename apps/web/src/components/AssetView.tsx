// One drawing of the film, staged as the model sees it when it checks its work (a character four times, a prop
// next to a person, a decor alone), and animated: the poses play.
import { previewProject } from '@af/ai';
import { createEvaluator } from '@af/engine';
import { registry } from '@af/library';
import { parseProject, type Asset } from '@af/schema';
import { getStyle } from '@af/styles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePictures } from '../pictures';

const noop = () => undefined;

export function AssetView({ id, asset, style, width = 640 }: { id: string; asset: Asset; style: string; width?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const project = useMemo(() => { const r = parseProject(previewProject(id, asset, style)); return r.ok ? r.project : null; }, [id, asset, style]);
  const images = usePictures({ assets: { [id]: asset } }, noop); // it repaints every frame anyway
  useEffect(() => {
    if (!project) { setError('dessin invalide'); return; }
    setError('');
    const c = canvas.current!;
    c.width = width; c.height = Math.round((width * 9) / 16);
    const ev = createEvaluator(project, registry), renderer = getStyle(style).create(c, { images });
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => { renderer.render(ev.frameAt(((now - t0) / 1000) % 2)); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); renderer.dispose(); };
  }, [project, style, width, images]);
  return (
    <div className="asset-view">
      <canvas ref={canvas} data-testid={`asset-view-${id}`} />
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
