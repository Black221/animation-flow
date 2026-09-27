// `person`: a human character, drawn from parameters (skin, hair, clothes, cap) so the cast can be anyone.
// Proportions (scale 1, origin between the feet): 340 px tall, head radius 60 centred at y −275, shoulders at −200,
// hips at −112. The character faces +x; the engine mirrors it for facing −1. Arms and legs are two-segment limbs
// posed by angles measured from "hanging straight down" (positive = forward).
import { ellipse, lighten, darken, roundRect, spline, star, type ComponentFn, type Prim, type Pt } from '@af/engine';
import { body, INK, limb, line, offset, P, rotateAbout } from './util';

export const PERSON_POSES = ['idle', 'walk', 'wave', 'point', 'think', 'dream', 'hold', 'cheer'] as const;
export const PERSON_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'thinking', 'sad', 'dreamy', 'sleepy', 'angry'] as const;

const L1 = 48, L2 = 46; // upper arm, forearm
type Arm = [number, number]; // shoulder angle, elbow bend

function armPts(sx: number, sy: number, [a1, a2]: Arm): [Pt, Pt, Pt] {
  const e: Pt = [sx + L1 * Math.sin(a1), sy + L1 * Math.cos(a1)];
  return [[sx, sy], e, [e[0] + L2 * Math.sin(a1 + a2), e[1] + L2 * Math.cos(a1 + a2)]];
}

function pose(name: string, t: number): { front: Arm; back: Arm; legs: [number, number]; lift: [number, number]; bob: number; tilt: number } {
  const breathe = Math.sin(t * 2.2) * 0.04;
  switch (name) {
    case 'walk': {
      const s = Math.sin(t * Math.PI * 2 * 1.7);
      return { front: [-0.55 * s, 0.25], back: [0.55 * s, 0.25], legs: [24 * s, -24 * s], lift: [Math.max(0, -s) * 12, Math.max(0, s) * 12], bob: -Math.abs(Math.cos(t * Math.PI * 2 * 1.7)) * 7, tilt: 0.03 };
    }
    case 'wave': return { front: [2.65, 0.35 * Math.sin(t * 9)], back: [-0.12 + breathe, 0.1], legs: [0, 0], lift: [0, 0], bob: 0, tilt: -0.03 };
    case 'point': return { front: [1.5, 0.04], back: [-0.15, 0.15], legs: [6, -6], lift: [0, 0], bob: 0, tilt: 0.02 };
    case 'think': return { front: [0.3, -2.95], back: [0.35, 1.1], legs: [0, 0], lift: [0, 0], bob: 0, tilt: -0.08 };
    case 'dream': return { front: [0.1, -2.5], back: [-0.1, 2.5], legs: [0, 0], lift: [0, 0], bob: Math.sin(t * 1.6) * 3, tilt: 0.1 };
    case 'hold': return { front: [0.55, 1.15], back: [0.45, 1.05], legs: [0, 0], lift: [0, 0], bob: 0, tilt: 0.06 };
    case 'cheer': { const j = Math.abs(Math.sin(t * 6)); return { front: [2.75 + 0.1 * Math.sin(t * 12), 0.1], back: [-2.75, -0.1], legs: [10, -10], lift: [0, 0], bob: -j * 14, tilt: 0 }; }
    default: return { front: [0.14 + breathe, -0.12], back: [-0.14 - breathe, 0.12], legs: [0, 0], lift: [0, 0], bob: Math.sin(t * 2.2) * 1.5, tilt: 0 };
  }
}

function face(id: string, expr: string, t: number, cx: number, cy: number, skin: string): Prim[] {
  const out: Prim[] = [], ex = [cx - 14, cx + 30], ey = cy + 2;
  const blink = (t % 3.7) < 0.12 && expr !== 'surprised';
  const closed = blink || expr === 'dreamy';
  const look = expr === 'thinking' ? [3, -6] : [4, 1];
  ex.forEach((x, i) => {
    const k = `${id}:eye${i}`;
    if (closed) out.push(line(k, spline([[x - 10, ey], [x, ey + (expr === 'dreamy' ? -6 : 3)], [x + 10, ey]], 4), INK, 4));
    else if (expr === 'sleepy') {
      out.push(body(k, ellipse(x, ey + 2, 10, 7, 16), '#FFFFFF', { strokeWidth: 2.5, role: 'detail' }));
      out.push(body(k + 'p', ellipse(x + 3, ey + 4, 4.5, 4, 10), INK, { stroke: undefined, role: 'detail' }));
      out.push(line(k + 'lid', [[x - 11, ey - 1], [x + 11, ey - 1]], INK, 4));
    } else {
      const r = expr === 'surprised' ? 14 : 11;
      out.push(body(k, ellipse(x, ey, r - 1, r + 2, 18), '#FFFFFF', { strokeWidth: 2.5, role: 'detail' }));
      out.push(body(k + 'p', ellipse(x + look[0]!, ey + look[1]!, 6, 7, 12), INK, { stroke: undefined, role: 'detail' }));
      out.push(body(k + 'h', ellipse(x + look[0]! + 2, ey + look[1]! - 3, 2, 2, 6), '#FFFFFF', { stroke: undefined, role: 'detail' }));
    }
    // eyebrows
    const by = ey - 22, tilt = expr === 'angry' ? (i ? 6 : -6) : expr === 'sad' ? (i ? -5 : 5) : expr === 'surprised' ? 0 : 0;
    const lift = expr === 'surprised' ? -8 : expr === 'thinking' && i === 1 ? -7 : 0;
    out.push(line(`${id}:brow${i}`, [[x - 10, by + lift - tilt], [x + 10, by + lift + tilt]], darken(skin, 0.55), 4));
  });
  const my = cy + 34, mx = cx + 10, m = `${id}:mouth`;
  switch (expr) {
    case 'happy': case 'dreamy':
      out.push(body(m, [...spline([[mx - 16, my - 4], [mx, my + 12], [mx + 16, my - 4]], 6), [mx, my - 1]], '#8C2F2A', { strokeWidth: 3, role: 'detail' })); break;
    case 'surprised': out.push(body(m, ellipse(mx, my + 2, 8, 11, 14), '#8C2F2A', { strokeWidth: 3, role: 'detail' })); break;
    case 'sad': out.push(line(m, spline([[mx - 12, my + 6], [mx, my - 2], [mx + 12, my + 6]], 5), INK, 3.5)); break;
    case 'thinking': out.push(line(m, [[mx - 8, my + 2], [mx + 10, my - 2]], INK, 3.5)); break;
    case 'angry': out.push(line(m, [[mx - 12, my + 3], [mx + 12, my + 3]], INK, 4)); break;
    case 'sleepy': out.push(body(m, ellipse(mx, my + 2, 5, 4, 10), '#8C2F2A', { strokeWidth: 2.5, role: 'detail' })); break;
    default: out.push(line(m, spline([[mx - 10, my], [mx, my + 5], [mx + 10, my]], 4), INK, 3.5));
  }
  if (expr === 'happy' || expr === 'dreamy') ex.forEach((x, i) => out.push({ kind: 'path', id: `${id}:blush${i}`, points: ellipse(x - 2, ey + 20, 9, 5, 12), closed: true, fill: '#E8837A', opacity: 0.55, role: 'shade' }));
  return out;
}

export const person: ComponentFn = ({ id, t, local, params, state }) => {
  const p = P(params);
  const skin = p.str('skin', '#C68A5E'), hair = p.str('hair', '#2A1A12'), top = p.str('top', '#E0A33A'), bottom = p.str('bottom', '#3E7C4A');
  const cap = p.opt('cap'), style = p.str('hairStyle', 'short'), overalls = p.bool('overalls', true), shoes = p.str('shoes', '#5A3A28');
  const po = pose(state.pose, local);
  const out: Prim[] = [];
  const hipY = -112, sh = -200, headY = -275, R = 60;

  // legs and shoes (hips stay put, the upper body bobs)
  const legs = ([-1, 1] as const).map((side, i) => {
    const fx = side * 14 + po.legs[i]!, lift = po.lift[i]!;
    return { side, pts: [[side * 14, hipY], [side * 15 + po.legs[i]! * 0.5, hipY / 2 - lift * 0.5], [fx, -8 - lift]] as Pt[], fx, lift };
  });
  legs.forEach((l, i) => {
    out.push(limb(`${id}:leg${i}`, l.pts, darken(bottom, i ? 0 : 0.08), 28));
    out.push(body(`${id}:shoe${i}`, roundRect(l.fx - 16, -16 - l.lift, 40, 18, 8), shoes, { strokeWidth: 3 }));
  });

  const upper: Prim[] = [];
  // hair behind the head (braid hangs down the back)
  if (style === 'braid') {
    const b: Pt[] = [];
    for (let k = 0; k < 6; k++) b.push([-46 - k * 2 + Math.sin(local * 2 + k) * 1.5, headY + 10 + k * 22]);
    b.forEach((c, k) => upper.push(body(`${id}:braid${k}`, ellipse(c[0], c[1], 13 - k * 0.8, 14, 14), hair, { strokeWidth: 2.5 })));
    upper.push(body(`${id}:braidTie`, ellipse(b[5]![0], b[5]![1] + 14, 8, 6, 10), top, { strokeWidth: 2.5, role: 'detail' }));
  }
  if (style === 'bun') upper.push(body(`${id}:bun`, ellipse(-8, headY - R - 6, 26, 22, 18), hair));
  if (style === 'long') upper.push(body(`${id}:long`, [...ellipse(0, headY, R + 8, R + 6, 24, Math.PI, Math.PI * 2), [R + 4, headY + 80], [-R - 6, headY + 90]], hair));

  // back arm (behind the torso)
  const backArm = armPts(-34, sh, po.back);
  upper.push(limb(`${id}:armB1`, [backArm[0], backArm[1]], darken(top, 0.1), 22));
  upper.push(limb(`${id}:armB2`, [backArm[1], backArm[2]], darken(skin, 0.08), 17));
  upper.push(body(`${id}:handB`, ellipse(backArm[2][0], backArm[2][1], 11, 11, 12), darken(skin, 0.08), { strokeWidth: 3 }));

  // torso, overalls bib and straps
  upper.push(body(`${id}:torso`, roundRect(-44, sh - 14, 88, 108, 26), top));
  if (overalls) {
    upper.push(body(`${id}:bib`, roundRect(-30, sh + 22, 60, 72, 10), bottom, { strokeWidth: 3 }));
    upper.push(line(`${id}:strapL`, [[-26, sh + 24], [-34, sh - 10]], darken(bottom, 0.2), 6));
    upper.push(line(`${id}:strapR`, [[26, sh + 24], [30, sh - 10]], darken(bottom, 0.2), 6));
    upper.push(body(`${id}:pocket`, roundRect(-12, sh + 40, 24, 18, 5), lighten(bottom, 0.15), { strokeWidth: 2.5, role: 'detail' }));
  }
  upper.push(body(`${id}:neck`, roundRect(-12, headY + R - 14, 24, 26, 8), darken(skin, 0.1), { strokeWidth: 3 }));

  // head, hair, face, cap (tilted together)
  const head: Prim[] = [];
  head.push(body(`${id}:ear`, ellipse(-38, headY + 6, 12, 16, 12), darken(skin, 0.05), { strokeWidth: 3 }));
  head.push(body(`${id}:head`, ellipse(0, headY, R, R + 2, 36), skin));
  if (style !== 'none' && !cap) head.push(body(`${id}:hairTop`, [...ellipse(0, headY - 4, R + 3, R + 1, 24, Math.PI * 1.02, Math.PI * 1.98), [R - 6, headY - 18], [10, headY - 30], [-R + 6, headY - 14]], hair, { smooth: true }));
  head.push(...face(`${id}:face`, state.expression, local, 0, headY, skin));
  if (cap) {
    head.push(body(`${id}:cap`, [...ellipse(0, headY - 18, R + 4, R - 6, 24, Math.PI, Math.PI * 2), [R + 4, headY - 18]], cap, { smooth: true }));
    head.push(body(`${id}:visor`, [[R - 16, headY - 26], [R + 44, headY - 22], [R + 40, headY - 12], [R - 16, headY - 14]], darken(cap, 0.15), { strokeWidth: 3 }));
    head.push(body(`${id}:capButton`, ellipse(0, headY - R - 8, 7, 5, 10), lighten(cap, 0.3), { strokeWidth: 2.5, role: 'detail' }));
    const band = p.opt('capBand');
    if (band) head.push({ kind: 'path', id: `${id}:capBand`, points: [[-R + 2, headY - 22], [R + 2, headY - 22]], closed: false, stroke: band, strokeWidth: 8, role: 'detail' });
  }
  upper.push(...rotateAbout(head, 0, headY + R, po.tilt));

  // front arm (in front of the torso), and whatever the hand holds
  const frontArm = armPts(34, sh, po.front);
  upper.push(limb(`${id}:armF1`, [frontArm[0], frontArm[1]], top, 22));
  upper.push(limb(`${id}:armF2`, [frontArm[1], frontArm[2]], skin, 17));
  if (state.pose === 'hold') {
    const [hx, hy] = frontArm[2];
    upper.push(body(`${id}:tablet`, roundRect(hx - 30, hy - 44, 62, 46, 8), '#2D3A4A', { strokeWidth: 3 }));
    upper.push({ kind: 'path', id: `${id}:tabletScreen`, points: roundRect(hx - 24, hy - 39, 50, 36, 5), closed: true, fill: '#6FD3E0', role: 'detail' });
    upper.push({ kind: 'glow', id: `${id}:tabletGlow`, x: hx, y: hy - 22, radius: 60, color: '#3BC4D8', opacity: 0.35 });
  }
  upper.push(body(`${id}:handF`, ellipse(frontArm[2][0], frontArm[2][1], 11, 11, 12), skin, { strokeWidth: 3 }));

  if (state.pose === 'dream') for (let k = 0; k < 3; k++) {
    const a = local * 0.8 + k * 2.1, y = headY - R - 40 - ((local * 30 + k * 40) % 90);
    upper.push({ kind: 'path', id: `${id}:spark${k}`, points: star(Math.sin(a) * 50 + 20, y, 13, 5, 4), closed: true, fill: '#F2C14E', stroke: INK, strokeWidth: 2, role: 'detail', opacity: 0.9 });
  }
  out.push(...offset(upper, 0, po.bob));
  // the ground contact shadow first, so it sits under everything
  return [{ kind: 'path', id: `${id}:shadow`, points: ellipse(0, 0, 58, 10, 20), closed: true, fill: '#000000', opacity: 0.12, role: 'shade' }, ...out];
};
