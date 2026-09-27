import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { signUp, type Client } from './client';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, owner: Client, ed: Client, vi: Client, pid = '', base = '';

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  owner = await signUp(app, 'owner@example.org', { name: 'Olga' });
  for (const [email, name, role] of [['ed@example.org', 'Ed', 'editor'], ['vi@example.org', 'Vi', 'viewer']] as const) {
    const inv = (await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role } })).json();
    const c = await signUp(app, email, { name, invitation: inv.path.split('/').pop() });
    if (name === 'Ed') ed = c; else vi = c;
  }
  pid = (await owner.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json().id;
});
afterAll(async () => { await app.close(); await db.close(); });

const post = (c: Client, payload: object, project = pid) => c.inject({ method: 'POST', url: `/api/projects/${project}/comments`, payload });

describe('comments', () => {
  it('pins a thread to a scene, an element and a moment; replies share its place', async () => {
    const r = await post(vi, { sceneId: 's1', elementId: 'awa', t: 3.5, body: '  Awa arrive trop tôt  ' });
    expect(r.statusCode).toBe(201); // viewers comment too
    const thread = r.json();
    expect(thread).toMatchObject({ sceneId: 's1', elementId: 'awa', t: 3.5, body: 'Awa arrive trop tôt', parentId: null, author: { name: 'Vi' }, resolvedAt: null });
    const reply = (await post(ed, { parentId: thread.id, sceneId: 's2', body: 'Je la décale.' })).json();
    expect(reply).toMatchObject({ parentId: thread.id, sceneId: 's1', elementId: 'awa', t: 3.5, author: { name: 'Ed' } });
    expect((await post(owner, { parentId: reply.id, body: 'non' })).json().error).toContain('fil');
    expect((await post(owner, { body: 'où ?' })).json().error).toBe('scène manquante');
    expect((await post(owner, { sceneId: 's1', body: '   ' })).statusCode).toBe(400);
    const list = (await vi.inject(`/api/projects/${pid}/comments`)).json();
    expect(list.map((c: { body: string }) => c.body)).toEqual(['Awa arrive trop tôt', 'Je la décale.']);
  });

  it('lets editors and the author resolve, the author edit, the author or an admin delete', async () => {
    const mine = (await post(vi, { sceneId: 's2', body: 'Trop sombre' })).json();
    const edits = (b: object, c: Client, id = mine.id) => c.inject({ method: 'PATCH', url: `/api/comments/${id}`, payload: b });
    expect((await edits({ body: 'Trop sombre ?' }, ed)).statusCode).toBe(403);
    expect((await edits({ body: 'Trop sombre ?' }, vi)).json()).toMatchObject({ body: 'Trop sombre ?', editedAt: expect.any(String) });
    expect((await edits({ resolved: true }, ed)).json()).toMatchObject({ resolvedBy: 'Ed', resolvedAt: expect.any(String) });
    expect((await edits({ resolved: false }, vi)).json()).toMatchObject({ resolvedBy: null, resolvedAt: null });
    const others = (await post(ed, { sceneId: 's2', body: 'Par Ed' })).json();
    expect((await edits({ resolved: true }, vi, others.id)).statusCode).toBe(403); // a viewer resolves only their own
    expect((await vi.inject({ method: 'DELETE', url: `/api/comments/${others.id}` })).statusCode).toBe(403);
    expect((await owner.inject({ method: 'DELETE', url: `/api/comments/${others.id}` })).statusCode).toBe(204);
    expect((await vi.inject({ method: 'DELETE', url: `/api/comments/${mine.id}` })).statusCode).toBe(204);
  });

  it('keeps comments within their workspace', async () => {
    const d2 = (await owner.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Autre' } })).json().id;
    const c = (await post(owner, { sceneId: 's1', body: 'privé' })).json();
    owner.ws = d2;
    expect((await owner.inject(`/api/projects/${pid}/comments`)).statusCode).toBe(404);
    expect((await owner.inject({ method: 'PATCH', url: `/api/comments/${c.id}`, payload: { resolved: true } })).statusCode).toBe(404);
    owner.ws = null;
    expect((await ed.inject({ method: 'POST', url: `/api/projects/${pid}/comments`, payload: { sceneId: 's1', body: 'x' }, headers: { 'x-requested-with': '' } })).statusCode).toBe(403);
  });

  it('tells the people in the project as it happens', async () => {
    const sock = new WebSocket(`${base.replace('http', 'ws')}/api/projects/${pid}/live?ws=${vi.workspaces[0]!.id}`, { headers: { cookie: vi.cookie, origin: base } });
    const events: any[] = [];
    const hello = new Promise<void>((ok) => sock.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'hello') ok(); if (m.type === 'event') events.push(m); }));
    await hello;
    const c = (await post(ed, { sceneId: 's1', body: 'En direct' })).json();
    await ed.inject({ method: 'DELETE', url: `/api/comments/${c.id}` });
    for (let k = 0; k < 50 && events.length < 2; k++) await new Promise((r) => setTimeout(r, 20));
    expect(events).toMatchObject([{ name: 'comments', data: { kind: 'upsert', comment: { body: 'En direct' } } }, { name: 'comments', data: { kind: 'delete', id: c.id } }]);
    sock.close();
  });
});
