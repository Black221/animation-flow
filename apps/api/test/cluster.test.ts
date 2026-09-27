// Two API processes on one database (here two servers in one test process, each with its own live hub, talking
// only through the database: NOTIFY and the change log). People on either one edit the same project together.
import { LiveDoc, type Op, type Project } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { secretBox } from '../src/crypto';
import { migrate, openDb, type Db } from '../src/db';
import { LiveHub, type LiveClient } from '../src/live/hub';
import { buildServer } from '../src/server';
import { signUp, type Client } from './client';
import { openTestDb } from './testdb';

let db: Db, A: FastifyInstance, B: FastifyInstance, urlA = '', urlB = '', owner: Client, ed: Client, pid = '';
const box = secretBox(randomBytes(32));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { for (let t = 0; t < ms && !f(); t += 20) await sleep(20); expect(f()).toBe(true); };

function connect(base: string, c: Client, project = pid) {
  const sock = new WebSocket(`${base.replace('http', 'ws')}/api/projects/${project}/live?ws=${c.workspaces[0]!.id}`, { headers: { cookie: c.cookie, origin: base } });
  const got: any[] = [];
  const doc = new LiveDoc((m) => sock.send(JSON.stringify(m)), () => undefined);
  sock.on('message', (d) => { const m = JSON.parse(String(d)); got.push(m); doc.receive(m); });
  const closed = new Promise<number>((ok) => sock.on('close', (code) => ok(code)));
  const last = (type: string) => [...got].reverse().find((m) => m.type === type);
  const edit = (f: (p: Project) => void) => { const p = structuredClone(doc.project!); f(p); doc.edit(p); doc.flush(); };
  return { sock, got, doc, closed, last, edit, send: (m: unknown) => sock.send(JSON.stringify(m)), close: () => sock.close() };
}
const server = async (saveDelay: number) => {
  const app = await buildServer({ db, box, voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), liveSaveDelay: saveDelay });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
};

beforeAll(async () => {
  db = await openTestDb();
  const a = await server(80), b = await server(80);
  A = a.app; urlA = a.url; B = b.app; urlB = b.url;
  owner = await signUp(A, 'owner@example.org', { name: 'Olga' });
  const inv = (await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor' } })).json();
  ed = await signUp(B, 'ed@example.org', { name: 'Ed', invitation: inv.path.split('/').pop() });
  pid = (await owner.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json().id;
});
afterAll(async () => { await A.close(); await B.close(); await db.close(); });

describe('live editing across API processes', () => {
  it('shares changes and presence between people on different processes, and converges', async () => {
    const olga = connect(urlA, owner), eddy = connect(urlB, ed);
    await until(() => !!olga.doc.project && !!eddy.doc.project);
    await until(() => olga.last('presence')?.peers.some((p: { name: string }) => p.name === 'Ed') && eddy.last('presence')?.peers.some((p: { name: string }) => p.name === 'Olga'));

    // at the same moment: Olga inserts a scene, Ed retitles the first one and the project
    olga.edit((p) => { p.scenes.unshift({ ...structuredClone(p.scenes[0]!), id: 'intro', title: 'Intro' }); });
    eddy.edit((p) => { p.scenes[0]!.title = 'Titre par Ed'; p.title = 'Projet à deux'; });
    await until(() => !olga.doc.unconfirmed && !eddy.doc.unconfirmed && JSON.stringify(olga.doc.project) === JSON.stringify(eddy.doc.project));
    expect(olga.doc.project!.scenes.slice(0, 2).map((s) => [s.id, s.title])).toEqual([['intro', 'Intro'], ['s1', 'Titre par Ed']]);
    expect(olga.doc.project!.title).toBe('Projet à deux');

    // Olga removes scene s2 on A; Ed, on B, still edits it: refused
    olga.edit((p) => { p.scenes = p.scenes.filter((s) => s.id !== 's2'); });
    await until(() => !olga.doc.unconfirmed);
    await until(() => !eddy.doc.project!.scenes.some((s) => s.id === 's2'));
    eddy.send({ type: 'ops', opId: 'late', ops: [{ op: 'set', path: ['scenes', { id: 's2' }, 'title'], value: 'trop tard' }] as Op[] });
    await until(() => eddy.got.some((m) => m.type === 'nack' && m.opId === 'late'));

    // saved by itself, once, with everything
    await until(() => !!olga.last('saved') && !!eddy.last('saved'));
    const rest = (await ed.inject({ url: `/api/projects/${pid}` })).json();
    expect(rest.project).toEqual(olga.doc.project);
    olga.close(); eddy.close(); await Promise.all([olga.closed, eddy.closed]); await sleep(150);
  });

  it('restarts everyone, on every process, from a save made through the API', async () => {
    const eddy = connect(urlB, ed);
    await until(() => !!eddy.doc.project);
    const cur = (await owner.inject(`/api/projects/${pid}`)).json();
    const put = await owner.inject({ method: 'PUT', url: `/api/projects/${pid}`, payload: { project: { ...cur.project, title: 'Par l’API sur A' }, baseVersion: cur.version } });
    expect(put.statusCode).toBe(200);
    await until(() => eddy.last('reset')?.project.title === 'Par l’API sur A');
    expect(eddy.last('reset')).toMatchObject({ version: put.json().version, reason: 'enregistré par Olga' });
    // a live change not yet saved turns into a version before an API save is compared: the stale save gets 409
    eddy.edit((p) => { p.title = 'Changé en direct'; });
    await until(() => !eddy.doc.unconfirmed);
    const stale = await owner.inject({ method: 'PUT', url: `/api/projects/${pid}`, payload: { project: { ...cur.project, title: 'Écrase ?' }, baseVersion: put.json().version } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.project.title).toBe('Changé en direct');
    eddy.close(); await eddy.closed; await sleep(150);
  });

  it('carries comments and closed connections across processes', async () => {
    const olga = connect(urlA, owner), eddy = connect(urlB, ed);
    await until(() => !!olga.doc.project && !!eddy.doc.project);
    const c = (await ed.inject({ method: 'POST', url: `/api/projects/${pid}/comments`, payload: { sceneId: 's1', body: 'posté sur B' } })).json();
    await until(() => olga.got.some((m) => m.type === 'event' && m.data.comment?.id === c.id));
    // a long comment is too big for a notification: the others are told to reload
    await ed.inject({ method: 'POST', url: `/api/projects/${pid}/comments`, payload: { sceneId: 's1', body: 'é'.repeat(3999) } });
    await until(() => olga.got.some((m) => m.type === 'event' && m.data.kind === 'reload'));
    // Olga, on A, makes Ed a viewer: Ed's connection on B closes
    expect((await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${ed.user.id}`, payload: { role: 'viewer' } })).statusCode).toBe(200);
    expect(await eddy.closed).toBe(4001);
    await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${ed.user.id}`, payload: { role: 'editor' } });
    olga.close(); await olga.closed; await sleep(150);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)('keeps up when the connection that listens to the others drops (PostgreSQL)', async () => {
    const olga = connect(urlA, owner), eddy = connect(urlB, ed);
    await until(() => !!olga.doc.project && !!eddy.doc.project);
    // cut every listening connection: notifications are lost until they reconnect
    await db.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN%' AND pid <> pg_backend_pid()`);
    olga.edit((p) => { p.title = 'Pendant la coupure'; });
    await until(() => eddy.doc.project?.title === 'Pendant la coupure', 8000); // the room checks the log by itself
    // and notifications come back once the listeners have reconnected
    await sleep(3000); // listeners reconnect after 1 s
    olga.edit((p) => { p.title = 'Après la coupure'; });
    const t0 = Date.now();
    await until(() => eddy.doc.project?.title === 'Après la coupure', 8000);
    expect(Date.now() - t0).toBeLessThan(1000); // by notification, not by the periodic check
    olga.close(); eddy.close(); await Promise.all([olga.closed, eddy.closed]); await sleep(150);
  }, 20_000);

  it.skipIf(!process.env.TEST_DATABASE_URL)('migrates once when several processes start together (PostgreSQL)', async () => {
    const url = process.env.TEST_DATABASE_URL!.replace(/\/[^/]*$/, '/af_migrate');
    const admin = await openDb({ url: process.env.TEST_DATABASE_URL! });
    await admin.query('DROP DATABASE IF EXISTS af_migrate'); await admin.query('CREATE DATABASE af_migrate'); await admin.close();
    const dbs = await Promise.all([1, 2, 3].map(() => openDb({ url })));
    const applied = await Promise.all(dbs.map((d) => migrate(d)));
    expect(applied.reduce((a, b) => a + b, 0)).toBe((await dbs[0]!.query<{ n: number }>('SELECT count(*)::int AS n FROM _migrations')).rows[0]!.n);
    expect(applied.filter((n) => n > 0)).toHaveLength(1);
    await Promise.all(dbs.map((d) => d.close()));
  });

  it('saves what a stopped process left unsaved, the next time the project is opened', async () => {
    // a process that takes a change and stops before saving (its save delay never comes)
    const doomed = new LiveHub(db, 3_600_000), ws = owner.workspaces[0]!.id;
    const room = (await doomed.open(pid, ws))!;
    const fake: LiveClient = { id: 'x', user: { id: owner.user.id, name: 'Olga' }, canEdit: true, presence: { userId: owner.user.id, name: 'Olga', color: '#000', sceneId: null, tab: null }, send: () => undefined, close: () => undefined };
    await room.join(fake);
    room.handle(fake, { type: 'ops', opId: '1', ops: [{ op: 'set', path: ['title'], value: 'Resté dans le journal' }] });
    await until(() => room.seq > 0 && room.project.title === 'Resté dans le journal');
    // the database has it in the log, not in the project yet
    expect((await owner.inject(`/api/projects/${pid}`)).json().project.title).not.toBe('Resté dans le journal');
    const olga = connect(urlA, owner);
    await until(() => olga.doc.project?.title === 'Resté dans le journal'); // opened from the log
    await until(() => (olga.last('saved')?.version ?? 0) > 0);
    expect((await owner.inject(`/api/projects/${pid}`)).json().project.title).toBe('Resté dans le journal');
    olga.close(); await olga.closed;
  });
});
