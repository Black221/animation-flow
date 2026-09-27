import { exampleProject } from '@af/schema';
import type { FetchLike } from '@af/providers';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseKey } from '../src/config';
import { secretBox } from '../src/crypto';
import { migrate, openDb, type Db } from '../src/db';
import { buildServer } from '../src/server';

const KEY = 'sk-ant-api03-SUPERSECRET-abcd1234';
let db: Db, app: FastifyInstance;
const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] }) }));

// By default the tests use an in-memory PGlite. Set TEST_DATABASE_URL to run them against a real PostgreSQL:
// that database is WIPED first, so point it at a throwaway one.
const TEST_URL = process.env.TEST_DATABASE_URL ?? null;

beforeAll(async () => {
  db = await openDb({ url: TEST_URL, memory: true });
  if (TEST_URL) await db.query('DROP TABLE IF EXISTS model_assignments, credentials, project_versions, projects, _migrations CASCADE');
  await migrate(db);
  app = await buildServer({ db, box: secretBox(randomBytes(32)), fetchImpl });
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
  it('creates a project from a template', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json().version).toBe(1);
    expect(r.json().warnings).toEqual([]);
  });

  it('rejects an invalid project with readable issues', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/projects', payload: { project: { schemaVersion: 1, title: '', scenes: [] } } });
    expect(r.statusCode).toBe(422);
    expect(r.json().issues.length).toBeGreaterThan(0);
  });

  it('saves a new version and refuses a stale one', async () => {
    const project = { ...structuredClone(exampleProject), title: 'Renommé' };
    const ok = await app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { project, baseVersion: 1 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ version: 2, title: 'Renommé' });
    const stale = await app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { project, baseVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.version).toBe(2);
    const versions = await app.inject({ url: `/api/projects/${id}/versions` });
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('lists, reads, exports subtitles and deletes', async () => {
    expect((await app.inject({ url: '/api/projects' })).json()[0]).toMatchObject({ id, title: 'Renommé' });
    expect((await app.inject({ url: `/api/projects/${id}` })).json().project.scenes.length).toBe(2);
    const srt = await app.inject({ url: `/api/projects/${id}/subtitles.srt` });
    expect(srt.headers['content-type']).toContain('application/x-subrip');
    expect(srt.body).toContain('Voici Awa.');
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/projects/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/projects/not-a-uuid' })).statusCode).toBe(404);
  });

  it('describes the library and the format', async () => {
    const lib = (await app.inject({ url: '/api/library' })).json();
    expect(lib.styles.map((s: { id: string }) => s.id)).toEqual(['flat', 'watercolor']);
    expect(lib.catalog.characters.map((c: { kind: string }) => c.kind)).toContain('person');
    expect((await app.inject({ url: '/api/schema' })).json().type).toBe('object');
  });
});

describe('credentials', () => {
  let id = '';
  it('stores a key sealed and only ever returns a hint', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'anthropic', label: 'perso', apiKey: KEY } });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json().hint).toBe('…1234');
    expect(r.body).not.toContain('SUPERSECRET');
    const list = await app.inject({ url: '/api/credentials' });
    expect(list.body).not.toContain('SUPERSECRET');
    expect(list.json()[0]).not.toHaveProperty('secret');
    const { rows } = await db.query<{ secret: string }>('SELECT secret FROM credentials WHERE id = $1', [id]);
    expect(rows[0]!.secret.startsWith('v1.')).toBe(true);
    expect(rows[0]!.secret).not.toContain('SUPERSECRET');
  });

  it('validates the provider, the key and the server address', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'nope', label: 'x', apiKey: 'k' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'x' } })).json().error).toBe('clé manquante');
    expect((await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'x' } })).json().error).toBe('adresse du serveur manquante');
    expect((await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'x', baseUrl: 'file:///etc/passwd' } })).statusCode).toBe(400);
    const local = await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'ollama', baseUrl: 'http://localhost:11434/v1' } });
    expect(local.statusCode).toBe(201);
    expect(local.json().hint).toBe('');
  });

  it('tests a key with the decrypted secret and records the result', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/credentials/${id}/test` });
    expect(r.json()).toEqual({ ok: true, models: [{ id: 'claude-test', label: 'Claude Test' }] });
    expect(fetchImpl.mock.calls.at(-1)![1]!.headers).toMatchObject({ 'x-api-key': KEY });
    expect((await app.inject({ url: '/api/credentials' })).json().find((c: { id: string }) => c.id === id).lastTestOk).toBe(true);
  });

  it('replaces a key and resets its test status', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/api/credentials/${id}`, payload: { apiKey: 'sk-ant-api03-OTHER-zzzz9999' } });
    expect(r.json()).toMatchObject({ hint: '…9999', lastTestOk: null, label: 'perso' });
  });

  it('assigns a model per task, checking the provider can do it', async () => {
    const tts = await app.inject({ method: 'PUT', url: '/api/assignments/narration', payload: { credentialId: id, model: 'x' } });
    expect(tts.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: '/api/assignments/storyboard', payload: { credentialId: id, model: 'claude-test' } });
    expect(ok.statusCode).toBe(200);
    const all = (await app.inject({ url: '/api/assignments' })).json();
    expect(all).toContainEqual({ task: 'storyboard', credentialId: id, model: 'claude-test' });
    expect(all).toContainEqual({ task: 'narration', credentialId: null, model: '' });
  });

  it('deleting a key clears the tasks that used it', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/credentials/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/assignments' })).json()).toContainEqual({ task: 'storyboard', credentialId: null, model: 'claude-test' });
  });
});

describe('access token', () => {
  it('guards the API when set, but not the health check', async () => {
    const guarded = await buildServer({ db, box: secretBox(randomBytes(32)), accessToken: 'team-token' });
    expect((await guarded.inject({ url: '/api/projects' })).statusCode).toBe(401);
    expect((await guarded.inject({ url: '/api/projects', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    expect((await guarded.inject({ url: '/api/projects', headers: { authorization: 'Bearer team-token' } })).statusCode).toBe(200);
    expect((await guarded.inject({ url: '/api/health' })).json()).toEqual({ ok: true, auth: true });
    await guarded.close();
  });
});
