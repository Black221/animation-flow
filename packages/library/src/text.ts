// `text` elements: a title, a caption, a stamp. Centred on the element's position.
import { roundRect, type ComponentFn, type FontRole, type Prim } from '@af/engine';
import { body, P } from './util';

const FONTS: FontRole[] = ['display', 'body', 'marker', 'hand'];

export const text: ComponentFn = ({ id, params, state }) => {
  const p = P(params), s = state.text ?? p.str('text', ''), size = p.num('size', 48), color = p.str('color', '#1F3A5F');
  const f = p.str('font', 'display'), font = (FONTS as string[]).includes(f) ? (f as FontRole) : 'display';
  const out: Prim[] = [], lines = s.split('\n');
  if (p.bool('frame', false)) {
    // letters average ~0.55 em wide: good enough for a hand-drawn frame
    const w = Math.max(...lines.map((l) => l.length)) * size * 0.56 + size, h = lines.length * size * 1.2 + size * 0.5;
    out.push(body(`${id}:frame`, roundRect(-w / 2, -h / 2, w, h, size * 0.25), p.str('frameFill', '#FFF8EC'), { stroke: color, strokeWidth: 4 }));
  }
  out.push({ kind: 'text', id: `${id}:text`, x: 0, y: 0, text: s, size, color, font, weight: p.num('weight', 700), align: 'center', rotation: 0, opacity: 1, ...(p.opt('outline') ? { outline: p.opt('outline')! } : {}) });
  const sub = p.opt('subtitle');
  if (sub) out.push({ kind: 'text', id: `${id}:sub`, x: 0, y: size * 0.95, text: sub, size: size * 0.4, color: p.str('subtitleColor', '#8A5A2B'), font: 'body', weight: 600, align: 'center', rotation: 0, opacity: 1 });
  return out;
};
