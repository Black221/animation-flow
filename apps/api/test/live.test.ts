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
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { LiveHub, type LiveClient } from '../src/live/hub';
import { signUp, type Client } from './client';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, base = '', owner: Client, ed: Client, vi: Client, pid = '';

/** a WebSocket client that records what it receives and can wait for a message type */
function connect(c: Client | null, o: { origin?: string; ws?: string; project?: string } = {}) {
  const url = `${base.replace('http', 'ws')}/api/projects/${o.project ?? pid}/live?ws=${o.ws ?? c?.workspaces[0]?.id ?? ''}`;
  const sock = new WebSocket(url, { headers: { ...(c ? { cookie: c.cookie } : {}), origin: o.origin ?? base } });
  const got: any[] = [];
  const waiters: { type: string; ok: (m: any) => void }[] = [];
  sock.on('message', (d) => { const m = JSON.parse(String(d)); got.push(m); for (const w of waiters.splice(0)) { if (w.type === m.type) w.ok(m); else waiters.push(w); } });
  const next = (type: string, ms = 3000) => new Promise<any>((ok, bad) => {
    const found = got.findIndex((m) => m.type === type);
    if (found >= 0) return ok(got.splice(found, 1)[0]);
    const t = setTimeout(() => bad(new Error(`no ${type}`)), ms);
    waiters.push({ type, ok: (m) => { clearTimeout(t); got.splice(got.indexOf(m), 1); ok(m); } });
  });
  const send = (m: unknown) => sock.send(JSON.stringify(m));
  const closed = new Promise<{ code: number; reason: string }>((ok) => sock.on('close', (code, reason) => ok({ code, reason: String(reason) })));
  const status = new Promise<number>((ok) => sock.on('unexpected-response', (_req, res) => ok(res.statusCode ?? 0)));
  const open = new Promise<void>((ok) => sock.on('open', () => ok()));
  return { sock, got, next, send, closed, status, open, close: () => sock.close() };
}
const opsOf = (o: Op[]) => ({ type: 'ops', opId: randomBytes(4).toString('hex'), ops: o });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), liveSaveDelay: 60 });
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

describe('live co-editing', () => {
  it('shares changes, acknowledges them, and shows who is there', async () => {
    const a = connect(owner), b = connect(ed);
    const ha = await a.next('hello'), hb = await b.next('hello');
    expect(ha).toMatchObject({ seq: 0, version: 1, canEdit: true, you: { name: 'Olga' } });
    expect(hb.project.title).toBe(ha.project.title);
    expect((await a.next('presence')).peers.map((p: { name: string }) => p.name).sort()).toEqual(['Ed', 'Olga']);

    a.send(opsOf([{ op: 'set', path: ['title'], value: 'Titre en direct' }]));
    expect(await a.next('ack')).toMatchObject({ seq: 1 });
    expect(await b.next('ops')).toMatchObject({ seq: 1, by: { name: 'Olga' }, ops: [{ path: ['title'], value: 'Titre en direct' }] });

    b.send({ type: 'presence', sceneId: 's2', tab: 'scene' });
    const p = await a.next('presence');
    expect(p.peers.find((x: { name: string }) => x.name === 'Ed')).toMatchObject({ sceneId: 's2', tab: 'scene' });
    a.close(); b.close(); await Promise.all([a.closed, b.closed]);
  });

  it('merges edits of different fields and refuses those that no longer apply or would break the project', async () => {
    const a = connect(owner), b = connect(ed);
    await a.next('hello'); await b.next('hello');
    a.send(opsOf([{ op: 'set', path: ['scenes', 0, 'title'], value: 'Scène 1 par Olga' }]));
    b.send(opsOf([{ op: 'set', path: ['scenes', 1, 'title'], value: 'Scène 2 par Ed' }]));
    await a.next('ack'); await b.next('ack');
    // Olga removes scene 2 while Ed is still editing it
    const hello = (await connect(owner).next('hello')).project;
    a.send(opsOf([{ op: 'set', path: ['scenes'], value: [hello.scenes[0]] }]));
    await a.next('ack');
    b.send(opsOf([{ op: 'set', path: ['scenes', 1, 'title'], value: 'trop tard' }]));
    expect((await b.next('nack')).error).toContain('supprimé');
    b.send(opsOf([{ op: 'set', path: ['scenes', 0, 'decor', 'kind'], value: 42 }]));
    expect((await b.next('nack')).error).toContain('invalide');
    const now = (await connect(vi).next('hello')).project;
    expect(now.scenes.map((s: { title: string }) => s.title)).toEqual(['Scène 1 par Olga']);
    a.close(); b.close();
  });

  it('lets viewers watch but not edit', async () => {
    const v = connect(vi), a = connect(owner);
    expect((await v.next('hello')).canEdit).toBe(false);
    await a.next('hello');
    v.send(opsOf([{ op: 'set', path: ['title'], value: 'pirate' }]));
    expect((await v.next('nack')).error).toContain('lecture seule');
    a.send(opsOf([{ op: 'set', path: ['title'], value: 'Vu par Vi' }]));
    expect((await v.next('ops')).ops[0].value).toBe('Vu par Vi');
    v.close(); a.close();
  });

  it('saves by itself, one version per sitting and author', async () => {
    const a = connect(owner);
    await a.next('hello');
    a.send(opsOf([{ op: 'set', path: ['title'], value: 'Sauvé 1' }]));
    const s1 = await a.next('saved');
    a.send(opsOf([{ op: 'set', path: ['title'], value: 'Sauvé 2' }]));
    const s2 = await a.next('saved');
    expect(s1.version).toBeGreaterThan(1); // the creation is never overwritten
    expect(s2.version).toBe(s1.version); // same sitting, same author: the version is updated
    const b = connect(ed); await b.next('hello');
    b.send(opsOf([{ op: 'set', path: ['title'], value: 'Sauvé par Ed' }]));
    const s3 = await b.next('saved');
    expect(s3).toMatchObject({ version: s1.version + 1, by: 'Ed' });
    // an explicit save closes the version: the next change makes a new one
    b.send({ type: 'save' });
    expect((await b.next('saved')).version).toBe(s3.version);
    b.send(opsOf([{ op: 'set', path: ['title'], value: 'Sauvé par Ed, encore' }]));
    const s4 = await b.next('saved');
    expect(s4.version).toBe(s3.version + 1);
    const rest = (await owner.inject(`/api/projects/${pid}`)).json();
    expect(rest).toMatchObject({ title: 'Sauvé par Ed, encore', version: s4.version, updatedBy: 'Ed' });
    a.close(); b.close(); await sleep(50);
  });

  it('restarts everyone from a save made through the API', async () => {
    const a = connect(owner); const h = await a.next('hello');
    const cur = (await ed.inject(`/api/projects/${pid}`)).json();
    const put = await ed.inject({ method: 'PUT', url: `/api/projects/${pid}`, payload: { project: { ...cur.project, title: 'Par l’API' }, baseVersion: cur.version } });
    expect(put.statusCode).toBe(200);
    const r = await a.next('reset');
    expect(r).toMatchObject({ project: { title: 'Par l’API' }, reason: 'enregistré par Ed' });
    expect(r.seq).toBeGreaterThan(h.seq);
    a.close();
  });

  it('keeps two editors in step, even when one inserts a scene while the other edits one', async () => {
    const join = async (c: Client) => {
      const s = connect(c), doc = new LiveDoc((m) => s.send(m), () => undefined);
      s.sock.on('message', (d) => doc.receive(JSON.parse(String(d))));
      await s.next('hello');
      return { s, doc };
    };
    const a = await join(owner), b = await join(ed);
    const pa = structuredClone(a.doc.project!) as Project, pb = structuredClone(b.doc.project!) as Project;
    pa.scenes.unshift({ ...structuredClone(pa.scenes[0]!), id: 'intro', title: 'Intro' });
    pb.scenes[0]!.title = 'Édité par Ed';
    a.doc.edit(pa); b.doc.edit(pb); a.doc.flush(); b.doc.flush();
    for (let k = 0; k < 100 && (a.doc.unconfirmed || b.doc.unconfirmed || JSON.stringify(a.doc.project) !== JSON.stringify(b.doc.project)); k++) await sleep(20);
    expect(a.doc.project).toEqual(b.doc.project);
    expect(a.doc.project!.scenes.slice(0, 2).map((x) => [x.id, x.title])).toEqual([['intro', 'Intro'], [pb.scenes[0]!.id, 'Édité par Ed']]);
    b.s.send(opsOf([{ op: 'set', path: ['__proto__', 'x'], value: 1 }] as Op[]));
    expect((await b.s.next('nack')).error).toBe('modification illisible');
    a.s.close(); b.s.close(); await sleep(50);
  });

  it('keeps the room of someone who joins while the last one leaving is being saved', async () => {
    const hub = new LiveHub(db, 10_000), ws = owner.workspaces[0]!.id;
    const fake = (n: string): LiveClient => ({ id: n, user: { id: owner.user.id, name: n }, canEdit: true, presence: { userId: owner.user.id, name: n, color: '#000', sceneId: null, tab: null }, send: () => undefined, close: () => undefined });
    const room = (await hub.open(pid, ws))!;
    const first = fake('a'); room.join(first);
    room.handle(first, opsOf([{ op: 'set', path: ['title'], value: 'Pendant la sauvegarde' }]) as never);
    const leaving = room.leave(first); // saves, which takes a moment
    const again = (await hub.open(pid, ws))!;
    again.join(fake('b'));
    await leaving;
    expect(again).toBe(room);
    expect(await hub.get(pid)).toBe(room);
  });

  it('closes the connections of someone whose role changed, and of a deleted project', async () => {
    const e = connect(ed); expect((await e.next('hello')).canEdit).toBe(true);
    expect((await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${ed.user.id}`, payload: { role: 'viewer' } })).statusCode).toBe(200);
    expect((await e.closed).code).toBe(4001);
    const again = connect(ed); expect((await again.next('hello')).canEdit).toBe(false);
    again.close();
    await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${ed.user.id}`, payload: { role: 'editor' } });
    const other = (await owner.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json().id;
    const o = connect(owner, { project: other }); await o.next('hello');
    expect((await owner.inject({ method: 'DELETE', url: `/api/projects/${other}` })).statusCode).toBe(204);
    expect((await o.closed).code).toBe(4404);
  });

  it('refuses another origin, another workspace and no session', async () => {
    expect((await connect(owner, { origin: 'https://evil.example' }).closed).code).toBe(4403);
    const stranger = await signUp(app, 'stranger@example.org').catch(() => null); // invite-only: refused
    expect(stranger).toBeNull();
    const d2 = await owner.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Autre' } });
    expect((await connect(owner, { ws: d2.json().id }).closed).code).toBe(4404);
    expect(await connect(null).status).toBe(401);
  });
});
