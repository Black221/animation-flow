import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import pkg from '../package.json';
import { openTestDb } from './testdb';

// The database as the server sees it, which the test can cut: then every query fails, or never answers
let real: Db, cut: 'no' | 'fails' | 'hangs' = 'no', ffmpeg = true, app: FastifyInstance;
const dataDir = mkdtempSync(join(tmpdir(), 'af-ready-'));

beforeAll(async () => {
  real = await openTestDb();
  const db: Db = {
    query: (sql, params) => cut === 'fails' ? Promise.reject(new Error('connection terminated')) : cut === 'hangs' ? new Promise(() => undefined) : real.query(sql, params),
    tx: (fn) => real.tx(fn), listen: (c, f) => real.listen(c, f), close: () => real.close(),
  };
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: join(dataDir, 'voices'), ready: { dataDir, ffmpeg: async () => ffmpeg, timeoutMs: 300 } });
});
afterAll(async () => { cut = 'no'; await app.close(); await real.close(); });

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
  it('says the version and the commit it runs', async () => {
    const body = (await app.inject('/api/health')).json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
    expect(body.version).toBe('0.9.0');
    expect(body).toHaveProperty('commit');
  });
});
