// Decors. The still part is built once per scene and painted as a plate; `live` holds what moves (clouds, twinkles).
// Bounds reach 300 px beyond the frame on every side so a camera pan or a zoom-out below 1 never shows an edge.
import { blob, darken, ellipse, lighten, mix, rng, spline, type DecorFn, type Prim, type Pt } from '@af/engine';
import { P } from './util';

const M = 300;
const band = (id: string, W: number, y: number, amp: number, freq: number, phase: number, bottom: number, fill: string, rand: () => number): Prim => {
  const top: Pt[] = [];
  for (let x = -M; x <= W + M; x += 80) top.push([x, y + Math.sin(x * freq + phase) * amp + (rand() - 0.5) * amp * 0.3]);
  return { kind: 'path', id, points: [...spline(top, 6), [W + M, bottom], [-M, bottom]], closed: true, fill };
};

export const dawnField: DecorFn = ({ params, width: W, height: H, id }) => {
  const p = P(params), [skyTop, skyLow] = p.list('sky', ['#BFD9E6', '#F6D6B0']), sun = p.str('sun', '#F2C14E'), field = p.str('field', '#7FAF6A');
  const r = rng(`${id}:dawn`), horizon = H * 0.56, still: Prim[] = [];
  still.push({ kind: 'gradient', id: `${id}:sky`, x: -M, y: -M, w: W + 2 * M, h: horizon + M + 40, stops: [[0, skyTop!], [0.75, skyLow!], [1, mix(skyLow!, sun, 0.3)]] });
  still.push({ kind: 'glow', id: `${id}:sunGlow`, x: W * 0.76, y: horizon - 110, radius: 330, color: sun, opacity: 0.45 });
  still.push({ kind: 'path', id: `${id}:sun`, points: ellipse(W * 0.76, horizon - 110, 120, 120, 40), closed: true, fill: sun });
  still.push(band(`${id}:hillsFar`, W, horizon - 40, 34, 0.004, 1, H + M, mix(field, skyTop!, 0.55), r));
  still.push(band(`${id}:hillsMid`, W, horizon + 10, 26, 0.006, 3, H + M, mix(field, skyTop!, 0.3), r));
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const y0 = horizon + 60 + i * ((H + M - horizon) / rows) * 0.62;
    const c = i % 2 ? mix(field, '#D9B26A', 0.35) : darken(field, 0.04 * i);
    still.push(band(`${id}:field${i}`, W, y0, 10, 0.003, i * 2, H + M, c, r));
    for (let k = 0; k < 3; k++) {
      const yy = y0 + 28 + k * 22;
      still.push({ kind: 'path', id: `${id}:row${i}_${k}`, points: [[-M, yy], [W + M, yy + 6]], closed: false, stroke: darken(c, 0.2), strokeWidth: 2, opacity: 0.5, role: 'detail' });
    }
  }
  for (let k = 0; k < 40; k++) {
    const x = -M + r() * (W + 2 * M), y = H * 0.84 + r() * (H * 0.2);
    still.push({ kind: 'path', id: `${id}:tuft${k}`, points: [[x - 8, y + 4], [x - 4, y - 16], [x, y + 2], [x + 5, y - 18], [x + 9, y + 4]], closed: false, stroke: darken(field, 0.3), strokeWidth: 2.5, role: 'detail' });
  }
  const clouds = [0, 1, 2].map((k) => ({ x: r() * W, y: 80 + k * 70 + r() * 40, s: 0.7 + r() * 0.6, v: 6 + r() * 8, seed: r() }));
  return {
    bounds: { x: -M, y: -M, w: W + 2 * M, h: H + 2 * M },
    still,
    live: (t) => clouds.map((c, k) => {
      const span = W + 2 * M, x = ((c.x + c.v * t) % span + span) % span - M;
      return { kind: 'path', id: `${id}:cloud${k}`, points: blob(x, c.y, 130 * c.s, 42 * c.s, rng(c.seed * 1e9), 0.22), closed: true, fill: lighten(skyTop!, 0.7), opacity: 0.85, role: 'shade', smooth: true };
    }),
  };
};

export const nightSky: DecorFn = ({ params, width: W, height: H, id }) => {
  const p = P(params), [top, low] = p.list('sky', ['#101E36', '#1F3A5F']), n = Math.min(400, p.num('stars', 90));
  const r = rng(`${id}:night`), still: Prim[] = [], stars: { x: number; y: number; s: number; ph: number }[] = [];
  still.push({ kind: 'gradient', id: `${id}:sky`, x: -M, y: -M, w: W + 2 * M, h: H + 2 * M, stops: [[0, top!], [1, low!]] });
  for (let k = 0; k < n; k++) {
    const s = { x: -M + r() * (W + 2 * M), y: -M + r() * (H * 0.8 + M), s: 1 + r() * 2.2, ph: r() * 6.28 };
    if (k % 6 === 0) stars.push(s);
    else still.push({ kind: 'path', id: `${id}:star${k}`, points: ellipse(s.x, s.y, s.s, s.s, 8), closed: true, fill: '#FFFFFF', opacity: 0.5 + r() * 0.5, role: 'detail' });
  }
  still.push({ kind: 'path', id: `${id}:hill`, points: [...spline([[-M, H * 0.86], [W * 0.3, H * 0.8], [W * 0.7, H * 0.88], [W + M, H * 0.82]], 12), [W + M, H + M], [-M, H + M]], closed: true, fill: darken(low!, 0.35) });
  return {
    bounds: { x: -M, y: -M, w: W + 2 * M, h: H + 2 * M },
    still,
    live: (t) => stars.map((s, k) => ({ kind: 'glow', id: `${id}:tw${k}`, x: s.x, y: s.y, radius: 6 + s.s * 3, color: '#FFFFFF', opacity: 0.35 + 0.35 * Math.sin(t * 2.5 + s.ph) })),
  };
};

export const plain: DecorFn = ({ params, width: W, height: H, id }) => {
  const p = P(params), c = p.str('color', '#FBF3E6');
  return { bounds: { x: -M, y: -M, w: W + 2 * M, h: H + 2 * M }, still: [{ kind: 'path', id: `${id}:bg`, points: [[-M, -M], [W + M, -M], [W + M, H + M], [-M, H + M]], closed: true, fill: c }] };
};
