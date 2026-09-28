// Choosing a film's style by seeing it: each style is a card with the example film drawn in it (it plays while the
// card is hovered or focused), its speed and what it suits. Inline as a lane of cards, or behind a button in a dialog.
import { createEvaluator, type Evaluator } from '@af/engine';
import { registry } from '@af/library';
import { exampleProject, parseProject } from '@af/schema';
import { getStyle, stylePacks, type StylePack } from '@af/styles';
import { Dialog, Icon } from '@af/ui';
import { useEffect, useRef, useState } from 'react';
import { pictureOf } from '../pictures';

const SPEED: Record<StylePack['speed'], string> = { fast: 'rapide', medium: 'moyen', slow: 'soigné, plus lent' };
let example: Evaluator | null | undefined;
const exampleEv = () => {
  if (example === undefined) { const p = parseProject(exampleProject); example = p.ok ? createEvaluator(p.project, registry) : null; }
  return example;
};

function StylePreview({ id, playing }: { id: string; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, ev = exampleEv();
    if (!c || !ev) return;
    c.width = 320; c.height = 180;
    const r = getStyle(id).create(c, { images: pictureOf });
    let raf = 0;
    if (playing && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t0 = performance.now(), from = 2, span = Math.min(10, ev.timeline.duration - from);
      const draw = (now: number) => { r.render(ev.frameAt(from + (((now - t0) / 1000) % span))); raf = requestAnimationFrame(draw); };
      raf = requestAnimationFrame(draw);
    } else r.render(ev.frameAt(6));
    return () => { cancelAnimationFrame(raf); r.dispose(); };
  }, [id, playing]);
  return <canvas ref={ref} aria-hidden />;
}

function StyleCard({ s, selected, onPick }: { s: StylePack; selected: boolean; onPick: () => void }) {
  const [on, setOn] = useState(false);
  return (
    <button type="button" role="radio" aria-checked={selected} className={`style-card${selected ? ' selected' : ''}`} onClick={onPick}
      onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)} aria-label={`style ${s.label}`}>
      <span className="style-frame"><StylePreview id={s.id} playing={on} />{selected && <span className="style-check"><Icon name="check" size={14} /></span>}</span>
      <span className="style-name"><strong>{s.label}</strong><span className="style-swatch" aria-hidden>{s.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span></span>
      <span className="muted small">{s.description}</span>
      <span className={`badge speed-${s.speed}`}>{SPEED[s.speed]}</span>
    </button>
  );
}

export function StyleCards({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="style-cards" role="radiogroup" aria-label="styles">
      {Object.values(stylePacks).map((s) => <StyleCard key={s.id} s={s} selected={s.id === value} onPick={() => onChange(s.id)} />)}
    </div>
  );
}

/** the style, as a compact button that opens the cards in a dialog */
export function StyleButton({ value, onChange, className = '' }: { value: string; onChange: (id: string) => void; className?: string }) {
  const [open, setOpen] = useState(false), s = getStyle(value);
  return (
    <>
      <button type="button" className={`style-button ${className}`} onClick={() => setOpen(true)} aria-label={`style du film : ${s.label}`} aria-haspopup="dialog">
        <span className="style-swatch" aria-hidden>{s.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span> {s.label} <Icon name="chevron" size={14} />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Style du film" description="Le même film se dessine dans chaque style : survolez une carte pour la voir bouger. Le style se change à tout moment, jusqu'au rendu." icon="brush" size="xl"
        footer={<button className="primary" onClick={() => setOpen(false)}>Choisir {s.label}</button>}>
        {open && <StyleCards value={value} onChange={onChange} />}
      </Dialog>
    </>
  );
}
