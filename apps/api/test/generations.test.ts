import { exampleCharacter, exampleDecor, exampleProp } from '@af/ai';
import type { JsonPost } from '@af/providers';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const storyboard = {
  title: 'La quête', language: 'fr', style: 'flat', palette: ['#E07A5F', '#3D405B', '#81B29A'],
  cast: [{ id: 'awa', name: 'Awa', description: 'Une jeune fille, pull corail.' }],
  props: [{ id: 'bag', name: 'Sac', description: 'Un sac à dos vert.' }],
  decors: [{ id: 'field', name: 'Champ', description: "Un champ à l'aube." }, { id: 'room', name: 'Salle', description: 'Une salle de classe.' }],
  scenes: [
    { id: 's1', title: 'Départ', duration: 8, decor: 'field', props: ['bag'], narration: [{ id: 'l1', text: 'Awa part.' }], shots: ['Awa marche'] },
    { id: 's2', title: 'Arrivée', duration: 6, decor: 'room', narration: [{ id: 'l1', text: 'Elle arrive.' }], shots: ['Awa salue'] },
  ],
};
const scene = (id: string) => ({ id, duration: 6, decor: { kind: id === 's1' ? 'field' : 'room' }, elements: [{ id: 'awa', type: 'character', ref: 'awa', keys: [{ t: 0, x: 300, y: 900, pose: 'walk' }, { t: { line: 'l1', edge: 'end' }, x: 900, pose: 'wave' }] }] });

// a text model speaking the OpenAI chat API, answering by what it is asked: storyboard, drawing, review (it gets
// the image of its drawing), plan of an edit, scene
let brokenScenes = false, reviewed = 0;
const text = (content: unknown) => (typeof content === 'string' ? content : (content as { type: string; text?: string }[]).find((x) => x.type === 'text')?.text ?? '');
const llm = vi.fn<JsonPost>(async (_url, init) => {
  const body = JSON.parse(init.body), system: string = body.messages[0].content, lastMsg = body.messages.at(-1), last = text(lastMsg.content);
  let content: string;
  if (system.includes('STORYBOARD')) content = JSON.stringify(storyboard);
  else if (system.includes('A CHARACTER.')) content = JSON.stringify(exampleCharacter);
  else if (system.includes('A PROP')) content = JSON.stringify(exampleProp);
  else if (system.includes('A DECOR')) content = JSON.stringify(exampleDecor);
  else if (system.startsWith('You review')) { reviewed++; const img = (lastMsg.content as { type: string; image_url?: { url: string } }[]).find((x) => x.type === 'image_url'); content = img?.image_url?.url.startsWith('data:image/png;base64,iVBOR') ? '{"ok": true}' : '{"ok": false, "problems": ["pas d\'image"]}'; }
  else if (system.startsWith('You prepare')) content = JSON.stringify({ new: last.includes('lanterne') ? [{ id: 'lamp', kind: 'prop', name: 'Lanterne', description: 'Une lanterne qui éclaire.' }] : [] });
  else if (last.includes('Change it as follows')) content = last.includes('lanterne')
    ? JSON.stringify({ ...JSON.parse(last.slice(last.indexOf('{'), last.lastIndexOf('}\n') + 1)), elements: [{ id: 'lamp1', type: 'prop', ref: 'lamp', keys: [{ t: 0, x: 900, y: 900 }] }] })
    : JSON.stringify({ ...scene('s1'), decor: { kind: 'dawn-field' }, music: { mood: 'epic' } });
  else content = brokenScenes ? '{"elements": 42}' : JSON.stringify(scene(/Write scene (\w+)/.exec(last)?.[1] ?? 's1'));
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }) };
});

let db: Db, app: FastifyInstance, c: Client;
const get = async (id: string) => (await c.inject({ url: `/api/generations/${id}` })).json();
const until = async (id: string, statuses: string[]) => { for (let i = 0; i < 200; i++) { const g = await get(id); if (statuses.includes(g.status)) return g; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout'); };

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), llmFetch: llm });
  c = await signUp(app, 'owner@example.org');
});
afterAll(async () => { await app.close(); await db.close(); });

describe('generation', () => {
  it('needs a model for both tasks first', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une histoire assez longue.' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('Texte → storyboard');
    const cred = (await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'llm', apiKey: 'sk-test-llm-0000000' } })).json();
    await c.inject({ method: 'PUT', url: '/api/assignments/storyboard', payload: { credentialId: cred.id, model: 'gpt-a' } });
    expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une histoire assez longue.' } })).json().error).toContain('Storyboard → scènes');
    await c.inject({ method: 'PUT', url: '/api/assignments/scenes', payload: { credentialId: cred.id, model: 'gpt-b' } });
  });

  let id = '';
  it('writes a storyboard, waits for review, then writes the scenes into a new project', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Awa part en quête du jumeau numérique.', style: 'flat', targetSeconds: 30 } });
    expect(r.statusCode).toBe(202);
    id = r.json().id;
    const review = await until(id, ['review', 'failed']);
    expect(review).toMatchObject({ status: 'review', scenesTotal: 2, models: { storyboard: 'OpenAI · gpt-a' } });
    expect(review.storyboard.scenes[0].narration[0].text).toBe('Awa part.');
    expect(review.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });

    // the user edits the script before the scenes are written
    const edited = structuredClone(review.storyboard); edited.scenes[1].narration[0].text = 'Elle arrive enfin.';
    expect((await c.inject({ method: 'PUT', url: `/api/generations/${id}/storyboard`, payload: { storyboard: edited } })).statusCode).toBe(200);
    const bad = structuredClone(edited); bad.scenes[0].decor = 'volcano';
    expect((await c.inject({ method: 'PUT', url: `/api/generations/${id}/storyboard`, payload: { storyboard: bad } })).statusCode).toBe(422);

    expect((await c.inject({ method: 'POST', url: `/api/generations/${id}/scenes` })).statusCode).toBe(200);
    const done = await until(id, ['done', 'failed']);
    // everything the storyboard needs was drawn (by the scenes model: no « Dessins » model chosen), looked at, then the scenes written
    expect(done).toMatchObject({ status: 'done', scenesDone: 2, assetsDone: 4, assetsTotal: 4, fallbacks: [], models: { scenes: 'OpenAI · gpt-b', assets: 'OpenAI · gpt-b' } });
    expect(done.drawings.sort()).toEqual(['awa', 'bag', 'field', 'room']);
    expect(done.steps.map((s: { stage: string; target: string }) => `${s.stage}:${s.target}`).sort()).toEqual(['asset:awa', 'asset:bag', 'asset:field', 'asset:room', 'review:awa', 'review:bag', 'review:field', 'review:room', 'scene:s1', 'scene:s2', 'storyboard:storyboard']);
    expect(reviewed).toBe(4); // each one shown to the model as a real PNG
    const project = (await c.inject({ url: `/api/projects/${done.projectId}` })).json();
    expect(project.title).toBe('La quête');
    expect(project.project.scenes[1].narration[0].text).toBe('Elle arrive enfin.');
    expect(project.project.scenes[0].elements[0].keys[1].pose).toBe('wave');
    expect(Object.keys(project.project.assets).sort()).toEqual(['awa', 'bag', 'field', 'room']);
    expect(project.project.cast.awa).toMatchObject({ kind: 'awa', name: 'Awa' });
    expect(project.project.assets.awa.made).toMatchObject({ by: 'OpenAI · gpt-b', rounds: 1 });
    // the scene model was asked with the format and the film's own drawings
    const sceneCall = llm.mock.calls.find((c) => JSON.parse(c[1].body).messages[0].content.startsWith('You animate'))!;
    expect(JSON.parse(sceneCall[1].body).messages[0].content).toContain('THE ANIMATION FORMAT');
    expect(JSON.parse(sceneCall[1].body).messages[0].content).toContain('"ref":"bag"');
  });

  it('can run without review, and keeps a plain scene where the model fails', async () => {
    brokenScenes = true;
    const r = (await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une autre histoire assez longue.', review: false } })).json();
    const done = await until(r.id, ['done', 'failed']);
    brokenScenes = false;
    expect(done.status).toBe('done');
    expect(done.fallbacks.sort()).toEqual(['s1', 's2']);
    expect(done.steps.filter((s: { ok: boolean; stage: string }) => !s.ok && s.stage === 'scene').length).toBe(6); // 3 attempts per scene
    expect((await c.inject({ url: `/api/projects/${done.projectId}` })).statusCode).toBe(200);
  });

  it('reports a provider refusal as a failed job', async () => {
    llm.mockImplementationOnce(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = (await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Encore une histoire assez longue.' } })).json();
    expect(await until(r.id, ['failed'])).toMatchObject({ status: 'failed', error: 'clé refusée par le fournisseur' });
    const retry = await c.inject({ method: 'POST', url: `/api/generations/${r.id}/storyboard/retry`, payload: { instructions: 'plus court' } });
    expect(retry.json().input.instructions).toBe('plus court');
    expect((await until(r.id, ['review'])).status).toBe('review');
    expect((await c.inject({ method: 'POST', url: `/api/generations/${r.id}/cancel` })).json().status).toBe('review');
  });

  it('lists recent generations and refuses bad input', async () => {
    expect((await c.inject({ url: '/api/generations' })).json().length).toBeGreaterThanOrEqual(3);
    expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'court' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'assez long texte ici', style: 'oil' } })).statusCode).toBe(400);
  });
});

describe('edit a scene with the model', () => {
  it('returns a validated scene for the editor to apply', async () => {
    const p = (await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json();
    const r = await c.inject({ method: 'POST', url: '/api/ai/edit-scene', payload: { project: p.project, sceneIndex: 0, instruction: 'rends-la plus épique' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ scene: { id: 's1', music: { mood: 'epic' } }, assets: {}, model: 'OpenAI · gpt-b' });
    // a change that needs something new: it is drawn first, and comes back with the scene
    const lamp = await c.inject({ method: 'POST', url: '/api/ai/edit-scene', payload: { project: p.project, sceneIndex: 1, instruction: 'ajoute une lanterne' } });
    expect(lamp.statusCode).toBe(200);
    expect(Object.keys(lamp.json().assets)).toEqual(['lamp']);
    expect(lamp.json().drawn).toMatchObject([{ id: 'lamp', fallback: false, rounds: 1 }]);
    expect(lamp.json().scene.elements.map((e: { ref: string }) => e.ref)).toContain('lamp');
    expect((await c.inject({ method: 'POST', url: '/api/ai/edit-scene', payload: { project: { bad: 1 }, sceneIndex: 0, instruction: 'x x x' } })).statusCode).toBe(422);
  });
});

describe('draw one thing', () => {
  it('draws it for the project, or draws it again with a change', async () => {
    const p = (await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json();
    const r = await c.inject({ method: 'POST', url: '/api/ai/draw', payload: { project: p.project, id: 'cat', kind: 'character', name: 'Chat', description: 'Un chat roux.' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ asset: { kind: 'character', name: 'Nina' }, fallback: false, rounds: 1, review: ['relu : bon'], model: 'OpenAI · gpt-b' });
    const again = await c.inject({ method: 'POST', url: '/api/ai/draw', payload: { project: p.project, id: 'cat', kind: 'character', name: 'Chat', description: 'Un chat roux.', instruction: 'plus grand', current: r.json().asset } });
    expect(again.statusCode).toBe(200);
    const asked = llm.mock.calls.map((x) => JSON.parse(x[1].body)).filter((b) => b.messages[0].content.includes('A CHARACTER.')).at(-1)!;
    expect(text(asked.messages[1].content)).toContain('Change requested: plus grand');
    expect(text(asked.messages[1].content)).toContain('The current drawing, to change');
    expect((await c.inject({ method: 'POST', url: '/api/ai/draw', payload: { project: p.project, id: 'x y', kind: 'prop', name: 'x', description: 'abc' } })).statusCode).toBe(400);
  });
});
