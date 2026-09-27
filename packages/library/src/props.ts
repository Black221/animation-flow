// Props. Origin at the base centre unless noted (signs and padlocks are centred, they usually float).
import { darken, ellipse, lighten, roundRect, star, type ComponentFn, type Prim, type Pt } from '@af/engine';
import { body, INK, limb, line, P } from './util';

export const tractor: ComponentFn = ({ id, params }) => {
  const p = P(params), c = p.str('color', '#3E7C4A'), wheel = p.str('wheel', '#D99A3D');
  const out: Prim[] = [];
  out.push({ kind: 'path', id: `${id}:shadow`, points: ellipse(0, 0, 230, 16, 24), closed: true, fill: '#000000', opacity: 0.12, role: 'shade' });
  out.push(limb(`${id}:pipe`, [[70, -175], [70, -250]], '#555B61', 12));
  out.push(body(`${id}:cabin`, [[-150, -150], [-120, -300], [20, -300], [40, -150]], darken(c, 0.12)));
  out.push(body(`${id}:window`, [[-128, -160], [-104, -282], [6, -282], [22, -160]], '#BFE3EE', { strokeWidth: 3 }));
  out.push(line(`${id}:frame`, [[-46, -282], [-40, -160]], INK, 4));
  out.push(body(`${id}:roof`, roundRect(-135, -318, 170, 22, 6), '#2F5DA0', { strokeWidth: 3 }));
  out.push(body(`${id}:body`, roundRect(-190, -160, 380, 105, 16), c));
  out.push(body(`${id}:hood`, roundRect(30, -150, 170, 80, 14), lighten(c, 0.08), { strokeWidth: 3 }));
  out.push(body(`${id}:bolt`, [[110, -140], [92, -104], [110, -104], [96, -72], [128, -114], [110, -114], [124, -140]], '#3BC4D8', { strokeWidth: 2.5, role: 'detail' }));
  const wheelAt = (k: string, x: number, r: number) => {
    out.push(body(`${id}:tire${k}`, ellipse(x, -r, r, r, 36), '#3A3530'));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; out.push(line(`${id}:tread${k}${i}`, [[x + Math.cos(a) * r * 0.8, -r + Math.sin(a) * r * 0.8], [x + Math.cos(a) * r * 0.97, -r + Math.sin(a) * r * 0.97]], '#1E1B18', 4)); }
    out.push(body(`${id}:hub${k}`, ellipse(x, -r, r * 0.5, r * 0.5, 24), wheel, { strokeWidth: 3 }));
    out.push(body(`${id}:cap${k}`, ellipse(x, -r, r * 0.16, r * 0.16, 12), '#5A4A3A', { strokeWidth: 2.5, role: 'detail' }));
  };
  wheelAt('B', -100, 80);
  wheelAt('F', 125, 52);
  return out;
};

export const sensor: ComponentFn = ({ id, t, params }) => {
  const p = P(params), glow = p.str('glow', '#3BC4D8'), phase = p.num('phase', 0);
  const pulse = 0.5 + 0.5 * Math.sin(t * 3 + phase);
  return [
    limb(`${id}:stake`, [[0, 0], [0, -46]], '#A9A39A', 12),
    body(`${id}:cap`, [...ellipse(0, -46, 26, 20, 18, Math.PI, Math.PI * 2), [26, -44], [-26, -44]], lighten(glow, 0.35), { strokeWidth: 3 }),
    { kind: 'path', id: `${id}:led`, points: ellipse(0, -58, 6, 6, 10), closed: true, fill: glow, role: 'detail' },
    { kind: 'glow', id: `${id}:glow`, x: 0, y: -58, radius: 34 + 14 * pulse, color: glow, opacity: 0.25 + 0.4 * pulse },
  ];
};

/** a board with text; `text` may hold several lines separated by \n. Centred on the origin. */
export const sign: ComponentFn = ({ id, params, state }) => {
  const p = P(params), w = p.num('width', 420), h = p.num('height', 160), text = state.text ?? p.str('text', '');
  const board = p.str('board', '#F6EBD6'), ink = p.str('ink', '#1F3A5F'), out: Prim[] = [];
  if (p.bool('post', false)) out.push(limb(`${id}:post`, [[0, h / 2 - 10], [0, h / 2 + 170]], '#8A6A4A', 16));
  out.push(body(`${id}:board`, roundRect(-w / 2, -h / 2, w, h, 16), board));
  out.push({ kind: 'path', id: `${id}:inner`, points: roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 10), closed: true, stroke: darken(board, 0.18), strokeWidth: 2, role: 'detail' });
  const lines = text.split('\n'), size = Math.min(p.num('size', 44), (h * 0.72) / lines.length / 1.2, (w * 0.9) / Math.max(1, ...lines.map((l) => l.length)) / 0.55);
  lines.forEach((l, i) => out.push({ kind: 'text', id: `${id}:t${i}`, x: 0, y: (i - (lines.length - 1) / 2) * size * 1.2, text: l, size, color: ink, font: 'display', weight: i === 0 ? 700 : 500, align: 'center', rotation: 0, opacity: 1 }));
  return out;
};

export const padlock: ComponentFn = ({ id, params }) => {
  const p = P(params), c = p.str('color', '#D99A3D');
  return [
    limb(`${id}:shackle`, [...ellipse(0, -40, 44, 50, 16, Math.PI, Math.PI * 2), [44, -10]].map(([x, y]) => [x, y] as Pt), '#9AA3AD', 16),
    body(`${id}:body`, roundRect(-66, -30, 132, 104, 18), c),
    body(`${id}:hole`, [...ellipse(0, 8, 13, 13, 14), [8, 46], [-8, 46]], INK, { strokeWidth: 2, role: 'detail' }),
    { kind: 'path', id: `${id}:shine`, points: roundRect(-52, -20, 18, 60, 8), closed: true, fill: lighten(c, 0.45), opacity: 0.6, role: 'shade' },
  ];
};

export const tree: ComponentFn = ({ id, t, params }) => {
  const p = P(params), leaf = p.str('leaves', '#5E9E57'), sway = Math.sin(t * 0.9) * 3;
  return [
    limb(`${id}:trunk`, [[0, 0], [4, -90], [-4, -170]], '#7A5234', 30),
    limb(`${id}:branch`, [[0, -120], [38, -160]], '#7A5234', 12),
    body(`${id}:leaves0`, ellipse(-42 + sway, -210, 70, 58, 26), darken(leaf, 0.12), { smooth: true }),
    body(`${id}:leaves1`, ellipse(40 + sway, -220, 72, 60, 26), leaf, { smooth: true }),
    body(`${id}:leaves2`, ellipse(sway, -270, 76, 62, 26), lighten(leaf, 0.1), { smooth: true }),
  ];
};

export const house: ComponentFn = ({ id, params }) => {
  const p = P(params), wall = p.str('wall', '#F2E3C8'), roof = p.str('roof', '#C8553D');
  return [
    body(`${id}:wall`, [[-110, 0], [-110, -150], [110, -150], [110, 0]], wall),
    body(`${id}:roof`, [[-135, -140], [0, -250], [135, -140]], roof),
    body(`${id}:door`, roundRect(-26, -90, 52, 90, 10), '#8A5A3C', { strokeWidth: 3 }),
    body(`${id}:win`, roundRect(46, -118, 44, 40, 6), '#BFE3EE', { strokeWidth: 3, role: 'detail' }),
  ];
};

export const tablet: ComponentFn = ({ id, params }) => {
  const p = P(params), glow = p.str('glow', '#3BC4D8');
  return [
    body(`${id}:frame`, roundRect(-60, -45, 120, 90, 12), '#2D3A4A'),
    { kind: 'path', id: `${id}:screen`, points: roundRect(-50, -36, 100, 72, 8), closed: true, fill: lighten(glow, 0.3), role: 'detail' },
    { kind: 'glow', id: `${id}:glow`, x: 0, y: 0, radius: 90, color: glow, opacity: 0.3 },
  ];
};

export const sparkle: ComponentFn = ({ id, local, params }) => {
  const p = P(params), c = p.str('color', '#F2C14E'), k = 1 + 0.15 * Math.sin(local * 8);
  return [
    { kind: 'glow', id: `${id}:glow`, x: 0, y: 0, radius: 60 * k, color: c, opacity: 0.45 },
    body(`${id}:star`, star(0, 0, 34 * k, 13 * k, 4), c, { strokeWidth: 2.5 }),
  ];
};
