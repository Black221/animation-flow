// A key whose address points inside the server's network: saved, but never called unless the server allows it.
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { signUp } from './client';
import { openTestDb } from './testdb';

let local: Server, port: number, hits = 0;
const apps: FastifyInstance[] = [], dbs: Db[] = [];

beforeAll(async () => {
  // an OpenAI-compatible server on this machine, as Ollama would be
  local = createServer((_req, res) => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'llama3' }] })); });
  await new Promise<void>((done) => local.listen(0, '127.0.0.1', done));
  port = (local.address() as AddressInfo).port;
});
afterAll(async () => { for (const a of apps) await a.close(); for (const d of dbs) await d.close(); await new Promise((done) => local.close(done)); });

async function keyTest(allowPrivateProviders: boolean, email: string) {
  const db = await openTestDb();
  dbs.push(db);
  const app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir: mkdtempSync(join(tmpdir(), 'af-ssrf-')), allowPrivateProviders });
  apps.push(app);
  const c = await signUp(app, email), before = hits;
  const created = await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai-compatible', label: 'ollama', baseUrl: `http://127.0.0.1:${port}/v1` } });
  expect(created.statusCode).toBe(201);
  const r = await c.inject({ method: 'POST', url: `/api/credentials/${created.json().id}/test` });
  return { result: r.json(), called: hits - before };
}

describe('provider addresses (SSRF)', () => {
  it('never calls a private address by default, and says why', async () => {
    const { result, called } = await keyTest(false, 'owner1@example.org');
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^adresse refusée : 127\.0\.0\.1 .*ALLOW_PRIVATE_PROVIDERS=true/) });
    expect(called).toBe(0);
  });

  it('calls it on a private server that allows it', async () => {
    const { result, called } = await keyTest(true, 'owner2@example.org');
    expect(result).toEqual({ ok: true, models: [{ id: 'llama3', label: 'llama3' }] });
    expect(called).toBe(1);
  });

  it('reads ALLOW_PRIVATE_PROVIDERS, off unless exactly true', () => {
    const base = { DATA_DIR: mkdtempSync(join(tmpdir(), 'af-cfg-')) };
    expect(loadConfig(base).allowPrivateProviders).toBe(false);
    expect(loadConfig({ ...base, ALLOW_PRIVATE_PROVIDERS: 'yes' }).allowPrivateProviders).toBe(false);
    expect(loadConfig({ ...base, ALLOW_PRIVATE_PROVIDERS: 'true' }).allowPrivateProviders).toBe(true);
  });
});
