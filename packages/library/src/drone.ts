// `drone`: a small flying robot with a screen face (Jumo). Origin at the hover point below the body; it bobs on its
// own. Proportions: body 144 × 136, rotors 90 px out on each side, visor 104 × 70.
import { darken, ellipse, lighten, roundRect, spline, type ComponentFn, type Prim, type Pt } from '@af/engine';
import { body, INK, limb, line, P } from './util';

export const DRONE_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'thinking', 'sad', 'sleepy', 'loading', 'love'] as const;

function screenFace(id: string, expr: string, t: number, cx: number, cy: number, c: string): Prim[] {
  const out: Prim[] = [], w = 5;
  const eye = (k: number) => cx + (k ? 20 : -20);
  const blink = (t % 4.3) < 0.1;
  switch (expr) {
    case 'happy': [0, 1].forEach((k) => out.push(line(`${id}:e${k}`, spline([[eye(k) - 10, cy + 2], [eye(k), cy - 9], [eye(k) + 10, cy + 2]], 4), c, w))); break;
    case 'surprised': [0, 1].forEach((k) => out.push({ kind: 'path', id: `${id}:e${k}`, points: ellipse(eye(k), cy - 3, 9, 10, 14), closed: true, stroke: c, strokeWidth: w, role: 'detail' })); break;
    case 'thinking':
      out.push(line(`${id}:e0`, [[eye(0) - 9, cy - 2], [eye(0) + 9, cy - 2]], c, w));
      out.push({ kind: 'path', id: `${id}:e1`, points: ellipse(eye(1), cy - 3, 6, 6, 10), closed: true, fill: c, role: 'detail' });
      [0, 1, 2].forEach((k) => out.push({ kind: 'path', id: `${id}:dot${k}`, points: ellipse(cx - 12 + k * 12, cy + 18, 2.6, 2.6, 8), closed: true, fill: c, opacity: 0.4 + 0.6 * (Math.floor(t * 3) % 3 === k ? 1 : 0), role: 'detail' }));
      return out;
    case 'sad': [0, 1].forEach((k) => out.push(line(`${id}:e${k}`, [[eye(k) - 9, cy - (k ? 6 : 0)], [eye(k) + 9, cy - (k ? 0 : 6)]], c, w))); break;
    case 'sleepy': [0, 1].forEach((k) => out.push(line(`${id}:e${k}`, [[eye(k) - 9, cy], [eye(k) + 9, cy]], c, w))); break;
    case 'loading':
      for (let k = 0; k < 8; k++) { const a = t * 6 + (k * Math.PI) / 4; out.push({ kind: 'path', id: `${id}:ld${k}`, points: ellipse(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 3.2, 3.2, 8), closed: true, fill: c, opacity: 0.2 + 0.8 * (k / 8), role: 'detail' }); }
      return out;
    case 'love': [0, 1].forEach((k) => { const x = eye(k), y = cy - 3; out.push({ kind: 'path', id: `${id}:e${k}`, points: spline([[x, y + 9], [x - 10, y - 1], [x - 5, y - 8], [x, y - 3], [x + 5, y - 8], [x + 10, y - 1], [x, y + 9]], 4), closed: true, fill: '#FF8FA3', role: 'detail' }); }); break;
    default:
      [0, 1].forEach((k) => out.push(blink
        ? line(`${id}:e${k}`, [[eye(k) - 8, cy - 2], [eye(k) + 8, cy - 2]], c, w)
        : { kind: 'path', id: `${id}:e${k}`, points: roundRect(eye(k) - 6, cy - 12, 12, 18, 6, 3), closed: true, fill: c, role: 'detail' }));
  }
  if (expr !== 'sleepy') out.push(line(`${id}:m`, spline([[cx - 8, cy + 14], [cx, cy + (expr === 'sad' ? 11 : 18)], [cx + 8, cy + 14]], 4), c, 4));
  return out;
}

export const drone: ComponentFn = ({ id, local, params, state }) => {
  const p = P(params), col = p.str('body', '#3F7FC4'), scr = p.str('screen', '#1F3A5F'), glow = p.str('glow', '#3BC4D8');
  const bob = Math.sin(local * 2.4) * 8, cy = -110 + bob, out: Prim[] = [];
  out.push({ kind: 'path', id: `${id}:shadow`, points: ellipse(0, 40, 50 - bob, 9, 18), closed: true, fill: '#000000', opacity: 0.1, role: 'shade' });
  // rotor arms and rotors (the blades blur as they spin)
  ([-1, 1] as const).forEach((s, k) => {
    const hub: Pt = [s * 92, cy - 62];
    out.push(limb(`${id}:arm${k}`, [[s * 50, cy - 30], [s * 76, cy - 52], hub], darken(col, 0.2), 11));
    out.push(body(`${id}:hub${k}`, ellipse(hub[0], hub[1] - 4, 9, 7, 12), '#C9D3DD', { strokeWidth: 2.5 }));
    const spin = Math.abs(Math.cos(local * 38 + k));
    out.push({ kind: 'path', id: `${id}:blade${k}`, points: ellipse(hub[0], hub[1] - 10, 12 + 38 * spin, 4.5, 20), closed: true, fill: '#DDE6EE', stroke: INK, strokeWidth: 2, opacity: 0.85, role: 'detail' });
  });
  if (p.bool('antennas', false)) ([-1, 1] as const).forEach((s, k) => {
    const tip: Pt = [s * 22 + Math.sin(local * 3 + k) * 3, cy - 110];
    out.push(line(`${id}:ant${k}`, [[s * 16, cy - 62], tip], INK, 4));
    out.push(body(`${id}:bulb${k}`, ellipse(tip[0], tip[1], 9, 9, 12), k ? '#F2C14E' : glow, { strokeWidth: 2.5 }));
    out.push({ kind: 'glow', id: `${id}:bulbGlow${k}`, x: tip[0], y: tip[1], radius: 26, color: k ? '#F2C14E' : glow, opacity: 0.35 + 0.25 * Math.sin(local * 4 + k) });
  });
  out.push(body(`${id}:body`, ellipse(0, cy, 72, 68, 36), col));
  out.push({ kind: 'path', id: `${id}:shine`, points: ellipse(-30, cy - 38, 16, 9, 12), closed: true, fill: lighten(col, 0.45), opacity: 0.7, role: 'shade' });
  out.push(body(`${id}:visor`, roundRect(-52, cy - 38, 104, 70, 28), scr, { strokeWidth: 3 }));
  out.push({ kind: 'glow', id: `${id}:visorGlow`, x: 0, y: cy - 4, radius: 70, color: glow, opacity: 0.25 });
  out.push(...screenFace(`${id}:face`, state.expression, local, 0, cy - 2, glow));
  ([-1, 1] as const).forEach((s, k) => out.push(body(`${id}:foot${k}`, ellipse(s * 26, cy + 70, 14, 8, 12), darken(col, 0.25), { strokeWidth: 3 })));
  const badge = p.opt('badge');
  if (badge) {
    out.push(body(`${id}:badge`, roundRect(22, cy + 30, 78, 26, 8), '#FFF1C9', { strokeWidth: 2.5, role: 'detail' }));
    out.push({ kind: 'text', id: `${id}:badgeText`, x: 61, y: cy + 43, text: badge, size: 14, color: '#1F3A5F', font: 'body', weight: 600, align: 'center', rotation: 0, opacity: 1 });
  }
  return out;
};
