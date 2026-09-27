import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { invitationMail, smtpMailer, type Mail } from '../src/mail';
import { createServer } from 'node:net';
import { buildServer } from '../src/server';
import { signIn, signUp, type Client } from './client';
import { openTestDb } from './testdb';

const APP_URL = 'https://anim.example.org';
let db: Db, app: FastifyInstance, bare: FastifyInstance, owner: Client, base = '';
const outbox: Mail[] = [];
let failing = false;
const mailer = { send: async (m: Mail) => { if (failing) throw new Error('smtp down'); outbox.push(m); } };
const waitMail = async (n: number) => { for (let k = 0; k < 100 && outbox.length < n; k++) await new Promise((r) => setTimeout(r, 20)); return outbox[n - 1]; };
const linkIn = (m: Mail) => m.text.match(/https:\/\/\S+/)![0];
const anon = (a: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) => a.inject({ method, url, payload, headers: { 'x-requested-with': 'animation-flow', ...headers } });

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), mail: { mailer, appUrl: APP_URL } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  bare = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')) });
  owner = await signUp(app, 'owner@example.org', { name: 'Olga' });
});
afterAll(async () => { await app.close(); await bare.close(); await db.close(); });

describe('e-mail', () => {
  it('is off without SMTP: no forgotten-password flow, invitations stay links', async () => {
    expect((await anon(bare, 'GET', '/api/auth/me')).json().mail).toBe(false);
    expect((await anon(app, 'GET', '/api/auth/me')).json().mail).toBe(true);
    expect((await anon(bare, 'POST', '/api/auth/forgot', { email: 'owner@example.org' })).statusCode).toBe(404);
    const c = await signIn(bare, 'owner@example.org');
    expect((await c.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor', email: 'x@example.org', send: true } })).json().error).toContain('SMTP_URL');
  });

  it('sends an invitation to the address, with a link to APP_URL that works', async () => {
    const r = await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor', email: 'Ed@Example.org', send: true } });
    expect(r.json()).toMatchObject({ sent: true, email: 'ed@example.org' });
    const m = (await waitMail(1))!;
    expect(m).toMatchObject({ to: 'ed@example.org', subject: 'Olga vous invite sur animation-flow' });
    expect(m.text).toContain('comme éditeur');
    const link = linkIn(m);
    expect(link).toBe(`${APP_URL}${r.json().path}`);
    expect(m.html).toContain(`href="${link}"`);
    expect((await anon(app, 'GET', `/api/invitations/${link.split('/').pop()}`)).statusCode).toBe(200);
    // the mail server is down: the invitation exists anyway, the link is shown to pass on by hand
    failing = true;
    const down = (await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'viewer', email: 'vi@example.org', send: true } })).json();
    failing = false;
    expect(down).toMatchObject({ sent: false, sendError: expect.stringContaining('transmettez le lien'), path: expect.stringMatching(/^\/invite\//) });
    expect((await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'viewer', send: true } })).statusCode).toBe(400);
  });

  it('resets a forgotten password through a single-use link, and signs out everywhere', async () => {
    outbox.length = 0;
    // an unknown address gets the same answer, and no e-mail
    expect((await anon(app, 'POST', '/api/auth/forgot', { email: 'nobody@example.org' })).json()).toEqual({ ok: true });
    // the link comes from APP_URL, not from the Host of the request
    expect((await anon(app, 'POST', '/api/auth/forgot', { email: 'OWNER@example.org' }, { host: 'evil.example' })).json()).toEqual({ ok: true });
    const first = linkIn((await waitMail(1))!);
    expect(outbox).toHaveLength(1);
    expect(first.startsWith(`${APP_URL}/reset/`)).toBe(true);
    // asking again: only the newest link works
    await anon(app, 'POST', '/api/auth/forgot', { email: 'owner@example.org' });
    const link = linkIn((await waitMail(2))!), token = link.split('/').pop()!;
    expect((await anon(app, 'GET', `/api/auth/reset/${first.split('/').pop()}`)).statusCode).toBe(404);
    expect((await anon(app, 'GET', `/api/auth/reset/${token}`)).json()).toEqual({ email: 'owner@example.org' });

    const sock = new WebSocket(`${base.replace('http', 'ws')}/api/projects/${(await owner.inject({ method: 'POST', url: '/api/projects', payload: {} })).json().id}/live?ws=${owner.workspaces[0]!.id}`, { headers: { cookie: owner.cookie, origin: base } });
    await new Promise((ok) => sock.on('message', ok));
    const closed = new Promise<number>((ok) => sock.on('close', (code) => ok(code)));

    expect((await anon(app, 'POST', `/api/auth/reset/${token}`, { password: 'court' })).statusCode).toBe(400);
    const done = await anon(app, 'POST', `/api/auth/reset/${token}`, { password: 'nouveau-mot-de-passe-9' });
    expect(done.statusCode).toBe(200);
    expect(String(done.headers['set-cookie'])).toContain('af_session=');
    expect(await closed).toBe(4001);
    expect((await owner.inject('/api/workspace')).statusCode).toBe(401); // the old session is gone
    expect((await anon(app, 'POST', `/api/auth/reset/${token}`, { password: 'encore-un-autre-mot-9' })).statusCode).toBe(404); // used
    owner = await signIn(app, 'owner@example.org', 'nouveau-mot-de-passe-9');
  });

  it('limits how often a reset can be asked', async () => {
    const codes: number[] = [];
    for (let k = 0; k < 7; k++) codes.push((await anon(app, 'POST', '/api/auth/forgot', { email: 'limit@example.org' })).statusCode);
    expect(codes.slice(0, 2)).toEqual([200, 200]);
    expect(codes.at(-1)).toBe(429);
  });

  it('talks SMTP to a real server', async () => {
    // the smallest SMTP server that accepts one message
    let data = '', from = '', to = '';
    const srv = createServer((c) => {
      let inData = false, buf = '';
      c.write('220 test ESMTP\r\n');
      c.on('data', (d) => {
        buf += String(d);
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (inData) { if (line === '.') { inData = false; c.write('250 queued\r\n'); } else data += line + '\n'; continue; }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') c.write('250 test\r\n');
          else if (cmd === 'MAIL') { from = line; c.write('250 ok\r\n'); }
          else if (cmd === 'RCPT') { to = line; c.write('250 ok\r\n'); }
          else if (cmd === 'DATA') { inData = true; c.write('354 go\r\n'); }
          else if (cmd === 'QUIT') { c.write('221 bye\r\n'); c.end(); }
          else c.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    const m = await smtpMailer(`smtp://127.0.0.1:${port}?ignoreTLS=true`, 'animation-flow <noreply@example.org>');
    await m.send(invitationMail({ to: 'ed@example.org', by: 'Olga', workspace: 'Studio', role: 'editor', url: `${APP_URL}/invite/abc`, days: 7 }));
    srv.close();
    expect(from).toContain('noreply@example.org');
    expect(to).toContain('ed@example.org');
    expect(data).toMatch(/Subject: Olga vous invite sur animation-flow/);
    expect(data).toContain('multipart/alternative'); // text and HTML
  });

  it('refuses a mail setup without APP_URL or MAIL_FROM', () => {
    const env = { SMTP_URL: 'smtp://u:p@mail.example.org:587', MAIL_FROM: 'af <noreply@example.org>', APP_URL: 'https://anim.example.org/' };
    expect(loadConfig({ ...env, APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') }).mail).toEqual({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM, appUrl: 'https://anim.example.org' });
    expect(() => loadConfig({ ...env, APP_URL: undefined, APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') })).toThrow(/APP_URL/);
    expect(() => loadConfig({ ...env, MAIL_FROM: undefined, APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ ...env, SMTP_URL: 'http://x', APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') })).toThrow(/smtp/);
  });
});
