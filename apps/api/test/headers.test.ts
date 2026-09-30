import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAdminServer } from '../src/admin/server';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { API_CSP, PAGE_CSP } from '../src/net/headers';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, admin: FastifyInstance;
const dir = () => mkdtempSync(join(tmpdir(), 'af-headers-'));

beforeAll(async () => {
  db = await openTestDb();
  const web = dir();
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>animation-flow</title>');
  writeFileSync(join(web, 'theme.js'), '// theme');
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: dir(), webDist: web });
  admin = await buildAdminServer({ db, voicesDir: dir(), imagesDir: dir(), communityDir: dir() });
});
afterAll(async () => { await app.close(); await admin.close(); await db.close(); });

describe('security headers', () => {
  it('gives pages a strict Content Security Policy: this origin only, no inline script, never framed', async () => {
    for (const url of ['/', '/p/some-project', '/theme.js']) {
      const r = await app.inject(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-security-policy'], url).toBe(PAGE_CSP);
    }
    for (const d of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"]) expect(PAGE_CSP).toContain(d);
    expect(PAGE_CSP).not.toContain('unsafe');
  });

  it('lets nothing run in an API answer, and sends the other headers everywhere', async () => {
    for (const url of ['/', '/api/health', '/api/projects', '/api/nope']) {
      const r = await app.inject(url);
      if (url.startsWith('/api/')) expect(r.headers['content-security-policy'], url).toBe(API_CSP);
      expect(r.headers, url).toMatchObject({ 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' });
      expect(r.headers['permissions-policy'], url).toContain('camera=()');
    }
  });

  it('asks for HTTPS only over HTTPS', async () => {
    expect((await app.inject('/')).headers['strict-transport-security']).toBeUndefined();
    expect((await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'https' } })).headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('gives the back office the same, with no referrer at all', async () => {
    for (const url of ['/', '/api/health']) {
      const r = await admin.inject(url);
      expect(r.headers['content-security-policy'], url).toBe(url === '/' ? PAGE_CSP : API_CSP);
      expect(r.headers, url).toMatchObject({ 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    }
    expect((await admin.inject({ url: '/api/health', headers: { 'x-forwarded-proto': 'https' } })).headers['strict-transport-security']).toBe('max-age=31536000');
  });
});
