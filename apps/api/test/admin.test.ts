// The back office, a server of its own: platform admins only (one answer for a wrong password and for no access),
// its own sessions (the app's cookie opens nothing there, and the reverse), its own CSRF header, rights taken away
// end its sessions; every write is in the audit log; it lists workspaces, subscriptions, films; it can be kept to
// some addresses; nothing of it is framed or cached.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAdminServer, ipAllowed } from '../src/admin/server';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { adminSignIn, signUp, type Client } from './client';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, adm: FastifyInstance, root: Client, eve: Client, boss: Client;
const dir = () => mkdtempSync(join(tmpdir(), 'af-adm-'));
const login = (email: string, password = 'mot-de-passe-solide-1', headers: Record<string, string> = { 'x-requested-with': 'animation-flow-admin' }) =>
  adm.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: dir(), signup: 'open', adminUrl: 'https://admin.example.org' });
  root = await signUp(app, 'root@example.org', { name: 'Root' });
  eve = await signUp(app, 'eve@example.org', { name: 'Eve' });
  adm = await buildAdminServer({ db, voicesDir: dir(), imagesDir: dir(), communityDir: dir(), stripe: null });
  boss = await adminSignIn(adm, 'root@example.org');
});
afterAll(async () => { await adm.close(); await app.close(); await db.close(); });

describe('back office: who gets in', () => {
  it('lets platform admins in, with one answer for a wrong password and for an account without access', async () => {
    const wrong = await login('root@example.org', 'pas-le-bon-mot-de-passe'), none = await login('eve@example.org');
    expect(wrong.statusCode).toBe(401);
    expect(none.statusCode).toBe(401);
    expect(none.json().error).toBe(wrong.json().error);
    const ok = await login('root@example.org');
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/^af_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=43200/); // 12 hours
  });

  it('keeps its sessions apart from the app’s: neither cookie opens the other', async () => {
    expect((await adm.inject({ url: '/api/admin/overview', headers: { cookie: root.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/projects', headers: { cookie: boss.cookie.replace('af_admin=', 'af_session=') } })).statusCode).toBe(401);
    expect((await boss.inject('/api/admin/overview')).statusCode).toBe(200);
    // and the app has no administration of its own any more; it gives its admins the back office's address
    expect((await root.inject('/api/admin/users')).statusCode).toBe(404);
    expect((await root.inject('/api/auth/me')).json().adminUrl).toBe('https://admin.example.org');
    expect((await eve.inject('/api/auth/me')).json().adminUrl).toBeUndefined();
  });

  it('wants its own CSRF header on every write', async () => {
    expect((await login('root@example.org', 'mot-de-passe-solide-1', { 'x-requested-with': 'animation-flow' })).statusCode).toBe(403);
    expect((await adm.inject({ method: 'PATCH', url: `/api/admin/users/${eve.user.id}`, headers: { cookie: boss.cookie }, payload: { admin: true } })).statusCode).toBe(403);
  });

  it('ends a back-office session when the rights are taken away', async () => {
    await boss.inject({ method: 'PATCH', url: `/api/admin/users/${eve.user.id}`, payload: { admin: true } });
    const evil = await adminSignIn(adm, 'eve@example.org');
    expect((await evil.inject('/api/admin/overview')).statusCode).toBe(200);
    await boss.inject({ method: 'PATCH', url: `/api/admin/users/${eve.user.id}`, payload: { admin: false } });
    expect((await evil.inject('/api/admin/overview')).statusCode).toBe(401);
    // the app's session is untouched
    expect((await eve.inject('/api/projects')).statusCode).toBe(200);
  });

  it('signs out', async () => {
    const c = await adminSignIn(adm, 'root@example.org');
    expect((await c.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(200);
    expect((await c.inject('/api/admin/overview')).statusCode).toBe(401);
  });

  it('is never framed nor cached, and may be kept to some addresses', async () => {
    const r = await boss.inject('/api/admin/overview');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('192.168.1.7', ['192.168.1.7'])).toBe(true);
    expect(ipAllowed('192.168.1.8', ['192.168.1.7', '::1'])).toBe(false);
    expect(ipAllowed('anything', [])).toBe(true);
    const closed = await buildAdminServer({ db, voicesDir: dir(), imagesDir: dir(), communityDir: dir(), allowedIps: ['10.0.0.0/8'] });
    expect((await closed.inject('/api/health')).statusCode).toBe(403); // inject comes from 127.0.0.1
    await closed.close();
  });
});

describe('back office: what it shows and does', () => {
  it('lists the workspaces with their owner, plan and size, and shows one in full', async () => {
    const list = (await boss.inject('/api/admin/workspaces?q=eve')).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ plan: 'free', owner: { name: 'Eve', email: 'eve@example.org' }, members: 1, projects: 0, custom: false });
    const id = list.items[0].id;
    await boss.inject({ method: 'PATCH', url: `/api/admin/workspaces/${id}`, payload: { plan: 'premium', quotas: { projects: 99 } } });
    expect((await boss.inject('/api/admin/workspaces?billing=custom')).json().items.map((w: { id: string }) => w.id)).toEqual([id]);
    expect((await boss.inject('/api/admin/workspaces?plan=premium')).json().total).toBe(1);
    const w = (await boss.inject(`/api/admin/workspaces/${id}`)).json();
    expect(w).toMatchObject({ plan: 'premium', limits: { projects: 99, decorImages: true }, members: [{ name: 'Eve', role: 'owner' }], billing: { customerId: null } });
    // a granted plan, not a paid one
    const subs = (await boss.inject('/api/admin/subscriptions')).json();
    expect(subs.items.find((s: { id: string }) => s.id === id)).toMatchObject({ plan: 'premium', source: 'granted' });
    expect(subs.revenue.find((r: { plan: string }) => r.plan === 'premium')).toMatchObject({ count: 0, monthly: 0 });
  });

  it('shows the plans as this server has them', async () => {
    const p = (await boss.inject('/api/admin/plans')).json();
    expect(p).toMatchObject({ enabled: true, payments: false, prices: null });
    expect(p.plans).toHaveLength(4);
  });

  it('lists every film, hidden ones too, and hides, restores or removes one', async () => {
    const pid = (await eve.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json().id;
    const pub = (await eve.inject({ method: 'POST', url: `/api/projects/${pid}/publish`, payload: { title: 'Le film d’Eve' } })).json().id;
    expect((await boss.inject({ method: 'PATCH', url: `/api/admin/publications/${pub}`, payload: { hidden: true } })).statusCode).toBe(200);
    expect((await boss.inject('/api/admin/publications?status=hidden')).json().items.map((p: { id: string }) => p.id)).toEqual([pub]);
    expect((await app.inject(`/api/community/${pub}`)).statusCode).toBe(404);
    await boss.inject({ method: 'PATCH', url: `/api/admin/publications/${pub}`, payload: { hidden: false } });
    expect((await app.inject(`/api/community/${pub}`)).statusCode).toBe(200);
    expect((await boss.inject({ method: 'DELETE', url: `/api/admin/publications/${pub}` })).statusCode).toBe(204);
    expect((await app.inject(`/api/community/${pub}`)).statusCode).toBe(404);
    expect((await boss.inject({ method: 'DELETE', url: `/api/admin/publications/${pub}` })).statusCode).toBe(404);
  });

  it('signs someone out everywhere, without suspending them', async () => {
    const r = (await boss.inject({ method: 'POST', url: `/api/admin/users/${eve.user.id}/signout` })).json();
    expect(r.ended).toBeGreaterThanOrEqual(1);
    expect((await eve.inject('/api/projects')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'animation-flow' }, payload: { email: 'eve@example.org', password: 'mot-de-passe-solide-1' } })).statusCode).toBe(200);
  });

  it('writes every action to the audit log, searchable', async () => {
    const all = (await boss.inject('/api/admin/audit')).json();
    const actions = all.items.map((e: { action: string }) => e.action);
    for (const a of ['sign-in', 'grant-admin', 'revoke-admin', 'set-plan', 'set-limits', 'hide', 'unhide', 'remove', 'signout']) expect(actions, a).toContain(a);
    expect(all.items[0]).toMatchObject({ admin: { name: 'Root' } });
    const found = (await boss.inject('/api/admin/audit?q=Premium')).json();
    expect(found.items[0].summary).toMatch(/au plan Premium/);
    // the overview adds the sign-ups of the last 30 days, day by day
    const o = (await boss.inject('/api/admin/overview')).json();
    expect(o.signups).toHaveLength(30);
    expect(o.signups.at(-1).count).toBe(2);
  });
});
