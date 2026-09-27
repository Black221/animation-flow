// One drawing of each sort, made by hand, in the format models write (see Asset in @af/schema). They show a model
// what a good answer looks like (rig, draw order, poses, expressions, sizes), and the tests draw them.
import type { z } from 'zod';
import type { Asset } from '@af/schema';

type AssetIn = z.input<typeof Asset>;
const SKIN = '#F1C27D', SLEEVE = '#E07A5F', PANTS = '#3D405B', SHOE = '#2B2D42', INK = '#2B2D42';
const limb = (id: string, parent: string, x: number, y0: number, y1: number, width: number, fill: string, extra: AssetIn['parts'][number]['shapes'] = []) =>
  ({ id, parent, pivot: [x, y0] as [number, number], shapes: [{ type: 'path' as const, points: [[x, y0], [x, y1]] as [number, number][], closed: false, width, fill }, ...extra] });

/** a girl, 355 px tall: hips → legs and torso → head (eyes, mouth variants) and two-segment arms */
export const exampleCharacter: AssetIn = {
  kind: 'character', name: 'Nina', description: 'Une fille de dix ans, cheveux châtains au carré, pull corail, pantalon bleu nuit.',
  parts: [
    { id: 'hips', pivot: [0, -150], shapes: [{ type: 'rect', x: -24, y: -160, w: 48, h: 22, r: 8, fill: PANTS }] },
    limb('arm_back', 'torso', -4, -248, -190, 20, SLEEVE),
    limb('hand_back', 'arm_back', -4, -190, -140, 16, SKIN, [{ type: 'ellipse', cx: -4, cy: -134, rx: 10, ry: 10, fill: SKIN }]),
    limb('leg_back', 'hips', -10, -150, -14, 26, PANTS, [{ type: 'ellipse', cx: -2, cy: -9, rx: 19, ry: 9, fill: SHOE }]),
    limb('leg_front', 'hips', 10, -150, -14, 26, PANTS, [{ type: 'ellipse', cx: 18, cy: -9, rx: 19, ry: 9, fill: SHOE }]),
    { id: 'torso', parent: 'hips', pivot: [0, -150], shapes: [{ type: 'path', d: 'M -32 -250 Q -38 -200 -30 -145 L 30 -145 Q 38 -200 32 -250 Q 0 -262 -32 -250 Z', fill: SLEEVE }] },
    { id: 'head', parent: 'torso', pivot: [0, -258], shapes: [
      { type: 'rect', x: -8, y: -276, w: 16, h: 22, fill: SKIN },
      { type: 'ellipse', cx: 0, cy: -305, rx: 42, ry: 46, fill: SKIN },
      { type: 'path', d: 'M -46 -290 Q -52 -362 0 -360 Q 52 -362 48 -290 L 40 -292 Q 36 -334 -2 -332 Q -34 -330 -38 -292 Z', fill: '#6D4C41' },
      { type: 'ellipse', cx: 24, cy: -292, rx: 8, ry: 5, fill: '#F4A28C', opacity: 0.6, role: 'shade' },
    ] },
    { id: 'eyes_open', parent: 'head', group: 'eyes', variant: 'open', shapes: [{ type: 'ellipse', cx: -12, cy: -308, rx: 5, ry: 6.5, fill: INK, role: 'detail' }, { type: 'ellipse', cx: 18, cy: -308, rx: 5, ry: 6.5, fill: INK, role: 'detail' }] },
    { id: 'eyes_wide', parent: 'head', group: 'eyes', variant: 'wide', shapes: [{ type: 'ellipse', cx: -12, cy: -309, rx: 7, ry: 9, fill: INK, role: 'detail' }, { type: 'ellipse', cx: 18, cy: -309, rx: 7, ry: 9, fill: INK, role: 'detail' }] },
    { id: 'eyes_closed', parent: 'head', group: 'eyes', variant: 'closed', shapes: [{ type: 'path', d: 'M -18 -307 Q -12 -302 -6 -307 M 12 -307 Q 18 -302 24 -307', closed: false, stroke: INK, strokeWidth: 3, role: 'detail' }] },
    { id: 'mouth_flat', parent: 'head', group: 'mouth', variant: 'flat', shapes: [{ type: 'path', d: 'M -6 -283 L 12 -283', closed: false, stroke: INK, strokeWidth: 3, role: 'detail' }] },
    { id: 'mouth_smile', parent: 'head', group: 'mouth', variant: 'smile', shapes: [{ type: 'path', d: 'M -10 -287 Q 3 -274 16 -287', closed: false, stroke: INK, strokeWidth: 3, role: 'detail' }] },
    { id: 'mouth_open', parent: 'head', group: 'mouth', variant: 'open', shapes: [{ type: 'ellipse', cx: 3, cy: -282, rx: 7, ry: 9, fill: '#8E3B46', role: 'detail' }] },
    { id: 'mouth_sad', parent: 'head', group: 'mouth', variant: 'sad', shapes: [{ type: 'path', d: 'M -8 -279 Q 3 -289 14 -279', closed: false, stroke: INK, strokeWidth: 3, role: 'detail' }] },
    limb('arm_front', 'torso', 6, -248, -190, 20, SLEEVE),
    limb('hand_front', 'arm_front', 6, -190, -140, 16, SKIN, [{ type: 'ellipse', cx: 6, cy: -134, rx: 10, ry: 10, fill: SKIN }]),
  ],
  poses: {
    idle: { torso: { swing: 1.5, speed: 0.35 }, head: { swing: 2, speed: 0.3, phase: 0.2 }, arm_back: { rot: 4 }, arm_front: { rot: -4 } },
    walk: { hips: { bounce: 5, speed: 1.6 }, leg_back: { swing: 24, speed: 1.6 }, leg_front: { swing: 24, speed: 1.6, phase: 0.5 }, arm_back: { swing: 20, speed: 1.6, phase: 0.5 }, arm_front: { swing: 20, speed: 1.6 }, hand_back: { rot: -15 }, hand_front: { rot: -15 } },
    talk: { head: { swing: 4, speed: 1.2 }, arm_front: { rot: -35, swing: 8, speed: 0.8 }, hand_front: { rot: -50 } },
    point: { arm_front: { rot: -82 }, hand_front: { rot: -8 }, head: { rot: -3 } },
    wave: { arm_front: { rot: -135 }, hand_front: { rot: -35, swing: 25, speed: 2 } },
    think: { arm_front: { rot: -40 }, hand_front: { rot: -125 }, head: { rot: 6 } },
    cheer: { hips: { bounce: 12, speed: 1.5 }, arm_front: { rot: -160, swing: 10, speed: 2 }, arm_back: { rot: 160, swing: 10, speed: 2, phase: 0.5 } },
  },
  expressions: {
    neutral: { eyes: 'open', mouth: 'flat' },
    happy: { mouth: 'smile' },
    surprised: { eyes: 'wide', mouth: 'open' },
    sad: { mouth: 'sad' },
    sleepy: { eyes: 'closed' },
  },
};

/** a potted plant, 150 px tall, whose leaves sway */
export const exampleProp: AssetIn = {
  kind: 'prop', name: 'Plante en pot', description: 'Une plante verte dans un pot en terre cuite.',
  parts: [
    { id: 'pot', shapes: [{ type: 'path', d: 'M -36 -60 L 36 -60 L 28 0 L -28 0 Z', fill: '#C8553D' }, { type: 'rect', x: -40, y: -70, w: 80, h: 14, r: 4, fill: '#B04A35' }] },
    { id: 'stem', pivot: [0, -66], shapes: [{ type: 'path', points: [[0, -66], [0, -120]], closed: false, width: 6, fill: '#3E7C4A' }] },
    { id: 'leaf_l', parent: 'stem', pivot: [0, -100], shapes: [{ type: 'path', d: 'M 0 -100 Q -40 -130 -50 -100 Q -30 -86 0 -100 Z', fill: '#5AA469' }] },
    { id: 'leaf_r', parent: 'stem', pivot: [0, -115], shapes: [{ type: 'path', d: 'M 0 -115 Q 42 -150 54 -118 Q 30 -100 0 -115 Z', fill: '#5AA469' }] },
    { id: 'leaf_top', parent: 'stem', pivot: [0, -120], shapes: [{ type: 'path', d: 'M 0 -120 Q -18 -160 4 -175 Q 22 -150 0 -120 Z', fill: '#6DBF7B' }] },
  ],
  poses: { idle: { stem: { swing: 3, speed: 0.4 }, leaf_l: { swing: 6, speed: 0.6 }, leaf_r: { swing: 6, speed: 0.55, phase: 0.3 } } },
};

/** a park at noon: sky, sun, hills, trees, a path; a cloud drifts back and forth */
export const exampleDecor: AssetIn = {
  kind: 'decor', name: 'Parc', description: 'Un parc ensoleillé : collines, arbres, un chemin, ciel bleu.', background: '#8CC084',
  parts: [
    { id: 'sky', shapes: [{ type: 'gradient', x: -300, y: -300, w: 2520, h: 1000, stops: [[0, '#8EC5E8'], [1, '#DDF1FA']] }] },
    { id: 'sun', shapes: [{ type: 'glow', x: 1560, y: 180, radius: 260, color: '#FFE08A', opacity: 0.5 }, { type: 'ellipse', cx: 1560, cy: 180, rx: 80, ry: 80, fill: '#FFD45C' }] },
    { id: 'cloud', pivot: [700, 1600], shapes: [{ type: 'path', d: 'M 520 230 Q 540 170 610 185 Q 650 130 720 170 Q 790 150 800 210 Q 850 230 820 260 L 530 262 Q 490 255 520 230 Z', fill: '#FFFFFF', opacity: 0.9, role: 'shade' }] },
    { id: 'hills_far', shapes: [{ type: 'path', d: 'M -300 700 Q 200 540 700 660 Q 1200 560 1700 650 Q 2000 600 2220 640 L 2220 1380 L -300 1380 Z', fill: '#A8D5A2' }] },
    { id: 'hills_near', shapes: [{ type: 'path', d: 'M -300 820 Q 400 740 1000 810 Q 1600 760 2220 800 L 2220 1380 L -300 1380 Z', fill: '#8CC084' }] },
    { id: 'path', shapes: [{ type: 'path', d: 'M 820 1380 Q 900 1000 1000 830 L 1060 830 Q 1100 1000 1260 1380 Z', fill: '#E8D8B0' }] },
    { id: 'tree_l', shapes: [{ type: 'rect', x: 180, y: 600, w: 34, h: 220, fill: '#7A5230' }, { type: 'ellipse', cx: 197, cy: 560, rx: 120, ry: 110, fill: '#4F9D5B' }, { type: 'ellipse', cx: 150, cy: 610, rx: 70, ry: 60, fill: '#5AAE66', role: 'shade' }] },
    { id: 'tree_r', shapes: [{ type: 'rect', x: 1700, y: 640, w: 28, h: 180, fill: '#7A5230' }, { type: 'ellipse', cx: 1714, cy: 610, rx: 95, ry: 88, fill: '#4F9D5B' }] },
  ],
  poses: { idle: { cloud: { swing: 1.2, speed: 0.05 } } },
};
