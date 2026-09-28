// The interface speaks the language of what it makes: timelines, keyframes, a playhead, the camera's frame, a
// storyboard, a bouncing ball, an animator's spacing chart. Cards show their film's timeline (and play it, playhead
// running, under the pointer); loaders are the animator's first exercise; everything holds still for people who ask
// their system for less motion.
import { createEvaluator, type Evaluator } from '@af/engine';
import { registry } from '@af/library';
import { parseProject } from '@af/schema';
import { getStyle } from '@af/styles';
import { useEffect, useRef, useState } from 'react';
import { pictureOf } from '../pictures';

export function useReducedMotion() {
  const q = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(!!q?.matches);
  useEffect(() => { if (!q) return; const f = () => setReduced(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [q]);
  return reduced;
}

/** seconds as a timecode: 0:41, 2:05 */
export const timecode = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };

/** plays an evaluator into a canvas while `playing` (and while the canvas is on screen); a still frame otherwise */
function usePlay(canvas: React.RefObject<HTMLCanvasElement | null>, ev: Evaluator | null, playing: boolean, opts: { width: number; start?: number; onTime?: (t: number) => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ev) return;
    c.width = opts.width; c.height = Math.round((opts.width * 9) / 16);
    const r = getStyle('flat').create(c, { images: pictureOf });
    const d = Math.max(0.1, ev.timeline.duration), t0 = performance.now() - (opts.start ?? 0) * 1000;
    let raf = 0, visible = true;
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }) : null;
    io?.observe(c);
    const draw = (now: number) => {
      const t = ((now - t0) / 1000) % d;
      if (visible) { r.render(ev.frameAt(t)); opts.onTime?.(t); }
      raf = requestAnimationFrame(draw);
    };
    if (playing && !reduced) raf = requestAnimationFrame(draw);
    else r.render(ev.frameAt(opts.start ?? Math.min(2, d / 3)));
    return () => { cancelAnimationFrame(raf); io?.disconnect(); r.dispose(); };
  }, [canvas, ev, playing, reduced, opts.width, opts.start]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** a card's frame that plays its film while the card is hovered or focused (`active`, driven by the card: its link
 *  covers it); the project is fetched once, the first time. `onTime` follows the playhead (null: stopped). */
export function HoverPlay({ load, still, active, onTime }: { load: () => Promise<unknown>; still: string; active: boolean; onTime?: (t: number | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), cache = useRef<Promise<Evaluator | null> | null>(null);
  const [ev, setEv] = useState<Evaluator | null>(null);
  useEffect(() => {
    if (!active) { onTime?.(null); return; }
    cache.current ??= load().then((j) => { const p = parseProject(j); return p.ok ? createEvaluator(p.project, registry) : null; }).catch(() => null);
    let alive = true;
    void cache.current.then((e) => { if (alive && e) setEv(e); });
    return () => { alive = false; };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef(-1);
  usePlay(canvas, active ? ev : null, active, { width: 480, start: 0.5, onTime: (t) => { if (Math.abs(t - last.current) > 0.08) { last.current = t; onTime?.(t); } } });
  return (
    <span className={`thumb frame${active && ev ? ' playing' : ''}`}>
      <img src={still} alt="" loading="lazy" />
      <canvas ref={canvas} aria-hidden />
      <span className="play-hint" aria-hidden><svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></span>
    </span>
  );
}

/** hovered or focused: what makes a card play; `t`: where its film is */
export function useHover() {
  const [on, setOn] = useState(false), [t, setT] = useState<number | null>(null);
  return { on, t, setT, bind: { onPointerEnter: () => setOn(true), onPointerLeave: () => setOn(false), onFocus: () => setOn(true), onBlur: () => setOn(false) } };
}

/** a film's timeline, as on the editor's: one clip per scene (its length), a keyframe where each one starts, the
 *  running time; with `t`, the playhead */
export function SceneStrip({ scenes, t = null, total }: { scenes: number[]; t?: number | null; total?: number }) {
  const d = total ?? scenes.reduce((a, b) => a + b, 0);
  if (!d) return null;
  const at = t == null ? null : Math.min(1, t / d);
  let start = 0;
  return (
    <span className="scene-strip" role="img" aria-label={`${scenes.length || 1} scène${scenes.length > 1 ? 's' : ''}, ${timecode(d)}`}>
      <span className="clips">
        {(scenes.length ? scenes : [d]).map((s, i) => {
          const on = t != null && t >= start && t < start + s; start += s;
          return <span key={i} className={on ? 'on' : ''} style={{ flexGrow: s }} />;
        })}
        {at != null && <i className="playhead" style={{ left: `${at * 100}%` }} />}
      </span>
      <span className="tc">{at != null ? `${timecode(t!)} / ` : ''}{timecode(d)}</span>
    </span>
  );
}

/** placeholders while cards load: empty frames, a playhead scanning them */
export function SkeletonGrid({ n = 4 }: { n?: number }) {
  return (
    <ul className="project-grid" aria-busy="true" aria-label="chargement">
      {Array.from({ length: n }, (_, i) => <li key={i} className="project-card skeleton-card"><span className="thumb frame skeleton" /><div className="body"><span className="skeleton line" /><span className="skeleton line short" /></div></li>)}
    </ul>
  );
}

/** the animator's first exercise, as the loader: a ball that bounces, squashes and stretches */
export function Bounce({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="bounce" role="status">
      <span className="stage" aria-hidden><span className="ball" /><span className="shadow" /></span>
      <span className="muted">{label}</span>
    </div>
  );
}
export const Loading = ({ label }: { label?: string }) => <div className="page"><Bounce label={label} /></div>;

/** what happens after « Générer », as a timeline: a keyframe per stage, the playhead on the idea until it runs */
export const STAGES: [string, string][] = [
  ['Idée', 'votre texte, vos choix'],
  ['Storyboard', 'les scènes, les répliques, les plans'],
  ['Dessins', 'personnages, accessoires, décors'],
  ['Voix & musique', 'la partition, les bruitages, les voix'],
  ['Animation', 'caméra, poses, expressions'],
  ['Film', 'à relire, retoucher, publier'],
];
export function Pipeline({ ready = false, running = false }: { ready?: boolean; running?: boolean }) {
  return (
    <ol className={`pipeline${ready ? ' ready' : ''}${running ? ' running' : ''}`} aria-label="ce qui se passe ensuite">
      {STAGES.map(([t, d], i) => (
        <li key={t} className={i === 0 ? 'first' : ''}>
          <span className="kf" aria-hidden />
          <strong>{t}</strong>
          <span className="muted small">{d}</span>
        </li>
      ))}
      <li className="playhead" aria-hidden />
    </ol>
  );
}

/** a storyboard of a template: a panel per scene (a frame the server draws), its title as the note, its timeline */
export function Storyboard({ template = 'pizza', panels = 4 }: { template?: string; panels?: number }) {
  const [scenes, setScenes] = useState<{ id: string; title: string; d: number }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/templates/${template}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const p = j ? parseProject(j) : null;
      if (alive && p?.ok) { const tl = createEvaluator(p.project, registry).timeline; setScenes(p.project.scenes.map((s, i) => ({ id: s.id, title: s.title ?? '', d: tl.scenes[i]!.duration }))); }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [template]);
  const shown = scenes.length ? scenes.slice(0, panels) : Array.from({ length: panels }, (_, i) => ({ id: `s${i + 1}`, title: '', d: 0 }));
  return (
    <figure className="storyboard" aria-label="un storyboard">
      <ol>
        {shown.map((s, i) => (
          <li key={s.id}>
            <span className="thumb frame">{scenes.length ? <img src={`/api/templates/${template}/thumbnail.png?scene=${i}`} alt="" /> : <span className="skeleton fill" />}</span>
            <span className="note"><span className="sid">SC {String(i + 1).padStart(2, '0')}</span><span className="t">{s.title}</span>{s.d ? <span className="tc">{timecode(s.d)}</span> : null}</span>
          </li>
        ))}
      </ol>
      {scenes.length > 0 && <SceneStrip scenes={scenes.map((s) => s.d)} />}
    </figure>
  );
}

/** an animator's spacing chart: a ball's arc drawn frame by frame, the drawings closer where it slows (ease in and out),
 *  its keys marked. A still decoration for heroes. */
export function SpacingChart({ className = '' }: { className?: string }) {
  const n = 13, ease = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;
  const pts = Array.from({ length: n }, (_, i) => { const u = ease(i / (n - 1)); return [20 + u * 480, 150 - Math.sin(u * Math.PI) * 120] as const; });
  return (
    <svg className={`spacing-chart ${className}`} viewBox="0 0 520 180" aria-hidden focusable="false">
      <path d={`M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')}`} className="track" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 0 || i === n - 1 || i === (n - 1) / 2 ? 9 : 6} className={i === 0 || i === n - 1 || i === (n - 1) / 2 ? 'key' : 'inbetween'} style={{ opacity: 0.25 + (0.75 * i) / (n - 1) }} />)}
      <line x1="10" x2="510" y1="166" y2="166" className="ground" />
    </svg>
  );
}
