// The back office, the platform manager's tool, a server of its own with its own accounts: the first manager is made
// with the setup secret (once); users of the platform cannot sign in there, whatever they manage in their workspace;
// sessions apart from the app's, their own CSRF header; managers invite managers, disable or remove them (never
// themselves); every write is in the audit log; it lists workspaces, subscriptions, films; it can be kept to some
// addresses; nothing of it is framed or cached.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
const H = { 'x-requested-with': 'animation-flow-admin' };
const PW = 'mot-de-passe-solide-1';
const login = (email: string, password = PW, headers: Record<string, string> = H) => adm.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });
const setupFile = join(dir(), 'admin-setup-token');

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: dir(), signup: 'open', plans: true });
  root = await signUp(app, 'root@example.org', { name: 'Root' });
  eve = await signUp(app, 'eve@example.org', { name: 'Eve' });
  adm = await buildAdminServer({ db, voicesDir: dir(), imagesDir: dir(), communityDir: dir(), plans: true, setupTokenFile: setupFile, publicUrl: 'http://127.0.0.1:3001' });
});
afterAll(async () => { await adm.close(); await app.close(); await db.close(); });

describe('back office: its own accounts', () => {
  it('has no manager at first: the setup secret, in a file of the server, makes the first one — once', async () => {
    expect((await adm.inject('/api/auth/me')).json()).toMatchObject({ user: null, setup: true });
    const [token, link] = readFileSync(setupFile, 'utf8').trim().split('\n');
    expect(link).toBe(`http://127.0.0.1:3001/setup?token=${token}`);
    const wrong = await adm.inject({ method: 'POST', url: '/api/setup', headers: H, payload: { token: 'pas-le-bon', email: 'gerant@example.org', name: 'Gérant', password: PW } });
    expect(wrong.statusCode).toBe(403);
    const ok = await adm.inject({ method: 'POST', url: '/api/setup', headers: H, payload: { token, email: 'gerant@example.org', name: 'Gérant', password: PW } });
    expect(ok.statusCode).toBe(201);
    expect(existsSync(setupFile)).toBe(false);
    expect((await adm.inject({ method: 'POST', url: '/api/setup', headers: H, payload: { token, email: 'autre@example.org', name: 'Autre', password: PW } })).statusCode).toBe(409);
    expect((await adm.inject('/api/setup')).json()).toEqual({ needed: false });
    boss = await adminSignIn(adm, 'gerant@example.org');
  });

  it('is not for the platform’s users: one answer for them, a wrong password and a disabled manager', async () => {
    const wrong = await login('gerant@example.org', 'pas-le-bon-mot-de-passe'), user = await login('root@example.org');
    expect(wrong.statusCode).toBe(401);
    expect(user.statusCode).toBe(401); // the owner of a workspace, not of the platform
    expect(user.json().error).toBe(wrong.json().error);
    const ok = await login('gerant@example.org');
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
    // the app has no administration, no platform flag, no link to the back office
    expect((await root.inject('/api/admin/users')).statusCode).toBe(404);
    const me = (await root.inject('/api/auth/me')).json();
    expect(me.user).not.toHaveProperty('admin');
    expect(me).not.toHaveProperty('adminUrl');
  });

  it('wants its own CSRF header on every write', async () => {
    expect((await login('gerant@example.org', PW, { 'x-requested-with': 'animation-flow' })).statusCode).toBe(403);
    expect((await adm.inject({ method: 'PATCH', url: `/api/admin/users/${eve.user.id}`, headers: { cookie: boss.cookie }, payload: { suspended: true } })).statusCode).toBe(403);
  });

  it('lets a manager invite another (a link shown once), who then signs in; disabling ends their session', async () => {
    const inv = await boss.inject({ method: 'POST', url: '/api/admin/staff/invitations', payload: { email: 'aide@example.org' } });
    expect(inv.statusCode).toBe(201);
    const token = inv.json().path.split('/').pop();
    expect((await adm.inject(`/api/join/${token}`)).json()).toMatchObject({ email: 'aide@example.org' });
    expect((await adm.inject({ method: 'POST', url: `/api/join/${token}`, headers: H, payload: { name: 'Aide', password: 'court' } })).statusCode).toBe(400);
    const joined = await adm.inject({ method: 'POST', url: `/api/join/${token}`, headers: H, payload: { name: 'Aide', password: PW } });
    expect(joined.statusCode).toBe(201);
    expect((await adm.inject({ method: 'POST', url: `/api/join/${token}`, headers: H, payload: { name: 'Encore', password: PW } })).statusCode).toBe(404); // once
    const aide = await adminSignIn(adm, 'aide@example.org');
    const list = (await boss.inject('/api/admin/staff')).json();
    expect(list.staff.map((m: { name: string }) => m.name)).toEqual(['Gérant', 'Aide']);
    expect(list.staff[0]).toMatchObject({ you: true });
    const aideId = list.staff[1].id;
    // never oneself
    expect((await boss.inject({ method: 'PATCH', url: `/api/admin/staff/${list.staff[0].id}`, payload: { disabled: true } })).statusCode).toBe(400);
    expect((await boss.inject({ method: 'DELETE', url: `/api/admin/staff/${list.staff[0].id}` })).statusCode).toBe(400);
    expect((await boss.inject({ method: 'PATCH', url: `/api/admin/staff/${aideId}`, payload: { disabled: true } })).statusCode).toBe(200);
    expect((await aide.inject('/api/admin/overview')).statusCode).toBe(401);
    expect((await login('aide@example.org')).statusCode).toBe(401);
    await boss.inject({ method: 'PATCH', url: `/api/admin/staff/${aideId}`, payload: { disabled: false } });
    expect((await login('aide@example.org')).statusCode).toBe(200);
    expect((await boss.inject({ method: 'DELETE', url: `/api/admin/staff/${aideId}` })).statusCode).toBe(204);
    expect((await login('aide@example.org')).statusCode).toBe(401);
  });

  it('changes a manager’s own password, ending their other sessions', async () => {
    const other = await adminSignIn(adm, 'gerant@example.org');
    expect((await boss.inject({ method: 'POST', url: '/api/auth/password', payload: { current: 'faux', next: 'nouveau-mot-de-passe-9' } })).statusCode).toBe(400);
    expect((await boss.inject({ method: 'POST', url: '/api/auth/password', payload: { current: PW, next: 'nouveau-mot-de-passe-9' } })).statusCode).toBe(200);
    expect((await other.inject('/api/admin/overview')).statusCode).toBe(401);
    expect((await boss.inject('/api/admin/overview')).statusCode).toBe(200);
    await boss.inject({ method: 'POST', url: '/api/auth/password', payload: { current: 'nouveau-mot-de-passe-9', next: PW } });
  });

  it('signs out', async () => {
    const c = await adminSignIn(adm, 'gerant@example.org');
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

  it('takes a setup secret from the configuration instead of a file', async () => {
    const d = await openTestDb(), a = await buildAdminServer({ db: d, voicesDir: dir(), imagesDir: dir(), communityDir: dir(), setupToken: 'secret-de-deploiement-1234' });
    expect((await a.inject({ method: 'POST', url: '/api/setup', headers: H, payload: { token: 'secret-de-deploiement-1234', email: 'g@example.org', name: 'G', password: PW } })).statusCode).toBe(201);
    await a.close(); await d.close();
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

  it('shows the three plans as this server has them', async () => {
    const p = (await boss.inject('/api/admin/plans')).json();
    expect(p).toMatchObject({ enabled: true, payments: false, prices: null });
    expect(p.plans.map((x: { id: string }) => x.id)).toEqual(['free', 'premium', 'pro']);
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

  it('suspends a user and signs someone out everywhere; hands out no platform right', async () => {
    expect((await boss.inject({ method: 'PATCH', url: `/api/admin/users/${eve.user.id}`, payload: { admin: true } })).statusCode).toBe(400);
    const r = (await boss.inject({ method: 'POST', url: `/api/admin/users/${eve.user.id}/signout` })).json();
    expect(r.ended).toBeGreaterThanOrEqual(1);
    expect((await eve.inject('/api/projects')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'animation-flow' }, payload: { email: 'eve@example.org', password: PW } })).statusCode).toBe(200);
  });

  it('writes every action to the audit log, searchable', async () => {
    const all = (await boss.inject('/api/admin/audit?limit=200')).json();
    const actions = all.items.map((e: { action: string }) => e.action);
    for (const a of ['setup', 'sign-in', 'invite-manager', 'join', 'disable-manager', 'enable-manager', 'remove-manager', 'password', 'set-plan', 'set-limits', 'hide', 'unhide', 'remove', 'signout']) expect(actions, a).toContain(a);
    expect(all.items[0]).toMatchObject({ admin: { name: 'Gérant' } });
    const found = (await boss.inject('/api/admin/audit?q=Premium')).json();
    expect(found.items[0].summary).toMatch(/au plan Premium/);
    // the overview adds the sign-ups of the last 30 days, day by day (users of the platform only)
    const o = (await boss.inject('/api/admin/overview')).json();
    expect(o.signups).toHaveLength(30);
    expect(o.signups.at(-1).count).toBe(2);
  });
});
