import { exampleProject, parseProject, pictureAssetsOf, type Project } from '@af/schema';
import { catalog, registry } from '../src';
import { describe, expect, it } from 'vitest';
import { ASPECTS, checkAgainstLibrary, cropSize, focusOf, planFraming, primBox, primsBox, reframe, createEvaluator, estimateDuration, GAP, LEAD, sampleElement, refResolver, timeLines, timeProject, toSrt, TAIL } from '@af/engine';

const project = (() => { const r = parseProject(exampleProject); if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.project; })();
const withEdit = (f: (p: Project) => void) => { const p = structuredClone(project); f(p); return p; };

describe('timing', () => {
  it('chains lines with the lead-in, the gap and holds', () => {
    const lines = timeLines([
      { id: 'a', speaker: 'narrator', text: 'Bonjour.', holdAfter: 1 },
      { id: 'b', speaker: 'narrator', text: 'Deux.', duration: 2, holdAfter: 0 },
    ]);
    expect(lines[0]!.start).toBe(LEAD);
    expect(lines[0]!.end).toBeCloseTo(LEAD + estimateDuration('Bonjour.'));
    expect(lines[1]!.start).toBeCloseTo(lines[0]!.end + GAP + 1);
    expect(lines[1]!.end - lines[1]!.start).toBe(2);
    expect(lines[1]!.estimated).toBe(false);
  });

  it('resolves line references with edges and offsets', () => {
    const at = refResolver(timeLines([{ id: 'a', speaker: 'narrator', text: 'x', duration: 2, holdAfter: 0 }]));
    expect(at({ line: 'a', edge: 'end', offset: 0.5 })).toBeCloseTo(LEAD + 2.5);
    expect(at({ line: 'missing', edge: 'start', offset: 0 }, 7)).toBe(7);
    expect(at(3)).toBe(3);
  });

  it('grows a scene to fit its voice and counts frames', () => {
    const p = withEdit((q) => { q.scenes[1]!.duration = 1; });
    const tl = timeProject(p), s2 = tl.scenes[1]!;
    expect(s2.duration).toBeCloseTo(s2.lines.at(-1)!.end + TAIL);
    expect(tl.frames).toBe(Math.ceil(tl.duration * 24 - 1e-9));
    expect(tl.scenes[1]!.start).toBe(tl.scenes[0]!.duration);
  });
});

describe('keys', () => {
  const at = refResolver([]);
  it('interpolates each property only between the keys that set it', () => {
    const keys = [{ t: 0, x: 0, y: 0 }, { t: 1, pose: 'wave' }, { t: 2, x: 100, ease: 'linear' as const }];
    const s = sampleElement(keys, 1, at);
    expect(s.x).toBeCloseTo(50);
    expect(s.y).toBe(0);
    expect(s.pose).toBe('wave');
    expect(sampleElement(keys, 0.5, at).pose).toBe('wave'); // before its key, the first value set holds
    expect(sampleElement(keys, 9, at).x).toBe(100);
  });
  it('holds with step easing', () => {
    const keys = [{ t: 0, x: 0 }, { t: 2, x: 10, ease: 'step' as const }];
    expect(sampleElement(keys, 1.99, at).x).toBe(0);
    expect(sampleElement(keys, 2, at).x).toBe(10);
  });
});

describe('evaluate', () => {
  const ev = createEvaluator(project, registry);

  it('is a pure function of time', () => {
    expect(JSON.stringify(ev.frameAt(4.2))).toBe(JSON.stringify(createEvaluator(project, registry).frameAt(4.2)));
  });

  it('places elements through the camera, but not screen-space ones', () => {
    const f = ev.frameAt(0.9);
    const title = f.items.find((p) => p.id === 'title:text');
    expect(title && title.kind === 'text' && title.x).toBe(960);
    expect(f.decor?.still.length).toBeGreaterThan(10);
    expect(f.subtitle?.text).toBe('Voici Awa.');
  });

  it('culls what is outside the frame', () => {
    const f = ev.frameAt(0);
    expect(f.items.some((p) => p.id.startsWith('jumo:'))).toBe(false); // Jumo starts at x = 2250, off screen
    expect(f.items.some((p) => p.id.startsWith('tractor:'))).toBe(true);
  });

  it('respects enter / exit', () => {
    const tl = ev.timeline, l5 = tl.scenes[0]!.lines.find((l) => l.id === 'l5')!;
    expect(ev.frameAt(l5.start - 0.1).items.some((p) => p.id.startsWith('protocol:'))).toBe(false);
    expect(ev.frameAt(l5.start + 1).items.some((p) => p.id.startsWith('protocol:'))).toBe(true);
  });

  it('fades into a scene with a fade transition', () => {
    const s2 = ev.timeline.scenes[1]!;
    expect(ev.frameAt(s2.start + 0.01).fade).toBeGreaterThan(0.9);
    expect(ev.frameAt(s2.start - 0.01).fade).toBeGreaterThan(0.9);
    expect(ev.frameAt(s2.start + 2).fade).toBe(0);
  });

  it('draws a placeholder for an unknown prop, and the library check reports it', () => {
    const p = withEdit((q) => { q.scenes[0]!.elements.find((e) => e.id === 'tree')!.ref = 'baobab'; });
    const f = createEvaluator(p, registry).frameAt(1);
    expect(f.items.some((i) => i.id === 'tree:q')).toBe(true);
    expect(checkAgainstLibrary(p, registry, catalog)).toContainEqual({ path: 'scenes.0.elements.1.ref', message: expect.stringContaining('baobab') });
  });

  it('finds poses the character does not have', () => {
    const p = withEdit((q) => { q.scenes[0]!.elements.find((e) => e.id === 'awa')!.keys[0]!.pose = 'backflip'; });
    expect(checkAgainstLibrary(p, registry, catalog).some((w) => w.message.includes('backflip'))).toBe(true);
    expect(checkAgainstLibrary(project, registry, catalog)).toEqual([]);
  });
});

describe('subtitles', () => {
  it('writes numbered SRT cues in order, two lines at most', () => {
    const srt = toSrt(project, timeProject(project));
    const cues = srt.trim().split(/\n\n/);
    expect(cues[0]).toMatch(/^1\n00:00:00,300 --> 00:00:0\d,\d{3}\nVoici Awa\.$/);
    for (const c of cues) expect(c.split('\n').length).toBeLessThanOrEqual(4);
  });
});

describe('reframing (vertical, square, portrait outputs)', () => {
  const ev = createEvaluator(project, registry);
  it('marks screen overlays and lists the subjects on screen', () => {
    const f = ev.frameAt(2);
    expect(f.items.some((p) => p.overlay)).toBe(true);
    expect(f.subjects.some((s) => s.type === 'character')).toBe(true);
  });

  it('follows the action inside the frame, the same way every time, and stays in the picture', () => {
    const a = planFraming(ev, 1920, 1080, ASPECTS['9:16'], 'follow'), b = planFraming(ev, 1920, 1080, ASPECTS['9:16'], 'follow');
    const ts = [0.5, 2, 4, 6, 9, 12], xs = ts.map((t) => a.at(t));
    for (const c of xs) { expect(c.w).toBeCloseTo(607.5); expect(c.h).toBe(1080); expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x + c.w).toBeLessThanOrEqual(1920.001); }
    expect(xs.map((c) => c.x)).toEqual(ts.map((t) => b.at(t).x));
    // the window looks at the characters: the focus of the frame lies inside it
    const [fx] = focusOf(ev.frameAt(4), 607.5, 1080), c = a.at(4);
    expect(fx).toBeGreaterThan(c.x); expect(fx).toBeLessThan(c.x + c.w);
    // and moves smoothly: no jump between two frames of a scene
    expect(Math.abs(a.at(4).x - a.at(4 + 1 / 24).x)).toBeLessThan(12);
  });

  it("keeps the centre with `center`, and nothing moves for the film's own shape", () => {
    expect(planFraming(ev, 1920, 1080, 1, 'center').at(3)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
    expect(planFraming(ev, 1920, 1080, 16 / 9, 'follow').at(3)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(cropSize(1920, 1080, 4 / 5)).toEqual({ w: 864, h: 1080 });
  });

  it('lays each overlay out again inside the window, whole, and shifts the world', () => {
    const f = ev.frameAt(2), c = { x: 600, y: 0, w: 607.5, h: 1080 }, r = reframe(f, c);
    expect(r.width).toBe(607.5);
    const title = r.items.filter((p) => p.overlay);
    expect(title.length).toBeGreaterThan(0);
    const b = primsBox(title);
    expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(607.5 + 0.5);
    const w0 = f.items.find((p) => !p.overlay && p.kind === 'path'), w1 = r.items.find((p) => p.id === w0!.id);
    if (w0?.kind !== 'path' || w1?.kind !== 'path') throw new Error('no world path');
    expect(w1.points[0]![0]).toBeCloseTo(w0.points[0]![0] - 600);
  });
});

describe('imported pictures in drawings', () => {
  const asset = 'b'.repeat(32);
  const withLogo = withEdit((p) => {
    (p as any).assets = { ...p.assets, logo: { kind: 'prop', name: 'Logo', description: '', parts: [{ id: 'image', pivot: [0, 0], shapes: [{ type: 'image', asset, x: -100, y: -80, w: 200, h: 80 }] }], poses: {}, expressions: {} } };
    p.scenes[0]!.elements.push({ id: 'logo', type: 'prop', ref: 'logo', params: {}, layer: 20, space: 'world', keys: [{ t: 0, x: 960, y: 600, rotation: 0.5, scale: 1.5 }] } as any);
  });
  it('validates, is listed among the project’s pictures, and draws as a picture that turns with its element', () => {
    const r = parseProject(withLogo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pictureAssetsOf(r.project)).toContain(asset);
    const f = createEvaluator(r.project, registry).frameAt(1), img = f.items.find((p) => p.kind === 'image' && p.src === asset);
    expect(img?.kind).toBe('image');
    if (img?.kind !== 'image') return;
    expect(img.matrix).toBeDefined();
    const b = primBox(img);
    // 200 × 80 at scale 1.5, turned: its box is wider than it is tall, around the element
    expect(b.x1 - b.x0).toBeGreaterThan(250);
    expect((b.x0 + b.x1) / 2).toBeGreaterThan(700); expect((b.x0 + b.x1) / 2).toBeLessThan(1220);
  });
  it('refuses an image shape without a proper id', () => {
    const bad = structuredClone(withLogo) as any;
    bad.assets.logo.parts[0].shapes[0].asset = '../../etc/passwd';
    expect(parseProject(bad).ok).toBe(false);
  });
});
