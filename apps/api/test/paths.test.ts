// A path written with percent-encoded letters (/%61pi/… for /api/…) reaches the same route: the checks must follow the
// route, not the characters of the request line.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAdminServer } from '../src/admin/server';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { API_CSP } from '../src/net/headers';
import { buildServer } from '../src/server';
import { signUp } from './client';
import { openTestDb } from './testdb';

let db: Db, app: FastifyInstance, admin: FastifyInstance;
const dir = () => mkdtempSync(join(tmpdir(), 'af-paths-'));
/** the same path, with one letter of /api/ encoded in each possible way */
const disguises = (path: string) => [path, path.replace('/api/', '/%61pi/'), path.replace('/api/', '/a%70i/'), path.replace('/api/', '/ap%69/'), path.replace('/api/', '/%61%70%69/'), path.replace('/api/', '/%61PI/'.toLowerCase())];

beforeAll(async () => {
  db = await openTestDb();
  const web = dir();
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>animation-flow</title>');
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: dir(), webDist: web });
  await signUp(app, 'someone@example.org');
  admin = await buildAdminServer({ db, voicesDir: dir(), imagesDir: dir(), communityDir: dir() });
});
afterAll(async () => { await app.close(); await admin.close(); await db.close(); });

describe('encoded paths', () => {
  it('never open the back office without a manager session', async () => {
    for (const path of ['/api/admin/users', '/api/admin/overview', '/api/admin/workspaces', '/api/admin/audit']) {
      for (const url of disguises(path)) {
        const r = await admin.inject(url);
        expect(r.statusCode, url).toBe(401);
        expect(r.body, url).not.toContain('someone@example.org');
      }
    }
    for (const url of disguises('/api/admin/users/00000000-0000-0000-0000-000000000000/signout')) {
      expect((await admin.inject({ method: 'POST', url })).statusCode, url).toBe(403); // no CSRF header
      expect((await admin.inject({ method: 'POST', url, headers: { 'x-requested-with': 'animation-flow-admin' } })).statusCode, url).toBe(401);
    }
  });

  it('never open the app without a session, and keep the API headers', async () => {
    for (const path of ['/api/projects', '/api/credentials', '/api/workspace']) {
      for (const url of disguises(path)) {
        const r = await app.inject(url);
        expect(r.statusCode, url).toBe(401);
        expect(r.headers['content-security-policy'], url).toBe(API_CSP);
      }
    }
    for (const url of disguises('/api/projects')) expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode, url).toBe(403);
    for (const url of disguises('/api/health')) expect((await app.inject(url)).headers['content-security-policy'], url).toBe(API_CSP);
  });
});
