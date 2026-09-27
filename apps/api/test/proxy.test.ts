// Behind a load balancer every request comes from the balancer: TRUST_PROXY makes the API see the real client
// (sign-in limits per person, not one limit for everyone), and without it a forged X-Forwarded-For changes nothing.
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../src/config';
import { secretBox } from '../src/crypto';
import { buildServer } from '../src/server';
import { signUp } from './client';
import { openTestDb } from './testdb';

const db = await openTestDb();
afterAll(async () => { await db.close(); });
const make = (trustProxy: boolean) => buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), trustProxy });
const login = (app: Awaited<ReturnType<typeof make>>, ip: string) => app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'animation-flow', 'x-forwarded-for': ip }, payload: { email: 'nobody@example.org', password: 'faux-mot-de-passe' } });

describe('TRUST_PROXY', () => {
  it('reads the setting', () => {
    expect([undefined, '', 'false', 'true', '2', '10.0.0.0/8, 127.0.0.1'].map(parseTrustProxy)).toEqual([false, false, false, true, 2, '10.0.0.0/8,127.0.0.1']);
  });

  it('behind a trusted proxy, limits sign-in attempts per client, not for everyone at once', async () => {
    const app = await make(true);
    await signUp(app, 'owner@example.org');
    for (let k = 0; k < 11; k++) await login(app, '203.0.113.7');
    expect((await login(app, '203.0.113.7')).statusCode).toBe(429); // this client is slowed down
    expect((await login(app, '198.51.100.9')).statusCode).toBe(401); // another one is not
    await app.close();
  });

  it('without it, a forged X-Forwarded-For does not escape the limit', async () => {
    const app = await make(false);
    for (let k = 0; k < 11; k++) await login(app, `192.0.2.${k}`);
    expect((await login(app, '192.0.2.200')).statusCode).toBe(429);
    await app.close();
  });
});
