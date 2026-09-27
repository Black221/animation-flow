// E-mail through a real SMTP server implementation (smtp-server, by the authors of nodemailer): encryption by
// STARTTLS and from the first byte (smtps), authentication required, a wrong password refused.
import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { invitationMail, smtpMailer, smtpOptions } from '../src/mail';
import { buildServer } from '../src/server';
import { signUp } from './client';
import { openTestDb } from './testdb';

const dir = mkdtempSync(join(tmpdir(), 'af-smtp-'));
let key: Buffer, cert: Buffer, db: Db;
interface Got { from: string; to: string[]; user: string | undefined; secure: boolean; data: string }
const received: Got[] = [];
const servers: SMTPServer[] = [];

async function smtp(secure: boolean) {
  const s = new SMTPServer({
    secure, key, cert, authMethods: ['PLAIN', 'LOGIN'], authOptional: false,
    onAuth(auth, _session, cb) { if (auth.username === 'mailer' && auth.password === 'bon-mot-de-passe') cb(null, { user: auth.username }); else cb(new Error('Invalid username or password')); },
    onData(stream, session, cb) {
      let data = '';
      stream.on('data', (d) => { data += String(d); });
      stream.on('end', () => { received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), user: session.user as string | undefined, secure: session.secure, data }); cb(); });
    },
  });
  s.on('error', () => undefined); // a client that gives up during TLS (the untrusted-certificate test)
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  servers.push(s);
  return (s.server.address() as AddressInfo).port;
}
const trust = () => ({ ca: cert, servername: 'localhost' });

beforeAll(async () => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  key = readFileSync(join(dir, 'key.pem')); cert = readFileSync(join(dir, 'cert.pem'));
  db = await openTestDb();
});
afterAll(async () => { await Promise.all(servers.map((s) => new Promise<void>((ok) => s.close(() => ok())))); await db.close(); });

const message = () => invitationMail({ to: 'ed@example.org', by: 'Olga', workspace: 'Studio', role: 'editor', url: 'https://anim.example.org/invite/abc', days: 7 });

describe('SMTP', () => {
  it('reads SMTP_URL', () => {
    expect(smtpOptions('smtps://noreply%40example.org:p%40ss%3Aw0rd@smtp.example.org')).toEqual({ host: 'smtp.example.org', port: 465, secure: true, auth: { user: 'noreply@example.org', pass: 'p@ss:w0rd' } });
    expect(smtpOptions('smtp://smtp.example.org?requireTLS=true&name=anim.example.org')).toEqual({ host: 'smtp.example.org', port: 587, secure: false, requireTLS: true, name: 'anim.example.org' });
    expect(smtpOptions('smtp://[::1]:2525')).toMatchObject({ host: '::1', port: 2525 });
    expect(() => smtpOptions('http://x')).toThrow(/smtp/);
  });

  it('sends over STARTTLS with authentication (port 587 style)', async () => {
    const port = await smtp(false);
    await (await smtpMailer(`smtp://mailer:bon-mot-de-passe@127.0.0.1:${port}`, 'animation-flow <noreply@example.org>', trust())).send(message());
    const m = received.at(-1)!;
    expect(m).toMatchObject({ from: 'noreply@example.org', to: ['ed@example.org'], user: 'mailer', secure: true });
    expect(m.data).toMatch(/^Subject: Olga vous invite sur animation-flow/m);
    expect(m.data).toContain('Content-Type: text/html');
  });

  it('sends over TLS from the start (smtps, port 465 style)', async () => {
    const port = await smtp(true);
    await (await smtpMailer(`smtps://mailer:bon-mot-de-passe@127.0.0.1:${port}`, 'animation-flow <noreply@example.org>', trust())).send(message());
    expect(received.at(-1)).toMatchObject({ user: 'mailer', secure: true });
  });

  it('refuses a certificate it cannot check', async () => {
    const port = await smtp(true);
    await expect((await smtpMailer(`smtps://mailer:bon-mot-de-passe@127.0.0.1:${port}`, 'af <noreply@example.org>')).send(message())).rejects.toThrow(/certificate/i);
  });

  it('reports a refused password: the invitation exists, the admin is told, nothing leaks', async () => {
    const port = await smtp(false), before = received.length;
    const mailer = await smtpMailer(`smtp://mailer:mauvais@127.0.0.1:${port}`, 'af <noreply@example.org>', trust());
    await expect(mailer.send(message())).rejects.toThrow(/535|Invalid username or password/);
    const app: FastifyInstance = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), mail: { mailer, appUrl: 'https://anim.example.org' } });
    const owner = await signUp(app, 'owner@example.org', { name: 'Olga' });
    const r = (await owner.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'editor', email: 'ed@example.org', send: true } })).json();
    expect(r).toMatchObject({ sent: false, sendError: expect.stringContaining('transmettez le lien'), path: expect.stringMatching(/^\/invite\//) });
    expect(JSON.stringify(r)).not.toContain('mauvais');
    expect(received.length).toBe(before);
    await app.close();
  });
});
