// Drawings made for a project (project.assets): parsed, drawn by the engine with their poses and expressions,
// resolved in place of the library, checked.
import { assetComponent, assetDecor, checkAgainstLibrary, createEvaluator, drawAsset, pathPoints, registryFor, type PathPrim, type Registry } from '@af/engine';
import { parseProject, type Asset, type ProjectInput } from '@af/schema';
import { describe, expect, it } from 'vitest';

const empty: Registry = { characters: {}, props: {}, decors: {}, text: () => [] };
const parseAsset = (a: unknown): Asset => { const r = parseProject({ schemaVersion: 1, title: 't', scenes: [{ id: 's', decor: { kind: 'plain' } }], assets: { a } }); if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.project.assets.a!; };

/** a stick figure: a body, a head that turns with it, an arm hanging from the shoulder, two mouths */
const figure = parseAsset({
  kind: 'character', name: 'Figure',
  parts: [
    { id: 'body', pivot: [0, -100], shapes: [{ type: 'rect', x: -20, y: -200, w: 40, h: 100, fill: '#336699' }] },
    { id: 'head', parent: 'body', pivot: [0, -200], shapes: [{ type: 'ellipse', cx: 0, cy: -240, rx: 30, ry: 30, fill: '#F0C8A0' }] },
    { id: 'smile', parent: 'head', group: 'mouth', variant: 'smile', shapes: [{ type: 'path', d: 'M -10 -230 Q 0 -220 10 -230', closed: false, stroke: '#000000' }] },
    { id: 'oh', parent: 'head', group: 'mouth', variant: 'o', shapes: [{ type: 'ellipse', cx: 0, cy: -228, rx: 5, ry: 7, fill: '#000000' }] },
    { id: 'arm', parent: 'body', pivot: [20, -190], shapes: [{ type: 'path', points: [[20, -190], [20, -110]], closed: false, width: 12, fill: '#336699' }] },
  ],
  poses: { point: { arm: { rot: -90 } }, walk: { body: { bounce: 10, speed: 1 } }, turn: { body: { rot: 90 } } },
  expressions: { surprised: { mouth: 'o' } },
});
const prim = (ps: ReturnType<typeof drawAsset>, id: string) => ps.find((p) => p.id.startsWith(id)) as PathPrim;
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe('SVG path data', () => {
  it('reads lines, relative moves, closes and several subpaths', () => {
    const [a, b] = pathPoints('M0 0 L10 0 l0 10 H0 Z m20 0 h5 v5');
    expect(a).toEqual({ points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true });
    expect(b).toEqual({ points: [[20, 0], [25, 0], [25, 5]], closed: false });
  });
  it('samples curves and arcs through their end points', () => {
    const [c] = pathPoints('M0 0 C 0 10 10 10 10 0');
    close(c!.points.at(-1)!, [10, 0]);
    expect(c!.points.length).toBeGreaterThan(8);
    const [arc] = pathPoints('M 0 0 A 50 50 0 0 1 100 0');
    close(arc!.points.at(-1)!, [100, 0]);
    expect(Math.min(...arc!.points.map((p) => p[1]))).toBeCloseTo(-50, 0); // the half circle goes up (sweep 1)
  });
  it('keeps what it could read of broken data', () => {
    expect(pathPoints('M0 0 L10 0 L ohno')).toEqual([{ points: [[0, 0], [10, 0]], closed: false }]);
    expect(pathPoints('garbage')).toEqual([]);
  });
});

describe('a drawn character', () => {
  it('turns a part around its pivot, and what hangs from it follows', () => {
    const rest = drawAsset(figure, { t: 0, id: 'f' }), turned = drawAsset(figure, { t: 0, id: 'f', pose: 'turn' });
    close(prim(rest, 'f:arm').points[1]!, [20, -110]);
    close(prim(drawAsset(figure, { t: 0, id: 'f', pose: 'point' }), 'f:arm').points[1]!, [100, -190]); // −90°: straight ahead
    // the whole body turned 90° around the hips: the head, child of the body, went to the side
    const head = prim(turned, 'f:head').points, cx = head.reduce((s, p) => s + p[0], 0) / head.length;
    expect(cx).toBeCloseTo(140, 0);
  });
  it('bounces, and falls back to idle for an unknown pose', () => {
    const y = (t: number) => Math.min(...prim(drawAsset(figure, { t, id: 'f', pose: 'walk' }), 'f:body').points.map((p) => p[1]));
    expect(y(0)).toBeCloseTo(-200);
    expect(y(0.25)).toBeCloseTo(-210); // a quarter cycle: up by the bounce
    expect(drawAsset(figure, { t: 0, id: 'f', pose: 'dance' })).toEqual(drawAsset(figure, { t: 0, id: 'f' }));
  });
  it('shows one variant per group, as the expression says', () => {
    const ids = (e?: string) => drawAsset(figure, { t: 0, id: 'f', expression: e }).map((p) => p.id.split(':')[1]);
    expect(ids()).toContain('smile'); // first variant by default
    expect(ids()).not.toContain('oh');
    expect(ids('surprised')).toContain('oh');
    expect(ids('surprised')).not.toContain('smile');
  });
});

describe('drawings in a project', () => {
  const project = (assets: Record<string, unknown>) => {
    const r = parseProject({ schemaVersion: 1, title: 't', cast: { fig: { kind: 'figure', name: 'Fig' } }, assets, scenes: [{ id: 's', duration: 2, decor: { kind: 'town' }, elements: [{ id: 'fig', type: 'character', ref: 'fig', keys: [{ t: 0, x: 500, y: 900, pose: 'point', expression: 'surprised' }] }, { id: 'l', type: 'prop', ref: 'lamp', keys: [{ t: 0, x: 900, y: 900 }] }] }] } as ProjectInput);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.project;
  };
  const town = { kind: 'decor', name: 'Ville', background: '#223344', parts: [{ id: 'sky', shapes: [{ type: 'gradient', x: -300, y: -300, w: 2520, h: 900, stops: [[0, '#112233'], [1, '#445566']] }] }, { id: 'mill', pivot: [1500, 500], shapes: [{ type: 'rect', x: 1495, y: 400, w: 10, h: 100, fill: '#FFFFFF' }] }], poses: { idle: { mill: { spin: 90 } } } };
  const lamp = { kind: 'prop', name: 'Lampe', parts: [{ id: 'pole', shapes: [{ type: 'rect', x: -5, y: -200, w: 10, h: 200, fill: '#333333' }] }, { id: 'light', shapes: [{ type: 'glow', x: 0, y: -200, radius: 60, color: '#FFE08A' }] }] };

  it('draws them in place of the library, decor included (still and moving parts apart)', () => {
    const p = project({ figure, town, lamp });
    const frame = createEvaluator(p, empty).frameAt(0.5);
    expect(frame.decor?.still.some((x) => x.id.startsWith('decor:sky'))).toBe(true);
    expect(frame.decor?.still.some((x) => x.id.startsWith('decor:mill'))).toBe(false); // it turns: drawn every frame
    const ids = frame.items.map((x) => x.id);
    expect(ids.some((i) => i.startsWith('fig:oh'))).toBe(true);
    expect(ids.some((i) => i.startsWith('l:light'))).toBe(true);
    expect(checkAgainstLibrary(p, empty, { characters: [] })).toEqual([]);
    expect(registryFor(p, empty)).toBe(registryFor(p, empty)); // built once per set of drawings
  });

  it('flags a drawing used for the wrong thing, and poses it does not have', () => {
    const p = project({ figure: { ...lamp }, town, lamp: { ...figure } });
    const w = checkAgainstLibrary(p, empty, { characters: [] }).map((x) => x.message).join(' | ');
    expect(w).toContain('« figure » est un dessin de type prop, pas un personnage');
    expect(w).toContain('« lamp » est un dessin de type character, pas un accessoire');
    const q = project({ figure, town, lamp });
    q.scenes[0]!.elements[0]!.keys[0]!.pose = 'dance';
    expect(checkAgainstLibrary(q, empty, { characters: [] }).map((x) => x.message)).toEqual(['pose « dance » inconnue pour « figure » (idle, point, walk, turn)']);
  });

  it('refuses drawings that do not hold together', () => {
    const bad = (a: unknown) => { const r = parseProject({ schemaVersion: 1, title: 't', scenes: [{ id: 's', decor: { kind: 'plain' } }], assets: { a } }); return r.ok ? [] : r.issues.map((i) => i.message); };
    expect(bad({ kind: 'prop', name: 'x', parts: [{ id: 'a', parent: 'b', shapes: [] }] })).toContain('partie parente « b » inconnue');
    expect(bad({ kind: 'prop', name: 'x', parts: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] })).toContain('les parties forment une boucle');
    expect(bad({ kind: 'prop', name: 'x', parts: [{ id: 'a' }], poses: { wave: { arm: { rot: 10 } } } })).toContain('pose « wave » : partie « arm » inconnue');
    expect(bad({ kind: 'prop', name: 'x', parts: [{ id: 'a', shapes: [{ type: 'path' }] }] })).toContain('un tracé a soit `d`, soit `points`');
    expect(bad({ kind: 'prop', name: 'x', parts: [{ id: 'a', group: 'mouth', variant: 'o' }], expressions: { happy: { mouth: 'smile' } } })).toContain('expression « happy » : pas de variante « smile » dans le groupe « mouth »');
  });

  it('draws a decor to the size of the project', () => {
    const out = assetDecor(parseAsset(town))({ params: {}, width: 960, height: 540, id: 'd' });
    expect(out.bounds).toEqual({ x: -150, y: -150, w: 1260, h: 840 });
    expect(assetComponent(figure)({ t: 0, local: 0, id: 'x', params: {}, state: { pose: 'idle', expression: 'neutral', facing: 1, text: undefined } }).length).toBeGreaterThan(3);
  });
});
