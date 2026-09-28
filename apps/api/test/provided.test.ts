// Pictures given to the AI (a mascot, a logo): named in the storyboard prompt, required in the storyboard under their
// id, never drawn, and in the project as the picture itself, with the poses of a still picture.
import { exampleDecor } from '@af/ai';
import type { JsonPost } from '@af/providers';
import { createCanvas } from '@napi-rs/canvas';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const text = (content: unknown) => (typeof content === 'string' ? content : (content as { type: string; text?: string }[]).find((x) => x.type === 'text')?.text ?? '');
const asked: string[] = [];
let storyPrompt = '';
const storyboard = (withMascot: boolean) => ({
  title: 'Le lion', language: 'fr', style: 'flat', palette: ['#00853F'],
  cast: withMascot ? [{ id: 'mascotte', name: 'La mascotte', description: 'un lion souriant' }] : [],
  decors: [{ id: 'plage', name: 'Plage', description: 'Une plage au soleil.' }],
  scenes: [{ id: 's1', title: 'Bonjour', duration: 6, decor: 'plage', music: 'none', narration: [{ id: 'l1', speaker: withMascot ? 'mascotte' : 'narrator', text: 'Bienvenue !' }], shots: ['the mascot dances'] }],
});
const llm = vi.fn<JsonPost>(async (_url, init) => {
  const body = JSON.parse(init.body), system: string = body.messages[0].content, last = text(body.messages.at(-1).content);
  let content: unknown;
  // like a model that forgets the picture at first, then corrects itself when told
  if (system.includes('STORYBOARD')) { storyPrompt = system; asked.push(body.messages.length > 2 ? 'storyboard again' : 'storyboard'); content = storyboard(body.messages.length > 2); }
  else if (system.startsWith('You draw')) { asked.push(`draw ${/\(id "([^"]+)"\)/.exec(last)?.[1]}`); content = exampleDecor; }
  else if (system.startsWith('You review')) content = { ok: true };
  else if (system.startsWith('You compose')) content = { pieces: {}, music: { s1: 'none' } };
  else if (system.startsWith('You design')) content = {};
  else content = { id: 's1', duration: 6, decor: { kind: 'plage' }, elements: [{ id: 'm', type: 'character', ref: 'mascotte', keys: [{ t: 0, x: 900, y: 900, pose: 'dance', facing: -1 }] }] };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) };
});

let db: Db, app: FastifyInstance, c: Client;
beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), llmFetch: llm });
  c = await signUp(app, 'agence@example.org');
  const cred = (await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'llm', apiKey: 'sk-test-llm-0000000' } })).json();
  for (const t of ['storyboard', 'scenes']) await c.inject({ method: 'PUT', url: `/api/assignments/${t}`, payload: { credentialId: cred.id, model: 'm' } });
});
afterAll(async () => { await app.close(); await db.close(); });

it('uses a picture given to the AI as it is: in the storyboard under its id, not drawn, with poses, never mirrored', async () => {
  const cv = createCanvas(200, 300), x = cv.getContext('2d'); x.fillStyle = '#C8553D'; x.fillRect(40, 20, 120, 260);
  const pic = (await c.inject({ method: 'POST', url: '/api/uploads/image', payload: cv.toBuffer('image/png'), headers: { 'content-type': 'image/png' } })).json();
  const media = [{ id: 'mascotte', kind: 'character', name: 'La mascotte', description: 'un lion souriant, chapeau tressé', asset: pic.asset, width: pic.width, height: pic.height }];
  expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une campagne pour les Jeux.', media: [{ ...media[0], asset: 'f'.repeat(32) }] } })).statusCode).toBe(400);
  const r = await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une campagne pour les Jeux.', style: 'flat', review: false, media } });
  expect(r.statusCode).toBe(202);
  let g: any;
  for (let i = 0; i < 200; i++) { g = (await c.inject({ url: `/api/generations/${r.json().id}` })).json(); if (['done', 'failed'].includes(g.status)) break; await new Promise((ok) => setTimeout(ok, 25)); }
  expect(g.status).toBe('done');
  // the storyboard was told, and held to it (the first answer forgot the mascot: it was asked again)
  expect(storyPrompt).toContain('- id "mascotte" in "cast": La mascotte — un lion souriant, chapeau tressé');
  expect(asked.filter((a) => a.startsWith('storyboard'))).toEqual(['storyboard', 'storyboard again']);
  expect(asked.filter((a) => a.startsWith('draw'))).toEqual(['draw plage']);
  expect(g.fallbacks).toEqual([]);
  const p = (await c.inject({ url: `/api/projects/${g.projectId}` })).json().project;
  const a = p.assets.mascotte;
  expect(a).toMatchObject({ kind: 'character', flip: false, made: { by: 'image fournie' } });
  expect(a.parts[0].shapes[0]).toMatchObject({ type: 'image', asset: pic.asset, h: 340 });
  expect(Object.keys(a.poses)).toEqual(expect.arrayContaining(['idle', 'talk', 'walk', 'jump', 'cheer', 'wave', 'dance']));
  expect(p.cast.mascotte).toMatchObject({ kind: 'mascotte' });
  expect(p.scenes[0].elements[0]).toMatchObject({ ref: 'mascotte' });
});
