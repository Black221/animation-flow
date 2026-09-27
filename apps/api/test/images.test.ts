// Decors painted as pictures: the optional « Décors en images » task, storage per workspace, signed links.
import { exampleCharacter, exampleDecor } from '@af/ai';
import { createCanvas } from '@napi-rs/canvas';
import type { JsonPost } from '@af/providers';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const storyboard = {
  title: 'Le parc', language: 'fr', style: 'watercolor', palette: ['#E07A5F', '#3D405B', '#81B29A'],
  cast: [{ id: 'awa', name: 'Awa', description: 'Une jeune fille, pull corail.' }],
  decors: [{ id: 'park', name: 'Parc', description: 'Un parc au printemps, des arbres, une allée.' }],
  scenes: [{ id: 's1', duration: 6, decor: 'park', narration: [{ id: 'l1', text: 'Awa se promène.' }], shots: ['Awa marche'] }],
};
const scene = { id: 's1', duration: 6, decor: { kind: 'park' }, elements: [{ id: 'awa', type: 'character', ref: 'awa', keys: [{ t: 0, x: 400, y: 900 }] }] };
const png = (() => { const c = createCanvas(1536, 1024), ctx = c.getContext('2d'); ctx.fillStyle = '#88aa55'; ctx.fillRect(0, 0, 1536, 1024); return c.toBuffer('image/png').toString('base64'); })();

let refuse = false;
const prompts: string[] = [];
const fetchImpl = vi.fn<JsonPost>(async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.endsWith('/images/generations')) {
    prompts.push(body.prompt);
    return refuse ? { ok: false, status: 400, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png }] }) };
  }
  const system: string = body.messages[0].content;
  let content: string;
  if (system.includes('STORYBOARD')) content = JSON.stringify(storyboard);
  else if (system.includes('A CHARACTER.')) content = JSON.stringify(exampleCharacter);
  else if (system.includes('A DECOR')) content = JSON.stringify(exampleDecor);
  else if (system.startsWith('You review')) content = '{"ok": true}';
  else if (system.startsWith('You compose')) content = JSON.stringify({ pieces: {}, music: { s1: 'none' } });
  else if (system.startsWith('You design')) content = '{}';
  else content = JSON.stringify(scene);
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) };
});

let db: Db, app: FastifyInstance, c: Client;
const imagesDir = mkdtempSync(join(tmpdir(), 'af-img-'));
const until = async (id: string) => { for (let i = 0; i < 200; i++) { const g = (await c.inject({ url: `/api/generations/${id}` })).json(); if (['done', 'failed'].includes(g.status)) return g; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout'); };

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), imagesDir, llmFetch: fetchImpl });
  c = await signUp(app, 'painter@example.org');
  const cred = (await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'openai', apiKey: 'sk-test-img-0000000' } })).json();
  for (const [task, model] of [['storyboard', 'gpt-a'], ['scenes', 'gpt-b']]) await c.inject({ method: 'PUT', url: `/api/assignments/${task}`, payload: { credentialId: cred.id, model } });
});
afterAll(async () => { await app.close(); await db.close(); });

describe('decors painted as pictures', () => {
  let project: { assets: Record<string, { image?: { asset: string; width: number; height: number; by?: string } }> };
  it('stays with drawings until an image model is chosen', async () => {
    const r = (await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Awa se promène dans un parc.', review: false } })).json();
    const done = await until(r.id);
    expect(done.status).toBe('done');
    expect(done.models.images).toBeUndefined();
    const p = (await c.inject({ url: `/api/projects/${done.projectId}` })).json().project;
    expect(p.assets.park.image).toBeUndefined();
    expect(prompts).toEqual([]);
    expect((await c.inject({ method: 'POST', url: '/api/ai/decor-image', payload: { name: 'Parc', description: 'Un parc.' } })).json().error).toContain('Décors en images');
  });

  it('paints every decor with the chosen model, next to its drawing', async () => {
    const cred = (await c.inject({ url: '/api/credentials' })).json()[0];
    expect((await c.inject({ method: 'PUT', url: '/api/assignments/images', payload: { credentialId: cred.id, model: 'gpt-image-1' } })).statusCode).toBe(200);
    const r = (await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Awa se promène dans un parc.', review: false } })).json();
    const done = await until(r.id);
    expect(done).toMatchObject({ status: 'done', fallbacks: [], models: { images: 'OpenAI · gpt-image-1' } });
    const stages = done.steps.map((s: { stage: string; target: string }) => `${s.stage}:${s.target}`);
    expect(stages).toContain('picture:park');
    expect(stages).not.toContain('review:park'); // a painted decor's drawing is not looked at
    expect(stages).toContain('review:awa');
    expect(prompts[0]).toContain('Parc. Un parc au printemps');
    expect(prompts[0]).toContain('watercolour');
    expect(prompts[0]).toContain('#E07A5F');
    expect(prompts[0]).toContain('No people');
    project = (await c.inject({ url: `/api/projects/${done.projectId}` })).json().project;
    expect(project.assets.park!.image).toMatchObject({ width: 1536, height: 1024, by: 'OpenAI · gpt-image-1' });
    expect(project.assets.awa!.image).toBeUndefined();
    expect(readdirSync(join(imagesDir, c.workspaces[0]!.id))).toEqual([`${project.assets.park!.image!.asset}.jpg`]);
  });

  it('serves pictures through signed links, to their workspace only', async () => {
    const asset = project.assets.park!.image!.asset;
    const links = (await c.inject({ method: 'POST', url: '/api/images/links', payload: { assets: [asset, 'f'.repeat(32)] } })).json();
    expect(Object.keys(links)).toEqual([asset]);
    const ok = await app.inject({ url: links[asset] });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await app.inject({ url: links[asset].replace(/sig=[^&]+/, 'sig=00') })).statusCode).toBe(403);
    expect((await app.inject({ url: links[asset].split('?')[0] })).statusCode).toBe(403);
    // another workspace knowing the id gets nothing
    c.ws = (await c.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Autre' } })).json().id;
    expect((await c.inject({ method: 'POST', url: '/api/images/links', payload: { assets: [asset] } })).json()).toEqual({});
    c.ws = null;
  });

  it('paints one decor again from the editor, and says why when the model refuses', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/ai/decor-image', payload: { name: 'Parc', description: 'Un parc.', instruction: 'la nuit, sous la lune', style: 'flat' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ image: { width: 1536, height: 1024 }, model: 'OpenAI · gpt-image-1', url: expect.stringContaining('/api/images/') });
    expect(prompts.at(-1)).toContain('la nuit, sous la lune');
    expect(prompts.at(-1)).toContain('flat vector');
    refuse = true;
    const bad = await c.inject({ method: 'POST', url: '/api/ai/decor-image', payload: { name: 'Parc', description: 'Un parc.' } });
    expect(bad.statusCode).toBe(502);
    // in a generation, a refused picture leaves the drawing and says so
    const g = await until((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Awa se promène dans un parc.', review: false } })).json().id);
    expect(g.status).toBe('done');
    expect(g.steps.find((s: { stage: string }) => s.stage === 'picture')).toMatchObject({ ok: false });
    expect((await c.inject({ url: `/api/projects/${g.projectId}` })).json().project.assets.park.image).toBeUndefined();
    refuse = false;
  });

  it('deletes the pictures with the workspace', async () => {
    const ws = c.workspaces[0]!;
    expect(existsSync(join(imagesDir, ws.id))).toBe(true);
    expect((await c.inject({ method: 'DELETE', url: '/api/workspace', payload: { confirm: ws.name } })).statusCode).toBe(204);
    expect(existsSync(join(imagesDir, ws.id))).toBe(false);
  });
});
