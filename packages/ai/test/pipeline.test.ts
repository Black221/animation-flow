import type { ChatMessage } from '@af/providers';
import { exampleProject, parseProject, type ProjectInput } from '@af/schema';
import { describe, expect, it } from 'vitest';
import {
  checkAsset, drawOne, editScene, exampleCharacter, exampleDecor, exampleProp, extractJson, fallbackAsset, fallbackScene, generateDrawings, generateScenes, generateStoryboard,
  InvalidAnswer, ModelError, Storyboard, type Model, type Step,
} from '../src';

type Answer = string | ((messages: ChatMessage[], system: string) => string);
/** a model that answers from a script, and remembers what it was asked */
function scripted(answers: Answer[]): Model & { calls: { system: string; messages: ChatMessage[] }[] } {
  const calls: { system: string; messages: ChatMessage[] }[] = [];
  let i = 0;
  return {
    label: 'fake', calls,
    async call({ system, messages }) {
      calls.push({ system, messages: [...messages] });
      const a = answers[Math.min(i++, answers.length - 1)]!;
      return { ok: true, text: typeof a === 'function' ? a(messages, system) : a, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}
/** answers by what is asked: storyboard, drawing (by kind), review, plan, scene */
const kindOf = (system: string) => (system.includes('A CHARACTER.') ? 'character' : system.includes('A PROP') ? 'prop' : system.includes('A DECOR') ? 'decor' : null);
const drawing = { character: exampleCharacter, prop: exampleProp, decor: exampleDecor };
function studio(o: { scene?: (msgs: ChatMessage[]) => string; review?: (msgs: ChatMessage[]) => string; plan?: string } = {}): Answer {
  return (msgs, system) => {
    if (system.includes('STORYBOARD')) return JSON.stringify(storyboard);
    const k = kindOf(system);
    if (k) return JSON.stringify(drawing[k]);
    if (system.startsWith('You review')) return o.review ? o.review(msgs) : '{"ok": true}';
    if (system.startsWith('You prepare')) return o.plan ?? '{"new": []}';
    return o.scene ? o.scene(msgs) : goodScene(msgs[0]!.content.includes('Write scene s2') ? 's2' : 's1', ['l1']);
  };
}

const storyboard = {
  title: 'Le jumeau numérique', language: 'fr', style: 'flat', palette: ['#E07A5F', '#3D405B', '#81B29A', '#F2CC8F', '#1F3A5F'],
  cast: [{ id: 'awa', name: 'Awa', description: 'Une agricultrice sénégalaise, casquette bleue, tablette à la main.' }, { id: 'jumo', name: 'Jumo', description: 'Un petit drone rond et jaune qui vole.' }],
  props: [{ id: 'sensor', name: 'Capteur', description: 'Un piquet vert planté dans le sol, avec une lumière qui clignote.' }],
  decors: [{ id: 'field', name: 'Le champ', description: "Un champ de mil à l'aube." }, { id: 'night', name: 'La nuit', description: 'Le même champ la nuit, ciel étoilé.' }],
  scenes: [
    { id: 's1', title: 'Le champ', duration: 10, decor: 'field', props: ['sensor'], music: { mood: 'calm' }, narration: [{ id: 'l1', text: 'Voici Awa.' }, { id: 'l2', speaker: 'jumo', text: 'Bip !' }], shots: ['Awa arrive à pied', 'Jumo descend du ciel sur l2'] },
    { id: 's2', title: 'La nuit', duration: 8, decor: 'night', narration: [{ id: 'l1', text: 'La nuit tombe.' }], shots: ['Jumo scintille'] },
  ],
};
const goodScene = (id: string, lines: string[], extra: object[] = []) => JSON.stringify({
  id, title: 'x', duration: 8, decor: { kind: id === 's1' ? 'field' : 'night' },
  narration: [{ id: 'zz', text: 'the model rewrote this' }], // must be replaced by the storyboard's lines
  elements: [{ id: 'awa', type: 'character', ref: 'awa', keys: [{ t: 0, x: 400, y: 900, pose: 'walk' }, { t: { line: lines[0] }, x: 800, pose: 'wave', expression: 'happy' }] }, ...extra],
});
const sb = Storyboard.parse(storyboard);
const drawings = async () => (await generateDrawings(scripted([studio()]), sb)).assets;

describe('extractJson', () => {
  it('finds JSON in fences or prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Voici : {"b": {"c": 2}} merci')).toEqual({ b: { c: 2 } });
    expect(() => extractJson('rien')).toThrow();
  });
});

describe('storyboard', () => {
  it('asks for everything to draw, in the language, with no stock library', async () => {
    const m = scripted([JSON.stringify(storyboard)]), steps: Step[] = [];
    const s = await generateStoryboard(m, 'Awa rêve d\'un jumeau numérique.', { language: 'fr', style: 'flat', targetSeconds: 20 }, (x) => steps.push(x));
    expect(s.scenes.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(s.palette).toHaveLength(5);
    const system = m.calls[0]!.system;
    expect(system).toContain('French');
    expect(system).toContain('there is no stock library');
    expect(system).not.toContain('dawn-field');
    expect(system).toContain('about 20 seconds');
    expect(steps).toMatchObject([{ stage: 'storyboard', attempt: 0, ok: true }]);
  });

  it('sends the problems back and accepts the repaired answer', async () => {
    const bad = { ...storyboard, scenes: [{ ...storyboard.scenes[0], decor: 'volcano' }] };
    const m = scripted([JSON.stringify(bad), 'not json at all', JSON.stringify(storyboard)]);
    const s = await generateStoryboard(m, 'x', { language: 'fr', style: 'flat' });
    expect(s.title).toBe('Le jumeau numérique');
    expect(m.calls).toHaveLength(3);
    expect(m.calls[1]!.messages.at(-1)!.content).toContain('scenes.0.decor');
    expect(m.calls[2]!.messages.at(-1)!.content).toContain('JSON');
  });

  it('refuses ids shared between a character, a prop and a decor', () => {
    const r = Storyboard.safeParse({ ...storyboard, props: [{ id: 'awa', name: 'x', description: 'un objet' }], scenes: storyboard.scenes.map((s) => ({ ...s, props: [] })) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('« awa » est déjà un personnage');
  });

  it('still reads a storyboard from before drawings were generated', () => {
    const old = { title: 'Ancien', cast: [{ id: 'awa', kind: 'person', name: 'Awa' }], scenes: [{ id: 's1', duration: 5, decor: { kind: 'dawn-field' }, narration: [] }] };
    const r = Storyboard.parse(old);
    expect(r.decors).toEqual([{ id: 'dawn-field', name: 'dawn-field', description: 'décor « dawn-field »' }]);
    expect(r.scenes[0]!.decor).toBe('dawn-field');
    expect(r.cast[0]!.description).toBe('person Awa');
  });

  it('gives up after two repairs, and stops at once on a provider failure', async () => {
    const m = scripted(['{"title": ""}']);
    await expect(generateStoryboard(m, 'x', { language: 'fr', style: 'flat' })).rejects.toBeInstanceOf(InvalidAnswer);
    expect(m.calls).toHaveLength(3);
    const down: Model = { label: 'x', call: async () => ({ ok: false, status: 401, error: 'clé refusée par le fournisseur' }) };
    await expect(generateStoryboard(down, 'x', { language: 'fr', style: 'flat' })).rejects.toBeInstanceOf(ModelError);
  });
});

describe('drawings', () => {
  const brief = { id: 'awa', kind: 'character' as const, name: 'Awa', description: 'Une agricultrice.' };

  it('draws every character, prop and decor of the storyboard, told the palette and the others', async () => {
    const m = scripted([studio()]);
    const { assets, results } = await generateDrawings(m, sb, { concurrency: 2 });
    expect(Object.keys(assets).sort()).toEqual(['awa', 'field', 'jumo', 'night', 'sensor']);
    expect(assets.awa!.kind).toBe('character');
    expect(assets.field!.kind).toBe('decor');
    expect(results.every((r) => !r.fallback)).toBe(true);
    const asked = m.calls.find((c) => c.messages[0]!.content.includes('Draw the character "Awa"'))!;
    expect(asked.messages[0]!.content).toContain('#E07A5F');
    expect(asked.messages[0]!.content).toContain('prop "Capteur"');
    expect(asked.system).toContain('REQUIRED POSES');
  });

  it('checks size, feet, poses and expressions, and has the model repair them', async () => {
    const c = checkAsset(brief);
    const issues = (v: unknown) => { const r = c(v); return r.ok ? [] : r.issues.map((i) => i.message); };
    expect(issues(exampleCharacter)).toEqual([]);
    const noWalk = { ...exampleCharacter, poses: { idle: {} } };
    expect(issues(noWalk).join(' | ')).toContain('pose « walk » manquante');
    expect(issues({ ...exampleCharacter, expressions: {} }).join(' | ')).toContain('expression « happy » manquante');
    const blob = { kind: 'character', parts: [{ id: 'b', shapes: [{ type: 'ellipse', cx: 0, cy: -900, rx: 40, ry: 400, fill: '#000000' }] }] };
    expect(issues(blob).join(' | ')).toMatch(/hauteur 800 px/);
    expect(issues(blob).join(' | ')).toContain('les pieds doivent toucher y = 0');
    const m = scripted([JSON.stringify(noWalk), JSON.stringify(exampleCharacter)]);
    const r = await drawOne(m, brief, { title: 'f', style: 'flat' });
    expect(r.fallback).toBe(false);
    expect(m.calls[1]!.messages.at(-1)!.content).toContain('pose « walk » manquante');
  });

  it('looks at each drawing and takes the model\'s correction', async () => {
    const shots: string[] = [];
    const fixed = { ...exampleCharacter, name: 'Awa corrigée' };
    const m = scripted([JSON.stringify(exampleCharacter), JSON.stringify({ ok: false, problems: ['la main flotte'], asset: fixed }), '{"ok": true}']);
    const r = await drawOne(m, brief, { title: 'f', style: 'watercolor' }, { preview: async (p) => { shots.push(p.style!); return 'UE5H'; } });
    expect(r.asset.name).toBe('Awa corrigée');
    expect(r.rounds).toBe(2);
    expect(r.review).toEqual(['la main flotte', 'relu : bon']);
    expect(r.asset.made).toMatchObject({ by: 'fake', rounds: 2 });
    expect(shots).toEqual(['flat', 'flat']); // looked at in the clearest style
    expect(m.calls[1]!.messages[0]!.images).toEqual([{ mediaType: 'image/png', data: 'UE5H' }]);
    expect(m.calls[1]!.messages[0]!.content).toContain('four times');
  });

  it('keeps the drawing when the model cannot see images, and stops asking for the rest of the job', async () => {
    let reviews = 0;
    const m: Model = { label: 'text-only', call: async (req) => {
      if (req.system.startsWith('You review')) { reviews++; return { ok: false, status: 400, error: 'requête refusée (400)' }; }
      return { ok: true, text: JSON.stringify(drawing[kindOf(req.system)!]), usage: { inputTokens: 1, outputTokens: 1 } };
    } };
    const { results } = await generateDrawings(m, sb, { concurrency: 1, preview: async () => 'x' });
    expect(reviews).toBe(1);
    expect(results[0]!.review).toEqual(['pas de relecture visuelle : requête refusée (400)']);
    expect(results.every((r) => !r.fallback)).toBe(true);
  });

  it('falls back to a plain drawing, coloured from the palette, when the model cannot make one', async () => {
    const r = await drawOne(scripted(['{"kind": "character", "parts": []}']), brief, { title: 'f', style: 'flat', palette: ['#123456'] });
    expect(r.fallback).toBe(true);
    expect(r.asset.made?.by).toBe('dessin de secours');
    expect(JSON.stringify(r.asset)).toContain('#123456');
    for (const kind of ['character', 'prop', 'decor'] as const) expect(checkAsset({ ...brief, kind })(fallbackAsset({ ...brief, kind })).ok).toBe(true);
  });
});

describe('scenes', () => {
  it('writes each scene with the film\'s drawings, keeps the approved narration, assembles the project', async () => {
    const assets = await drawings(), m = scripted([studio()]);
    const { project, results } = await generateScenes(m, sb, assets, { concurrency: 2 });
    expect(results.map((r) => r.fallback)).toEqual([false, false]);
    expect(project.scenes[0]!.narration.map((l) => [l.id, l.speaker, l.text])).toEqual([['l1', 'narrator', 'Voici Awa.'], ['l2', 'jumo', 'Bip !']]);
    expect(project.cast.awa).toMatchObject({ kind: 'awa', name: 'Awa' });
    expect(Object.keys(project.assets)).toHaveLength(5);
    expect(parseProject(project).ok).toBe(true);
    const system = m.calls[0]!.system;
    expect(system).toContain('THE ANIMATION FORMAT');
    expect(system).toContain('"ref":"awa"');
    expect(system).toContain('"poses":["idle","walk","talk","point","wave","think","cheer"]');
  });

  it('refuses stock library things and poses a drawing does not have', async () => {
    const assets = await drawings();
    const withStock = goodScene('s1', ['l1'], [{ id: 't', type: 'prop', ref: 'tree', keys: [{ t: 0, x: 100, y: 900 }] }]);
    const withBadPose = goodScene('s1', ['l1']).replace('"wave"', '"moonwalk"');
    const m = scripted([withStock, withBadPose, goodScene('s1', ['l1'])]);
    const { results } = await generateScenes(m, Storyboard.parse({ ...storyboard, scenes: [storyboard.scenes[0]] }), assets, { concurrency: 1 });
    expect(results[0]!.fallback).toBe(false);
    expect(m.calls[1]!.messages.at(-1)!.content).toContain("« tree » n'est pas un accessoire du film (sensor)");
    expect(m.calls[2]!.messages.at(-1)!.content).toContain('moonwalk');
  });

  it('falls back to a plain scene with the drawings when the model cannot get it right', async () => {
    const assets = await drawings();
    const m = scripted(['{"elements": [{"id": "x", "type": "prop", "ref": "unicorn", "keys": [{"t": 0}]}]}']);
    const { project, results } = await generateScenes(m, sb, assets, { concurrency: 1 });
    expect(results.every((r) => r.fallback)).toBe(true);
    expect(results[0]!.issues.some((i) => i.message.includes('unicorn'))).toBe(true);
    expect(project.scenes[0]!.elements.map((e) => e.id)).toEqual(['awa', 'jumo', 'p-sensor', 'title']);
    expect(project.scenes[0]!.decor.kind).toBe('field');
    expect(parseProject(project).ok).toBe(true);
    for (const s of sb.scenes) expect(fallbackScene(sb, s).decor).toEqual({ kind: s.decor });
  });
});

describe('edit a scene', () => {
  const drawnProject = async () => { const assets = await drawings(); return (await generateScenes(scripted([studio()]), sb, assets)).project; };

  it('draws what the change needs first, then writes the scene with it', async () => {
    const project = await drawnProject();
    const lamp = { id: 'lamp', kind: 'prop', name: 'Lanterne', description: 'Une lanterne à huile qui éclaire.' };
    const add = (i: number, e: object) => () => JSON.stringify({ ...project.scenes[i], elements: [...project.scenes[i]!.elements, e] });
    const m = scripted([studio({ plan: JSON.stringify({ new: [lamp] }), scene: add(1, { id: 'lamp1', type: 'prop', ref: 'lamp', keys: [{ t: 0, x: 900, y: 900 }] }) })]);
    const r = await editScene(m, project, 1, 'ajoute une lanterne');
    expect(Object.keys(r.assets)).toEqual(['lamp']);
    expect(r.scene.elements.map((e) => e.ref)).toContain('lamp');
    expect(r.scene.id).toBe('s2');
    expect(m.calls.some((c) => c.messages[0]!.content.includes('Draw the prop "Lanterne"'))).toBe(true);
  });

  it('a new character gets its cast entry; nothing new, nothing drawn', async () => {
    const project = await drawnProject();
    const fox = { id: 'fox', kind: 'character', name: 'Renard', description: 'Un renard roux malicieux.' };
    const r = await editScene(scripted([studio({ plan: JSON.stringify({ new: [fox] }), scene: () => JSON.stringify({ ...project.scenes[0], elements: [...project.scenes[0]!.elements, { id: 'f', type: 'character', ref: 'fox', keys: [{ t: 0, x: 1200, y: 900, pose: 'walk' }] }] }) })]), project, 0, 'un renard passe');
    expect(r.cast.fox).toMatchObject({ kind: 'fox', name: 'Renard' });
    const m = scripted([studio({ scene: () => JSON.stringify({ ...project.scenes[0], music: { mood: 'calm' } }) })]);
    const none = await editScene(m, project, 0, 'plus calme');
    expect(none.assets).toEqual({});
    expect(m.calls.filter((c) => kindOf(c.system))).toHaveLength(0);
  });

  it('keeps what the model left out, and the recordings of unchanged lines', async () => {
    const project = (() => { const r = parseProject(exampleProject); if (!r.ok) throw new Error(); return r.project; })(); // made before drawings were generated
    const p = structuredClone(project);
    p.scenes[0]!.narration[0]!.audio = { asset: 'a'.repeat(32), textHash: 'x' }; p.scenes[0]!.narration[0]!.duration = 1.23;
    const { narration: _n, ...withoutNarration } = p.scenes[0]!;
    const r = await editScene(scripted([studio({ scene: () => JSON.stringify({ ...withoutNarration, music: { mood: 'calm' } }) })]), p, 0, 'plus calme');
    expect(r.scene.narration[0]).toMatchObject({ id: 'l1', duration: 1.23, audio: { asset: 'a'.repeat(32) } });
    expect(r.scene.music.mood).toBe('calm');
  });

  it('refuses an edit that stays invalid', async () => {
    const project = parseProject(exampleProject as ProjectInput);
    if (!project.ok) throw new Error();
    await expect(editScene(scripted([studio({ scene: () => '{"id": "s2", "decor": {"kind": 3}}' })]), project.project, 1, 'x')).rejects.toBeInstanceOf(InvalidAnswer);
  });
});
