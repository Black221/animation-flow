// Plans and quotas, payments, the platform's administration: the first account runs the platform (admin, Pro); the
// next ones start free and meet its limits (projects, members, video width and minutes, workspaces, painted decors);
// a failed or canceled job gives its minutes back; the admin changes a plan, sets custom limits, suspends an
// account, settles reports; Stripe's signed webhook is what grants a paid plan, once per event.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPayload, type StripeFetch } from '../src/billing';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { signIn, signUp, type Client } from './client';
import { openTestDb } from './testdb';

const WHSEC = 'whsec_test_0000000000', PRICES = { basic: 'price_basic', premium: 'price_premium', pro: 'price_pro' };
let db: Db, app: FastifyInstance, root: Client, ben: Client;
const stripeCalls: { url: string; auth: string; body: URLSearchParams }[] = [];
const stripeFetch: StripeFetch = async (url, init) => {
  stripeCalls.push({ url, auth: init.headers.authorization ?? '', body: new URLSearchParams(init.body ?? '') });
  const json = url.endsWith('/checkout/sessions') ? { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' } : { url: 'https://billing.stripe.test/p_1' };
  return { ok: true, status: 200, json: async () => json };
};
const hook = (event: object, secret = WHSEC) => {
  const raw = JSON.stringify(event);
  return app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signPayload(raw, secret) }, payload: raw });
};
const plan = async (c: Client) => (await c.inject('/api/workspace/plan')).json();

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-pv-')), signup: 'open',
    stripe: { secretKey: 'sk_test_secret', webhookSecret: WHSEC, prices: PRICES, appUrl: 'https://anim.example.org' }, stripeFetch });
  root = await signUp(app, 'root@example.org', { name: 'Root' });
  ben = await signUp(app, 'ben@example.org', { name: 'Ben' });
});
afterAll(async () => { await app.close(); await db.close(); });

describe('plans', () => {
  it('lists the plans for anyone; the first account is the platform admin, on Pro; the next start free', async () => {
    const r = (await app.inject('/api/plans')).json();
    expect(r.plans.map((p: { id: string }) => p.id)).toEqual(['free', 'basic', 'premium', 'pro']);
    expect(r).toMatchObject({ enabled: true, payments: true });
    expect((await root.inject('/api/auth/me')).json().user.admin).toBe(true);
    expect((await ben.inject('/api/auth/me')).json().user.admin).toBe(false);
    expect(await plan(root)).toMatchObject({ plan: 'pro', label: 'Pro', canManage: true });
    expect(await plan(ben)).toMatchObject({ plan: 'free', limits: { projects: 3, maxWidth: 1280 }, usage: { projects: 0, members: 1 } });
  });

  it('stops at the plan’s projects, with a 402 saying what and how much', async () => {
    for (let i = 0; i < 3; i++) expect((await ben.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank' } })).statusCode).toBe(201);
    const r = await ben.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank' } });
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ quota: { metric: 'projects', plan: 'free', limit: 3, used: 3 } });
    expect(r.json().error).toMatch(/Gratuit.*3 projets/);
    // one less, one more
    const first = (await ben.inject('/api/projects')).json()[0].id;
    expect((await ben.inject({ method: 'DELETE', url: `/api/projects/${first}` })).statusCode).toBe(204);
    expect((await ben.inject({ method: 'POST', url: '/api/projects', payload: { template: 'pizza' } })).statusCode).toBe(201);
    expect((await root.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank' } })).statusCode).toBe(201); // Pro: no limit
  });

  it('keeps videos to the plan’s width and minutes, and gives back what a canceled render counted', async () => {
    const pizza = (await ben.inject('/api/projects')).json().find((p: { title: string }) => p.title === 'Pizza Time').id;
    const wide = await ben.inject({ method: 'POST', url: `/api/projects/${pizza}/renders`, payload: { width: 1920 } });
    expect(wide.statusCode).toBe(402);
    expect(wide.json().quota).toMatchObject({ metric: 'maxWidth', limit: 1280 });
    const r = await ben.inject({ method: 'POST', url: `/api/projects/${pizza}/renders`, payload: { width: 1280 } });
    expect(r.statusCode).toBe(202);
    const used = (await plan(ben)).usage.renderMinutes;
    expect(used).toBeGreaterThan(0.5); // a 41 s film
    // the admin leaves one minute a month: a second one does not fit
    await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { quotas: { renderMinutes: 1 } } });
    const over = await ben.inject({ method: 'POST', url: `/api/projects/${pizza}/renders`, payload: { width: 640 } });
    expect(over.statusCode).toBe(402);
    expect(over.json().error).toMatch(/il en reste 0\.\d/);
    // canceled: the minutes come back
    expect((await ben.inject({ method: 'POST', url: `/api/renders/${r.json().id}/cancel` })).statusCode).toBe(200);
    expect((await plan(ben)).usage.renderMinutes).toBe(0);
    expect((await ben.inject({ method: 'POST', url: `/api/projects/${pizza}/renders`, payload: { width: 640 } })).statusCode).toBe(202);
    await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { quotas: {} } });
  });

  it('counts members with pending invitations; no third free workspace; decors painted from Premium on', async () => {
    expect((await ben.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor' } })).statusCode).toBe(201);
    const full = await ben.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor' } });
    expect(full.statusCode).toBe(402);
    expect(full.json().quota).toMatchObject({ metric: 'members', limit: 2, used: 2 });
    expect((await ben.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Studio' } })).statusCode).toBe(201);
    const third = await ben.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Encore' } });
    expect(third.statusCode).toBe(402);
    expect(third.json().quota.metric).toBe('workspaces');
    const paint = await ben.inject({ method: 'POST', url: '/api/ai/decor-image', payload: { name: 'la rue', description: 'une rue le soir' } });
    expect(paint.statusCode).toBe(402);
    expect(paint.json().quota.metric).toBe('decorImages');
  });

  it('counts films generated this month (before asking for a model)', async () => {
    await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { quotas: { generations: 0 } } });
    const r = await ben.inject({ method: 'POST', url: '/api/generations', payload: { text: 'Une pub de 30 secondes pour une pizzeria.', style: 'flat' } });
    expect(r.statusCode).toBe(402);
    expect(r.json().quota).toMatchObject({ metric: 'generations', limit: 0 });
    await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { quotas: {} } });
  });

  it('with plans off, nothing is limited', async () => {
    const d = await openTestDb(), a = await buildServer({ db: d, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-pv-')), signup: 'open', plans: false });
    await signUp(a, 'first@example.org');
    const c = await signUp(a, 'second@example.org');
    for (let i = 0; i < 5; i++) expect((await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank' } })).statusCode).toBe(201);
    expect((await c.inject('/api/workspace/plan')).json()).toMatchObject({ enabled: false, limits: { projects: null } });
    await a.close(); await d.close();
  });
});

describe('payments', () => {
  it('sends the owner to Stripe Checkout for a paid plan (never for free, never for a member)', async () => {
    const r = await ben.inject({ method: 'POST', url: '/api/billing/checkout', payload: { plan: 'premium' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toBe('https://checkout.stripe.test/cs_1');
    const call = stripeCalls.at(-1)!;
    expect(call.auth).toBe('Bearer sk_test_secret');
    expect(call.body.get('mode')).toBe('subscription');
    expect(call.body.get('line_items[0][price]')).toBe('price_premium');
    expect(call.body.get('metadata[workspace_id]')).toBe(ben.workspaces[0]!.id);
    expect(call.body.get('subscription_data[metadata][plan]')).toBe('premium');
    expect(call.body.get('success_url')).toBe('https://anim.example.org/plans?paiement=ok');
    expect(call.body.get('customer_email')).toBe('ben@example.org');
    expect(JSON.stringify(r.json())).not.toContain('sk_test');
    expect((await ben.inject({ method: 'POST', url: '/api/billing/checkout', payload: { plan: 'free' } })).statusCode).toBe(400);
  });

  it('grants the plan only on a signed webhook, once per event; follows changes and the end of the subscription', async () => {
    const ws = ben.workspaces[0]!.id;
    const completed = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: ws, metadata: { workspace_id: ws, plan: 'premium' } } } };
    expect((await hook(completed, 'whsec_wrong')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(completed) })).statusCode).toBe(400);
    expect((await plan(ben)).plan).toBe('free');
    const ok = await hook(completed);
    expect(ok.statusCode).toBe(200);
    expect(await plan(ben)).toMatchObject({ plan: 'premium', billing: { status: 'active', customer: true }, limits: { decorImages: true, projects: 50 } });
    expect((await hook(completed)).json()).toMatchObject({ duplicate: true });
    // an upgrade in the portal: the price says the plan
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { workspace_id: ws }, items: { data: [{ price: { id: 'price_pro' }, current_period_end: end }] } } } });
    const pro = await plan(ben);
    expect(pro).toMatchObject({ plan: 'pro', billing: { status: 'active' } });
    expect(new Date(pro.billing.renewsAt).getTime()).toBe(end * 1000);
    // a payment that fails: the plan stays while Stripe retries
    await hook({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', items: { data: [{ price: { id: 'price_pro' } }] } } } });
    expect(await plan(ben)).toMatchObject({ plan: 'pro', billing: { status: 'past_due' } });
    // the portal, for the owner
    const portal = await ben.inject({ method: 'POST', url: '/api/billing/portal' });
    expect(portal.json().url).toBe('https://billing.stripe.test/p_1');
    expect(stripeCalls.at(-1)!.body.get('customer')).toBe('cus_1');
    // already subscribed: no second checkout
    expect((await ben.inject({ method: 'POST', url: '/api/billing/checkout', payload: { plan: 'basic' } })).statusCode).toBe(409);
    // canceled: back to free
    await hook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } });
    expect(await plan(ben)).toMatchObject({ plan: 'free', billing: { status: 'canceled' } });
  });
});

describe('administration', () => {
  it('is for platform admins only', async () => {
    for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/reports']) expect((await ben.inject(url)).statusCode, url).toBe(403);
    const o = (await root.inject('/api/admin/overview')).json();
    expect(o).toMatchObject({ users: 2, openReports: 0 });
    expect(o.byPlan.pro).toBe(1);
  });

  it('finds accounts, shows their workspaces, plans and usage; changes a plan', async () => {
    const list = (await root.inject('/api/admin/users?q=ben')).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ email: 'ben@example.org', admin: false, suspended: false });
    const detail = (await root.inject(`/api/admin/users/${ben.user.id}`)).json();
    expect(detail.workspaces[0]).toMatchObject({ role: 'owner', plan: 'free', usage: { projects: 3 } });
    const r = await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { plan: 'basic', quotas: { projects: 4 } } });
    expect(r.json()).toMatchObject({ plan: 'basic', limits: { projects: 4, maxWidth: 1920 } });
    expect((await root.inject({ method: 'PATCH', url: `/api/admin/workspaces/${ben.workspaces[0]!.id}`, payload: { quotas: { projects: -1 } } })).statusCode).toBe(400);
  });

  it('suspends an account (signed out everywhere, no signing in) and restores it; never oneself', async () => {
    expect((await root.inject({ method: 'PATCH', url: `/api/admin/users/${root.user.id}`, payload: { suspended: true } })).statusCode).toBe(400);
    expect((await root.inject({ method: 'PATCH', url: `/api/admin/users/${ben.user.id}`, payload: { suspended: true } })).statusCode).toBe(200);
    expect((await ben.inject('/api/projects')).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'animation-flow' }, payload: { email: 'ben@example.org', password: 'mot-de-passe-solide-1' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toMatch(/suspendu/);
    await root.inject({ method: 'PATCH', url: `/api/admin/users/${ben.user.id}`, payload: { suspended: false } });
    ben = await signIn(app, 'ben@example.org');
    expect((await ben.inject('/api/projects')).statusCode).toBe(200);
  });

  it('takes reports on films; hiding one takes it out of the community, for everyone but its author', async () => {
    const pizza = (await ben.inject('/api/projects')).json().find((p: { title: string }) => p.title === 'Pizza Time').id;
    const pub = (await ben.inject({ method: 'POST', url: `/api/projects/${pizza}/publish`, payload: { title: 'Pizza Time' } })).json().id;
    expect((await root.inject({ method: 'POST', url: `/api/community/${pub}/report`, payload: { reason: 'nope' } })).statusCode).toBe(400);
    expect((await root.inject({ method: 'POST', url: `/api/community/${pub}/report`, payload: { reason: 'copyright', message: 'une pub copiée' } })).statusCode).toBe(201);
    expect((await root.inject({ method: 'POST', url: `/api/community/${pub}/report`, payload: { reason: 'spam' } })).statusCode).toBe(201); // once per person: updated
    const reports = (await root.inject('/api/admin/reports')).json();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reason: 'spam', publication: { id: pub, title: 'Pizza Time', openReports: 1, author: { name: 'Ben' } } });
    expect((await root.inject({ method: 'POST', url: `/api/admin/reports/${reports[0].id}`, payload: { action: 'hide' } })).json()).toMatchObject({ status: 'hidden' });
    expect((await app.inject(`/api/community/${pub}`)).statusCode).toBe(404);
    expect((await app.inject('/api/community')).json().items.find((i: { id: string }) => i.id === pub)).toBeUndefined();
    expect((await ben.inject(`/api/community/${pub}`)).json()).toMatchObject({ hidden: true, canManage: true });
    expect((await root.inject('/api/admin/reports')).json()).toHaveLength(0);
    // back in the community
    await root.inject({ method: 'PATCH', url: `/api/admin/publications/${pub}`, payload: { hidden: false } });
    expect((await app.inject(`/api/community/${pub}`)).statusCode).toBe(200);
  });
});

describe('configuration', () => {
  it('takes all of the Stripe settings or none, and names what is missing — never a value', async () => {
    const { stripeConfig, loadConfig } = await import('../src/config');
    expect(stripeConfig({})).toBeNull();
    const partial = { STRIPE_SECRET_KEY: 'sk_live_verysecret', APP_URL: 'https://anim.example.org' };
    expect(() => stripeConfig(partial)).toThrow(/missing STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_BASIC, STRIPE_PRICE_PREMIUM, STRIPE_PRICE_PRO/);
    try { stripeConfig(partial); } catch (e) { expect((e as Error).message).not.toContain('verysecret'); }
    const full = { ...partial, STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_BASIC: 'price_b', STRIPE_PRICE_PREMIUM: 'price_p', STRIPE_PRICE_PRO: 'price_x' };
    expect(stripeConfig(full)).toMatchObject({ prices: { basic: 'price_b', pro: 'price_x' }, appUrl: 'https://anim.example.org' });
    expect(() => stripeConfig({ ...full, APP_URL: '' })).toThrow(/APP_URL/);
    expect(loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'af-cfg-')), PLANS: 'off' }).plans).toBe(false);
  });
});
