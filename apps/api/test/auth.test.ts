import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { PASSWORD, signIn, signUp, type Client } from './client';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, owner: Client;
const H = { 'x-requested-with': 'animation-flow' };

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')) });
});
afterAll(async () => { await app.close(); await db.close(); });

describe('first account', () => {
  it('is asked for on a fresh install', async () => {
    expect((await app.inject('/api/auth/me')).json()).toMatchObject({ user: null, setup: true, signup: 'invite' });
    expect((await app.inject('/api/projects')).statusCode).toBe(401);
  });

  it('takes over the data from before accounts existed, as owner', async () => {
    // a project saved before this version: it sits in the default workspace created by the migration
    const ws = (await db.query<{ id: string }>('SELECT id FROM workspaces')).rows[0]!.id;
    await db.query(`INSERT INTO projects (id, title, data, workspace_id) VALUES (gen_random_uuid(), 'Ancien projet', '{}', $1)`, [ws]);
    const r = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: H, payload: { email: 'Awa@Example.org', name: 'Awa', password: PASSWORD } });
    expect(r.statusCode).toBe(201);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/^af_session=[\w-]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(r.json().workspaces).toEqual([{ id: ws, name: 'Mon espace', role: 'owner' }]);
    owner = await signIn(app, 'awa@example.org');
    expect((await owner.inject('/api/projects')).json().map((p: { title: string }) => p.title)).toEqual(['Ancien projet']);
    const { rows } = await db.query<{ email: string; password_hash: string }>('SELECT email, password_hash FROM users');
    expect(rows[0]).toMatchObject({ email: 'awa@example.org' });
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
  });

  it('then closes sign-up to people without an invitation', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: H, payload: { email: 'x@example.org', name: 'X', password: PASSWORD } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/signup', headers: H, payload: { email: 'awa@example.org', name: 'A', password: PASSWORD, invitation: 'nope' } })).statusCode).toBe(400);
  });
});

describe('signing in', () => {
  it('refuses a wrong password, weak passwords and bad e-mails', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'awa@example.org', password: 'wrong-password' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'nobody@example.org', password: 'whatever-long' } })).json().error).toBe('e-mail ou mot de passe incorrect');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'pas-un-email', password: 'x' } })).statusCode).toBe(400);
  });

  it('requires the CSRF header on every write', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: owner.cookie }, payload: { template: 'blank' } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'awa@example.org', password: PASSWORD } })).statusCode).toBe(403);
  });

  it('slows down repeated failures', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, remoteAddress: '10.0.0.9', payload: { email: 'target@example.org', password: `guess-${i}-xxxx` } })).statusCode;
    expect(last).toBe(429);
  });

  it('signs out', async () => {
    const c = await signIn(app, 'awa@example.org');
    expect((await c.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(200);
    expect((await c.inject('/api/auth/me')).json().user).toBeNull();
    expect((await c.inject('/api/projects')).statusCode).toBe(401);
  });

  it('changing the password signs out every other session', async () => {
    const other = await signIn(app, 'awa@example.org');
    expect((await owner.inject({ method: 'PATCH', url: '/api/auth/me', payload: { password: { current: 'wrong', next: 'nouveau-mot-de-passe-2' } } })).statusCode).toBe(400);
    expect((await owner.inject({ method: 'PATCH', url: '/api/auth/me', payload: { password: { current: PASSWORD, next: 'court' } } })).statusCode).toBe(400);
    const r = await owner.inject({ method: 'PATCH', url: '/api/auth/me', payload: { name: 'Awa D.', password: { current: PASSWORD, next: 'nouveau-mot-de-passe-2' } } });
    expect(r.json().user.name).toBe('Awa D.');
    expect((await owner.inject('/api/projects')).statusCode).toBe(200);
    expect((await other.inject('/api/projects')).statusCode).toBe(401);
    await signIn(app, 'awa@example.org', 'nouveau-mot-de-passe-2');
  });
});

describe('open sign-up', () => {
  it('gives each new account its own workspace', async () => {
    const d = await openTestDb(), a = await buildServer({ db: d, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), signup: 'open' });
    await signUp(a, 'first@example.org', { name: 'First' });
    const second = await signUp(a, 'second@example.org', { name: 'Second' });
    expect(second.workspaces).toMatchObject([{ name: 'Espace de Second', role: 'owner' }]);
    const dup = await a.inject({ method: 'POST', url: '/api/auth/signup', headers: H, payload: { email: 'SECOND@example.org', name: 'S', password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
    await a.close(); await d.close();
  });
});
