// Files brought with the prompt as MODELS for the AI: a picture of the mascot is shown to the storyboard and to the
// drawing model (and its review), the mascot is drawn after it (no picture of it in the film), a music heard is
// composed after, and nothing brought ends up in the project as it is.
import { exampleCharacter, exampleDecor } from '@af/ai';
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

type Part = { type: string; text?: string; image_url?: { url: string } };
const text = (content: unknown) => (typeof content === 'string' ? content : (content as Part[]).find((x) => x.type === 'text')?.text ?? '');
const pictures = (content: unknown) => (typeof content === 'string' ? 0 : (content as Part[]).filter((x) => x.type === 'image_url').length);
const asked: string[] = [];
let storyPrompt = '', storyPictures = 0, composeAsk = '';
const drawPictures: Record<string, number> = {}, reviewPictures: Record<string, number> = {};
const storyboard = (withMascot: boolean) => ({
  title: 'Le lion', language: 'fr', style: 'flat', palette: ['#00853F'],
  cast: withMascot ? [{ id: 'mascotte', name: 'La mascotte', description: 'un lion souriant, chapeau tressé, t-shirt blanc « DAKAR 2026 »' }] : [],
  decors: [{ id: 'plage', name: 'Plage', description: 'Une plage au soleil.' }],
  scenes: [{ id: 's1', title: 'Bonjour', duration: 6, decor: 'plage', music: 'joyeuse', narration: [{ id: 'l1', speaker: withMascot ? 'mascotte' : 'narrator', text: 'Bienvenue !' }], shots: ['the mascot dances'] }],
});
const llm = vi.fn<JsonPost>(async (_url, init) => {
  const body = JSON.parse(init.body), system: string = body.messages[0].content, first = body.messages[1].content, last = text(body.messages.at(-1).content);
  let content: unknown;
  const id = /\(id "([^"]+)"\)/.exec(text(first))?.[1] ?? '';
  // like a model that forgets the mascot at first, then corrects itself when told
  if (system.includes('STORYBOARD')) { storyPrompt = system; storyPictures = pictures(first); asked.push(body.messages.length > 2 ? 'storyboard again' : 'storyboard'); content = storyboard(body.messages.length > 2); }
  else if (system.startsWith('You draw')) { asked.push(`draw ${id}`); drawPictures[id] = pictures(first); content = id === 'mascotte' ? exampleCharacter : exampleDecor; }
  else if (system.startsWith('You review')) { reviewPictures[id] = pictures(first); content = { ok: true }; }
  else if (system.startsWith('You compose')) { composeAsk = last; content = { pieces: {}, music: { s1: 'none' } }; }
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

it('draws the film after the models brought with the prompt, and puts none of them in it', async () => {
  const cv = createCanvas(200, 300), x = cv.getContext('2d'); x.fillStyle = '#C8553D'; x.fillRect(40, 20, 120, 260);
  const pic = (await c.inject({ method: 'POST', url: '/api/uploads/image', payload: cv.toBuffer('image/png'), headers: { 'content-type': 'image/png' } })).json();
  const references = [
    { id: 'mascotte', kind: 'character', name: 'La mascotte', description: 'la mascotte officielle', asset: pic.asset },
    { id: 'rythme', kind: 'music', name: 'Notre hymne', summary: 'environ 124 BPM, rythme très marqué, très énergique, tonalité probable sol majeur' },
  ];
  // a model is the workspace's own picture; a music comes with what was heard in it
  expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une campagne pour les Jeux.', references: [{ ...references[0], asset: 'f'.repeat(32) }] } })).statusCode).toBe(400);
  expect((await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une campagne pour les Jeux.', references: [{ id: 'm', kind: 'music', name: 'x' }] } })).statusCode).toBe(400);
  const r = await c.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une campagne pour les Jeux.', style: 'flat', review: false, references } });
  expect(r.statusCode).toBe(202);
  let g: any;
  for (let i = 0; i < 200; i++) { g = (await c.inject({ url: `/api/generations/${r.json().id}` })).json(); if (['done', 'failed'].includes(g.status)) break; await new Promise((ok) => setTimeout(ok, 25)); }
  expect(g.status).toBe('done');
  expect(g.input.references).toHaveLength(2);
  // the storyboard saw the picture and was told what to do with it — and held to it (asked again when it forgot)
  expect(storyPrompt).toContain('MODEL of a character "La mascotte" (picture 1 attached): put it in "cast" with id "mascotte"');
  expect(storyPrompt).toContain('MODEL of the music wanted "Notre hymne": environ 124 BPM');
  expect(storyPictures).toBe(1);
  expect(asked.filter((a) => a.startsWith('storyboard'))).toEqual(['storyboard', 'storyboard again']);
  // the mascot is DRAWN, after its picture (shown to the drawing model and to the review); the beach without one
  expect(asked.filter((a) => a.startsWith('draw')).sort()).toEqual(['draw mascotte', 'draw plage']);
  expect(drawPictures).toEqual({ mascotte: 1, plage: 0 });
  expect(reviewPictures.mascotte).toBe(2); // the model and the drawing, side by side
  // the music is composed in the spirit of the one brought
  expect(composeAsk).toContain('The user brought this music as a MODEL');
  expect(composeAsk).toContain('"Notre hymne": environ 124 BPM');
  // nothing brought is in the project: a drawing, not the picture
  const p = (await c.inject({ url: `/api/projects/${g.projectId}` })).json().project;
  expect(p.assets.mascotte.kind).toBe('character');
  expect(JSON.stringify(p)).not.toContain(pic.asset);
  expect(p.soundtrack).toBeUndefined();
});
