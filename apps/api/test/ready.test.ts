import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import { databaseUnavailable, openDb, type Db } from '../src/db';
import { readiness } from '../src/ready';
import { buildAdminServer } from '../src/admin/server';
import { commitOf, VERSION } from '../src/version';
import { ffmpegAvailable } from '@af/render';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../src/server';
import pkg from '../package.json';
import { openTestDb } from './testdb';

// The database as the server sees it, which the test can cut: then every query fails, or never answers
let real: Db, gone: Db, cut: 'no' | 'fails' | 'hangs' = 'no', ffmpeg = true, app: FastifyInstance;
const dataDir = mkdtempSync(join(tmpdir(), 'af-ready-'));

beforeAll(async () => {
  real = await openTestDb();
  gone = await openDb({ url: 'postgres://af:af@127.0.0.1:1/af' }); // nothing listens there: the driver's own errors
  const db: Db = {
    query: (sql, params) => cut === 'fails' ? gone.query(sql, params) : cut === 'hangs' ? new Promise(() => undefined) : real.query(sql, params),
    tx: (fn) => real.tx(fn), listen: (c, f) => real.listen(c, f), close: () => real.close(),
  };
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: join(dataDir, 'voices'), ready: { dataDir, ffmpeg: async () => ffmpeg, timeoutMs: 300 } });
});
afterAll(async () => { cut = 'no'; await app.close(); await real.close(); await gone.close(); });

const ready = async () => { const r = await app.inject('/api/ready'); return { status: r.statusCode, body: r.json(), cache: r.headers['cache-control'] }; };

describe('/api/ready', () => {
  it('answers 200 when the database, the data folder and FFmpeg are there', async () => {
    expect(await ready()).toEqual({ status: 200, body: { ok: true, checks: { database: true, storage: true, ffmpeg: true } }, cache: 'no-store' });
  });

  it('answers 503 when the database is cut, and 200 again once it is back', async () => {
    cut = 'fails';
    expect(await ready()).toMatchObject({ status: 503, body: { ok: false, checks: { database: false, storage: true, ffmpeg: true } } });
    cut = 'hangs';
    const t0 = Date.now(), r = await ready();
    expect(r).toMatchObject({ status: 503, body: { checks: { database: false } } });
    expect(Date.now() - t0).toBeLessThan(2000);
    cut = 'no';
    expect((await ready()).status).toBe(200);
  });

  it('answers 503, not 500, to any request that finds the database out of reach', async () => {
    cut = 'fails';
    try {
      const r = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { 'x-requested-with': 'animation-flow' }, payload: { email: 'a@example.org', name: 'A', password: 'mot-de-passe-solide-1' } });
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toMatch(/indisponible/);
      expect(r.body).not.toContain('127.0.0.1');
    } finally { cut = 'no'; }
  });

  it('answers 503 when the data folder takes no write, without saying where it is', async () => {
    const blocked = join(dataDir, 'not-a-folder');
    writeFileSync(blocked, 'a file where a folder should be');
    const other = await buildServer({ db: real, box: secretBox(randomBytes(32)), voicesDir: join(dataDir, 'voices'), ready: { dataDir: blocked, ffmpeg: async () => true } });
    try {
      const r = await other.inject('/api/ready');
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ ok: false, checks: { database: true, storage: false, ffmpeg: true } });
      expect(r.body).not.toContain(dataDir);
    } finally { await other.close(); }
  });

  it('answers 503 without FFmpeg', async () => {
    const other = await buildServer({ db: real, box: secretBox(randomBytes(32)), voicesDir: join(dataDir, 'voices'), ready: { dataDir, ffmpeg: async () => false } });
    try { expect((await other.inject('/api/ready')).json()).toMatchObject({ ok: false, checks: { ffmpeg: false } }); } finally { await other.close(); }
  });

  it('asks FFmpeg once a minute at most, however often it is probed', async () => {
    let runs = 0;
    const other = await buildServer({ db: real, box: secretBox(randomBytes(32)), voicesDir: join(dataDir, 'voices'), ready: { dataDir, ffmpeg: async () => { runs++; return true; } } });
    try {
      await Promise.all(Array.from({ length: 5 }, () => other.inject('/api/ready')));
      for (let i = 0; i < 5; i++) await other.inject('/api/ready');
      expect(runs).toBe(1);
    } finally { await other.close(); }
  });
});

describe('/api/health', () => {
  it('says the version and the commit it runs, in the app and in the back office', async () => {
    const body = (await app.inject('/api/health')).json();
    expect(body).toEqual({ ok: true, version: '0.9.0', commit: VERSION.commit });
    expect(body.version).toBe(pkg.version);
    const admin = await buildAdminServer({ db: real, voicesDir: join(dataDir, 'v'), imagesDir: join(dataDir, 'i'), communityDir: join(dataDir, 'c') });
    try { expect((await admin.inject('/api/health')).json()).toEqual({ ok: true, backOffice: true, version: '0.9.0', commit: VERSION.commit }); } finally { await admin.close(); }
  });

  it('takes the commit the image was built from, cut to 12 characters', () => {
    expect(commitOf({ APP_COMMIT: '096a4d9bb56a0123456789abcdef0123456789ab' })).toBe('096a4d9bb56a');
    expect(commitOf({ APP_COMMIT: 'abc' })).toBe('abc');
  });
});

describe('ffmpegAvailable', () => {
  it('is false when the binary is not there', async () => {
    expect(await ffmpegAvailable(3000, '/nonexistent/ffmpeg')).toBe(false);
  });
  it.skipIf(!spawnSync('ffmpeg', ['-version']).stdout?.length)('is true with a working FFmpeg', async () => {
    expect(await ffmpegAvailable(5000, 'ffmpeg')).toBe(true);
  });
});

// The real driver, not a stand-in: a database that cannot be reached, and one that drops the connections it had
describe('/api/ready with the real PostgreSQL driver', () => {
  it('says the database is down when nothing listens where it should be', async () => {
    const gone = await openDb({ url: 'postgres://af:af@127.0.0.1:1/af' });
    try { expect(await readiness(gone, { dataDir, ffmpeg: async () => true, timeoutMs: 2000 })()).toEqual({ database: false, storage: true, ffmpeg: true }); } finally { await gone.close(); }
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)('survives the database closing a connection in the middle of a transaction', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('application_name', 'af-tx-cut');
    const db = await openDb({ url: url.toString() }), admin = await openDb({ url: process.env.TEST_DATABASE_URL! });
    try {
      // the transaction holds its connection (out of the pool) between two queries while PostgreSQL closes it
      const tx = db.tx(async (q) => { await q.query('SELECT 1'); await new Promise((r) => setTimeout(r, 1000)); await q.query('SELECT 2'); });
      await new Promise((r) => setTimeout(r, 300));
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'af-tx-cut'`);
      const failure = await tx.then(() => null, (e: unknown) => e);
      expect(failure).toBeTruthy();
      expect(databaseUnavailable(failure)).toBe(true);
      expect((await db.query<{ n: number }>('SELECT 3 AS n')).rows[0]!.n).toBe(3); // the next query gets a fresh connection
    } finally { await db.close(); await admin.close(); }
  });

  it('tells a database outage from any other network error', async () => {
    const gone = await openDb({ url: 'postgres://af:af@127.0.0.1:1/af' });
    try {
      const e = await gone.query('SELECT 1').then(() => null, (x: unknown) => x);
      expect(databaseUnavailable(e)).toBe(true);
      expect(databaseUnavailable(await gone.tx(async (q) => q.query('SELECT 1')).then(() => null, (x: unknown) => x))).toBe(true);
    } finally { await gone.close(); }
    // the same codes from a provider or the mail server are not the database's
    expect(databaseUnavailable(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(false);
    expect(databaseUnavailable(new Error('Connection terminated unexpectedly'))).toBe(false);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)('survives the database closing its connections, and is ready again right after', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('application_name', 'af-ready-cut');
    const db = await openDb({ url: url.toString() }), admin = await openDb({ url: process.env.TEST_DATABASE_URL! });
    try {
      const probe = readiness(db, { dataDir, ffmpeg: async () => true });
      expect((await probe()).database).toBe(true); // the pool keeps that connection, idle
      // what a restart of PostgreSQL does to it: 57P01, terminating connection due to administrator command
      const cut = await admin.query<{ n: string }>(`SELECT count(pg_terminate_backend(pid)) AS n FROM pg_stat_activity WHERE application_name = 'af-ready-cut'`);
      expect(Number(cut.rows[0]!.n)).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 300));
      expect((await probe()).database).toBe(true); // a fresh connection; the process is still there to answer
    } finally { await db.close(); await admin.close(); }
  });
});
