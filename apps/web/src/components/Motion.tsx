// Motion in the interface itself, since that is what the app makes: a film playing live (drawn by the same engine as
// the editor), cards that come alive under the pointer, loading placeholders that shimmer, a motion path with its
// keyframes. All of it holds still for people who ask their system for less motion.
import { createEvaluator, type Evaluator } from '@af/engine';
import { registry } from '@af/library';
import { parseProject, type Project } from '@af/schema';
import { getStyle } from '@af/styles';
import { useEffect, useRef, useState } from 'react';
import { pictureOf } from '../pictures';
import { Icon } from './Icon';

export function useReducedMotion() {
  const q = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(!!q?.matches);
  useEffect(() => { if (!q) return; const f = () => setReduced(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [q]);
  return reduced;
}

/** plays an evaluator into a canvas while `playing` (and while the canvas is on screen); a still frame otherwise */
function usePlay(canvas: React.RefObject<HTMLCanvasElement | null>, ev: Evaluator | null, playing: boolean, opts: { width: number; start?: number; style?: string; onTime?: (t: number) => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ev) return;
    c.width = opts.width; c.height = Math.round((opts.width * 9) / 16);
    const r = getStyle(opts.style ?? 'flat').create(c, { images: pictureOf });
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
  }, [canvas, ev, playing, reduced, opts.width, opts.start, opts.style]); // eslint-disable-line react-hooks/exhaustive-deps
}

const templates = new Map<string, Promise<Project | null>>();
const templateOf = (name: string) => {
  if (!templates.has(name)) templates.set(name, fetch(`/api/templates/${name}`).then((r) => (r.ok ? r.json() : null)).then((j) => { const p = j && parseProject(j); return p && p.ok ? p.project : null; }).catch(() => null));
  return templates.get(name)!;
};

/** a film of the templates, playing on a little stage with its timeline and playhead: what the app makes, at a glance */
export function LiveStage({ template = 'pizza', caption = true }: { template?: string; caption?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ev, setEv] = useState<Evaluator | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => { let alive = true; void templateOf(template).then((p) => { if (alive && p) setEv(createEvaluator(p, registry)); }); return () => { alive = false; }; }, [template]);
  const last = useRef(0);
  usePlay(canvas, ev, true, { width: 640, onTime: (x) => { if (Math.abs(x - last.current) > 0.1) { last.current = x; setT(x); } } });
  const tl = ev?.timeline, scene = tl?.scenes.find((s) => t >= s.start && t < s.start + s.duration);
  return (
    <figure className="live-stage" aria-label="un film fait avec l'application, qui joue">
      <div className="screen"><canvas ref={canvas} aria-hidden />{!ev && <div className="skeleton fill" />}<span className="live-badge"><span className="dot" /> en direct</span></div>
      {tl && (
        <div className="mini-timeline" aria-hidden>
          {tl.scenes.map((s) => <span key={s.id} className={s === scene ? 'on' : ''} style={{ flexGrow: s.duration }} />)}
          <i style={{ left: `${(t / tl.duration) * 100}%` }} />
        </div>
      )}
      {caption && <figcaption className="muted small"><Icon name="film" size={13} /> {scene ? `${scene.id} · ` : ''}Pizza Time — dessiné, composé et animé par l'IA, joué ici par le moteur</figcaption>}
    </figure>
  );
}

/** a card's frame that plays its film while the card is hovered or focused (`active`, driven by the card: its link
 *  covers it); the project is fetched once, the first time */
export function HoverPlay({ load, still, active }: { load: () => Promise<unknown>; still: string; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), cache = useRef<Promise<Evaluator | null> | null>(null);
  const [ev, setEv] = useState<Evaluator | null>(null);
  useEffect(() => {
    if (!active) return;
    cache.current ??= load().then((j) => { const p = parseProject(j); return p.ok ? createEvaluator(p.project, registry) : null; }).catch(() => null);
    let alive = true;
    void cache.current.then((e) => { if (alive && e) setEv(e); });
    return () => { alive = false; };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  usePlay(canvas, active ? ev : null, active, { width: 480, start: 0.5 });
  return (
    <span className={`thumb${active && ev ? ' playing' : ''}`}>
      <img src={still} alt="" loading="lazy" />
      <canvas ref={canvas} aria-hidden />
      <span className="play-hint" aria-hidden><Icon name="play" size={14} /></span>
    </span>
  );
}

/** hovered or focused: what makes a card play */
export function useHover() {
  const [on, setOn] = useState(false);
  return { on, bind: { onPointerEnter: () => setOn(true), onPointerLeave: () => setOn(false), onFocus: () => setOn(true), onBlur: () => setOn(false) } };
}

/** placeholders while cards load */
export function SkeletonGrid({ n = 4 }: { n?: number }) {
  return (
    <ul className="project-grid" aria-busy="true" aria-label="chargement">
      {Array.from({ length: n }, (_, i) => <li key={i} className="project-card skeleton-card"><span className="thumb skeleton" /><div className="body"><span className="skeleton line" /><span className="skeleton line short" /></div></li>)}
    </ul>
  );
}

/** a motion path with its keyframes, a dot travelling along it: a decoration for heroes */
export function MotionPath({ className = '' }: { className?: string }) {
  const d = 'M 10 150 C 90 20, 190 20, 260 90 S 420 170, 500 40';
  return (
    <svg className={`motion-path ${className}`} viewBox="0 0 520 180" aria-hidden focusable="false">
      <path d={d} className="track" />
      {[[10, 150], [140, 42], [260, 90], [390, 150], [500, 40]].map(([x, y], i) => <rect key={i} x={x! - 6} y={y! - 6} width="12" height="12" rx="2" transform={`rotate(45 ${x} ${y})`} className="key" />)}
      <circle r="8" className="ball"><animateMotion dur="4s" repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" /></circle>
    </svg>
  );
}
