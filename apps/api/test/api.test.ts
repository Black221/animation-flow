import { exampleProject } from '@af/schema';
import type { FetchLike } from '@af/providers';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseKey } from '../src/config';
import { secretBox } from '../src/crypto';
import { migrate, type Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const KEY = 'sk-ant-api03-SUPERSECRET-abcd1234';
const voicesDir = mkdtempSync(join(tmpdir(), 'af-voices-'));
let db: Db, app: FastifyInstance, c: Client;
const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] }) }));

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), fetchImpl, voicesDir });
  c = await signUp(app, 'owner@example.org');
});
afterAll(async () => { await app.close(); await db.close(); });

describe('secret box', () => {
  it('round-trips and never stores the plain text', () => {
    const box = secretBox(randomBytes(32)), sealed = box.seal(KEY);
    expect(sealed).not.toContain('SUPERSECRET');
    expect(box.open(sealed)).toBe(KEY);
    expect(() => secretBox(randomBytes(32)).open(sealed)).toThrow();
  });
  it('parses 32-byte keys in base64 or hex', () => {
    expect(parseKey(randomBytes(32).toString('base64')).length).toBe(32);
    expect(parseKey(randomBytes(32).toString('hex')).length).toBe(32);
    expect(() => parseKey('short')).toThrow();
  });
});

describe('migrations', () => {
  it('are idempotent', async () => { expect(await migrate(db)).toBe(0); });
});

describe('projects', () => {
  let id = '';
  it('offers a film drawn for its story as a template', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'pizza' } });
    expect(r.statusCode).toBe(201);
    const p = (await c.inject({ url: `/api/projects/${r.json().id}` })).json().project;
    expect(p.title).toBe('Pizza Time');
    expect(Object.keys(p.assets)).toHaveLength(15);
    expect(Object.keys(p.score)).toEqual(['tictac', 'tarentelle']);
    expect(p.scenes.map((s: { id: string }) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });

  it('shows a frame of each project and template, for this workspace only', async () => {
    const created = (await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'pizza' } })).json();
    const r = await c.inject({ url: `/api/projects/${created.id}/thumbnail.png?v=1` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toContain('immutable');
    expect(r.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    const again = await c.inject({ url: `/api/projects/${created.id}/thumbnail.png?v=1` });
    expect(again.rawPayload.equals(r.rawPayload)).toBe(true);
    const t = await c.inject({ url: '/api/templates/example/thumbnail.png' });
    expect(t.statusCode).toBe(200);
    expect((await c.inject({ url: '/api/templates/nope/thumbnail.png' })).statusCode).toBe(404);
    // public, and one frame per scene (the sign-in page's storyboard)
    const anon = await app.inject({ url: '/api/templates/pizza/thumbnail.png?scene=2' });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['cache-control']).toMatch(/^public/);
    expect(anon.rawPayload.equals((await app.inject({ url: '/api/templates/pizza/thumbnail.png' })).rawPayload)).toBe(false); // not the first scene's frame
    expect((await app.inject({ url: '/api/templates/pizza/thumbnail.png?scene=99' })).statusCode).toBe(404);
    // from another workspace, the project does not exist
    const other = (await c.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Ailleurs' } })).json();
    expect((await c.inject({ url: `/api/projects/${created.id}/thumbnail.png?ws=${other.id}` })).statusCode).toBe(404);
  });

  it('creates a project from a template', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json().version).toBe(1);
    expect(r.json().warnings).toEqual([]);
  });

  it('rejects an invalid project with readable issues', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/projects', payload: { project: { schemaVersion: 1, title: '', scenes: [] } } });
    expect(r.statusCode).toBe(422);
    expect(r.json().issues.length).toBeGreaterThan(0);
  });

  it('saves a new version and refuses a stale one', async () => {
    const project = { ...structuredClone(exampleProject), title: 'Renommé' };
    const ok = await c.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { project, baseVersion: 1 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ version: 2, title: 'Renommé' });
    const stale = await c.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { project, baseVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.version).toBe(2);
    const versions = await c.inject({ url: `/api/projects/${id}/versions` });
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('lists, reads, exports subtitles and deletes', async () => {
    expect((await c.inject({ url: '/api/projects' })).json()[0]).toMatchObject({ id, title: 'Renommé' });
    expect((await c.inject({ url: '/api/projects' })).json()[0].scenes).toHaveLength(2); // each scene's length: the card's timeline
    expect((await c.inject({ url: `/api/projects/${id}` })).json().project.scenes.length).toBe(2);
    const srt = await c.inject({ url: `/api/projects/${id}/subtitles.srt` });
    expect(srt.headers['content-type']).toContain('application/x-subrip');
    expect(srt.body).toContain('Voici Awa.');
    expect((await c.inject({ method: 'DELETE', url: `/api/projects/${id}` })).statusCode).toBe(204);
    expect((await c.inject({ url: `/api/projects/${id}` })).statusCode).toBe(404);
    expect((await c.inject({ url: '/api/projects/not-a-uuid' })).statusCode).toBe(404);
  });

  it('describes the library and the format', async () => {
    const lib = (await c.inject({ url: '/api/library' })).json();
    expect(lib.styles.map((s: { id: string }) => s.id)).toEqual(['flat', 'watercolor', 'papercut', 'sketch', 'comic', 'neon']);
    expect(lib.catalog.characters.map((c: { kind: string }) => c.kind)).toContain('person');
    expect((await c.inject({ url: '/api/schema' })).json().type).toBe('object');
  });
});

describe('credentials', () => {
  let id = '';
  it('stores a key sealed and only ever returns a hint', async () => {
    const r = await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'anthropic', label: 'perso', apiKey: KEY } });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json().hint).toBe('…1234');
    expect(r.body).not.toContain('SUPERSECRET');
    const list = await c.inject({ url: '/api/credentials' });
    expect(list.body).not.toContain('SUPERSECRET');
    expect(list.json()[0]).not.toHaveProperty('secret');
    const { rows } = await db.query<{ secret: string }>('SELECT secret FROM credentials WHERE id = $1', [id]);
    expect(rows[0]!.secret.startsWith('v1.')).toBe(true);
    expect(rows[0]!.secret).not.toContain('SUPERSECRET');
  });

  it('validates the provider, the key and the server address', async () => {
    expect((await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'nope', label: 'x', apiKey: 'k' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'x' } })).json().error).toBe('clé manquante');
    expect((await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'x' } })).json().error).toBe('adresse du serveur manquante');
    expect((await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'x', baseUrl: 'file:///etc/passwd' } })).statusCode).toBe(400);
    const local = await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'ollama', baseUrl: 'http://localhost:11434/v1' } });
    expect(local.statusCode).toBe(201);
    expect(local.json().hint).toBe('');
  });

  it('tests a key with the decrypted secret and records the result', async () => {
    const r = await c.inject({ method: 'POST', url: `/api/credentials/${id}/test` });
    expect(r.json()).toEqual({ ok: true, models: [{ id: 'claude-test', label: 'Claude Test' }] });
    expect(fetchImpl.mock.calls.at(-1)![1]!.headers).toMatchObject({ 'x-api-key': KEY });
    expect((await c.inject({ url: '/api/credentials' })).json().find((c: { id: string }) => c.id === id).lastTestOk).toBe(true);
  });

  it('replaces a key and resets its test status', async () => {
    const r = await c.inject({ method: 'PATCH', url: `/api/credentials/${id}`, payload: { apiKey: 'sk-ant-api03-OTHER-zzzz9999' } });
    expect(r.json()).toMatchObject({ hint: '…9999', lastTestOk: null, label: 'perso' });
  });

  it('assigns a model per task, checking the provider can do it', async () => {
    const tts = await c.inject({ method: 'PUT', url: '/api/assignments/narration', payload: { credentialId: id, model: 'x' } });
    expect(tts.statusCode).toBe(400);
    const ok = await c.inject({ method: 'PUT', url: '/api/assignments/storyboard', payload: { credentialId: id, model: 'claude-test' } });
    expect(ok.statusCode).toBe(200);
    const all = (await c.inject({ url: '/api/assignments' })).json();
    expect(all).toContainEqual({ task: 'storyboard', credentialId: id, model: 'claude-test', voice: '' });
    expect(all).toContainEqual({ task: 'narration', credentialId: null, model: '', voice: '' });
  });

  it('deleting a key clears the tasks that used it', async () => {
    expect((await c.inject({ method: 'DELETE', url: `/api/credentials/${id}` })).statusCode).toBe(204);
    expect((await c.inject({ url: '/api/assignments' })).json()).toContainEqual({ task: 'storyboard', credentialId: null, model: 'claude-test', voice: '' });
  });
});
