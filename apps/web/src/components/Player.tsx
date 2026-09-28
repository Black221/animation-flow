// Live preview: the engine evaluates the frame at the playback time, the chosen style pack paints it on the canvas.
// The same code renders final frames on a server, so what you see here is what the render gives.
import { createEvaluator, type Evaluator } from '@af/engine';
import { registry } from '@af/library';
import type { Project } from '@af/schema';
import { getStyle, stylePacks, type Renderer } from '@af/styles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePictures, type LinksFn } from '../pictures';
import { Icon } from '@af/ui';
import { fmtTime, usePlayback, type Playback } from '../playback';

const QUALITIES = [640, 960, 1280, 1920];

/** plays the soundtrack in step with the playback: started at the playhead, restarted when it jumps */
function useAudioSync(pb: Playback, buffer: AudioBuffer | null, on: boolean) {
  const ctx = useRef<AudioContext | null>(null), src = useRef<AudioBufferSourceNode | null>(null), anchor = useRef({ ctxTime: 0, t: 0 });
  useEffect(() => {
    const stop = () => { try { src.current?.stop(); } catch { /* already stopped */ } src.current?.disconnect(); src.current = null; };
    const start = () => {
      if (!buffer) return;
      ctx.current ??= new AudioContext();
      void ctx.current.resume();
      const s = ctx.current.createBufferSource();
      s.buffer = buffer; s.connect(ctx.current.destination);
      s.start(0, Math.min(pb.time, buffer.duration));
      src.current = s; anchor.current = { ctxTime: ctx.current.currentTime, t: pb.time };
    };
    const sync = () => {
      if (!on || !buffer || !pb.playing) { stop(); return; }
      if (!src.current) { start(); return; }
      const heard = anchor.current.t + (ctx.current!.currentTime - anchor.current.ctxTime);
      if (Math.abs(heard - pb.time) > 0.25) { stop(); start(); }
    };
    sync();
    const unsub = pb.subscribe(sync);
    return () => { unsub(); stop(); };
  }, [pb, buffer, on]);
}

export function Player({ project, pb, style, onStyle, audio, sound, onSound, soundInfo, imageLinks }: {
  project: Project; pb: Playback; style: string; onStyle: (s: string) => void;
  audio?: AudioBuffer | null; sound?: boolean; onSound?: (on: boolean) => void; soundInfo?: string;
  /** where the project's pictures come from (default: the workspace) */
  imageLinks?: LinksFn;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [quality, setQuality] = useState(960);
  const [subtitles, setSubtitles] = useState(true);
  const [ms, setMs] = useState(0);
  const ev: Evaluator = useMemo(() => createEvaluator(project, registry), [project]);
  const snap = usePlayback(pb);
  const renderer = useRef<Renderer | null>(null);
  const dirty = useRef(true);
  const images = usePictures(project, useMemo(() => () => { dirty.current = true; }, []), imageLinks);
  useAudioSync(pb, audio ?? null, !!sound);

  useEffect(() => { pb.setDuration(ev.timeline.duration); dirty.current = true; }, [ev, pb]);

  // one renderer per canvas size and style
  useEffect(() => {
    const c = canvas.current!;
    c.width = quality; c.height = Math.round((quality * project.height) / project.width);
    renderer.current?.dispose();
    renderer.current = getStyle(style).create(c, { subtitles, images });
    dirty.current = true;
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, [style, quality, subtitles, project.width, project.height, images]);

  // fonts arrive after the first frame: repaint once they are ready
  useEffect(() => { document.fonts?.ready.then(() => { dirty.current = true; }); }, []);
  useEffect(() => { dirty.current = true; }, [snap.time]);

  useEffect(() => {
    let raf = 0, last = performance.now(), shown = 0;
    const loop = (now: number) => {
      pb.advance((now - last) / 1000); last = now;
      if (dirty.current && renderer.current) {
        dirty.current = false;
        renderer.current.render(ev.frameAt(pb.time));
        if (now - shown > 500) { shown = now; setMs(renderer.current.stats.lastMs); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ev, pb]);

  const scene = ev.timeline.scenes.find((s) => snap.time >= s.start && snap.time < s.start + s.duration) ?? ev.timeline.scenes.at(-1)!;
  return (
    <div className="player">
      <div className="stage" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
        <canvas ref={canvas} data-testid="preview" onClick={() => pb.toggle()} />
      </div>
      <div className="controls">
        <button className="play" onClick={() => pb.toggle()} aria-label={snap.playing ? 'pause' : 'lecture'} title="lecture / pause (espace)"><Icon name={snap.playing ? 'pause' : 'play'} size={18} /></button>
        <input className="scrub" type="range" min={0} max={snap.duration} step={1 / project.fps} value={snap.time} onChange={(e) => { pb.pause(); pb.seek(+e.target.value); }} aria-label="position" />
        <span className="time" data-testid="time">{fmtTime(snap.time)} / {fmtTime(snap.duration)}</span>
      </div>
      <div className="controls secondary">
        <label>Style <select value={style} onChange={(e) => onStyle(e.target.value)} aria-label="style">{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>Aperçu <select value={quality} onChange={(e) => setQuality(+e.target.value)} aria-label="qualité">{QUALITIES.map((q) => <option key={q} value={q}>{q} px</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /> sous-titres</label>
        {onSound && <label className="check"><input type="checkbox" checked={!!sound} onChange={(e) => onSound(e.target.checked)} aria-label="son" /> son</label>}
        {soundInfo && <span className="muted small" data-testid="sound-info">{soundInfo}</span>}
        <span className="muted small">scène {scene.id} · {ms.toFixed(0)} ms / image</span>
      </div>
    </div>
  );
}
