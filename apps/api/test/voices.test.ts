import { encodeWav, SR } from '@af/audio';
import type { PostFetch } from '@af/providers';
import { probe } from '@af/render';
import { textHash } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { startRunner, type Runner } from '../src/render/runner';
import { signer } from '../src/render/sign';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';

// a stand-in voice provider: answers any line with ~1 s of tone between two silences, as a WAV
const speech = (seconds: number) => {
  const x = new Float32Array(Math.round((seconds + 0.8) * SR));
  for (let i = Math.round(0.4 * SR); i < x.length - 0.4 * SR; i++) x[i] = Math.sin((2 * Math.PI * 200 * i) / SR) * 0.2;
  return encodeWav({ sampleRate: SR, channels: [x] });
};
const postFetch = vi.fn<PostFetch>(async (_url, init) => {
  const text = JSON.parse(init.body).input as string;
  const wav = speech(Math.min(3, 0.4 + text.length / 30));
  return { ok: true, status: 200, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer };
});

const key = randomBytes(32), voicesDir = mkdtempSync(join(tmpdir(), 'af-voices-')), rendersDir = mkdtempSync(join(tmpdir(), 'af-renders-'));
let db: Db, app: FastifyInstance, runner: Runner;

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(key), signer: signer(key), voicesDir, postFetch });
  runner = startRunner({ db, rendersDir, voicesDir, threads: 0, pollMs: 50 });
});
afterAll(async () => { await runner.stop(); await app.close(); await db.close(); });

describe('narration', () => {
  it('asks for a voice setting before anything else', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Bonjour.' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('Narration');
  });

  let asset = '';
  it('records a line with the chosen provider, trims it and measures it', async () => {
    const cred = (await app.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'voix', apiKey: 'sk-test-voice-000000' } })).json();
    expect((await app.inject({ method: 'PUT', url: '/api/assignments/narration', payload: { credentialId: cred.id, model: 'tts-1', voice: 'nova' } })).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Voici Awa.' } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    asset = j.asset;
    expect(j).toMatchObject({ cached: false, textHash: textHash('Voici Awa.') });
    expect(j.asset).toMatch(/^[0-9a-f]{32}$/);
    // 0.4 + 10/30 s of tone, silences trimmed to a 60 ms margin on each side
    expect(j.duration).toBeGreaterThan(0.7);
    expect(j.duration).toBeLessThan(0.9);
    const body = JSON.parse(postFetch.mock.calls[0]![1].body);
    expect(body).toEqual({ model: 'tts-1', voice: 'nova', input: 'Voici Awa.', response_format: 'wav' });
    const wav = await app.inject({ url: j.url });
    expect(wav.statusCode).toBe(200);
    expect(wav.headers['content-type']).toBe('audio/wav');
  });

  it('never pays twice for the same line and voice', async () => {
    const calls = postFetch.mock.calls.length;
    const r = (await app.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Voici Awa.' } })).json();
    expect(r).toMatchObject({ asset, cached: true });
    expect(postFetch.mock.calls.length).toBe(calls);
    const other = (await app.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Voici Awa.', voice: 'onyx' } })).json();
    expect(other.asset).not.toBe(asset);
  });

  it('gives signed links for existing recordings only, and refuses unsigned ones', async () => {
    const links = (await app.inject({ method: 'POST', url: '/api/voices/links', payload: { assets: [asset, 'f'.repeat(32)] } })).json();
    expect(Object.keys(links)).toEqual([asset]);
    expect((await app.inject({ url: `/api/voices/${asset}.wav` })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/voices/${asset}.wav?exp=9999999999&sig=x` })).statusCode).toBe(403);
  });

  it('reports a provider refusal', async () => {
    postFetch.mockImplementationOnce(async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) }));
    const r = await app.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Une autre réplique.' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toBe('clé refusée par le fournisseur');
  });

  it('renders a video whose soundtrack carries the recorded voices, and says which lines have none', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json();
    const project = created.project;
    // record the first two lines of scene 2 (the short night scene), like the editor does
    const s2 = project.scenes[1];
    for (const line of s2.narration) {
      const v = (await app.inject({ method: 'POST', url: '/api/voices', payload: { text: line.text } })).json();
      line.audio = { asset: v.asset, textHash: v.textHash }; line.duration = v.duration;
    }
    const saved = await app.inject({ method: 'PUT', url: `/api/projects/${created.id}`, payload: { project, baseVersion: 1 } });
    expect(saved.statusCode).toBe(200);
    const job = (await app.inject({ method: 'POST', url: `/api/projects/${created.id}/renders`, payload: { width: 640, quality: 'draft', sceneId: 's2' } })).json();
    const until = async () => { for (let i = 0; i < 600; i++) { const j = (await app.inject({ url: `/api/renders/${job.id}` })).json(); if (j.status === 'done' || j.status === 'failed') return j; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };
    const done = await until();
    expect(done.status).toBe('done');
    expect(done.warnings).toEqual([]);
    const info = await probe(join(rendersDir, `${job.id}.mp4`));
    expect(info.streams).toEqual(['video', 'audio', 'subtitle']);
    expect(existsSync(join(rendersDir, `${job.id}.mp4.audio.wav`))).toBe(false);

    const all = (await app.inject({ method: 'POST', url: `/api/projects/${created.id}/renders`, payload: { width: 640, quality: 'draft', sceneId: 's1' } })).json();
    const j = await (async () => { for (let i = 0; i < 900; i++) { const x = (await app.inject({ url: `/api/renders/${all.id}` })).json(); if (x.status === 'done' || x.status === 'failed') return x; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); })();
    expect(j.warnings[0]).toMatch(/^8 réplique\(s\) sans voix/);
  }, 120_000);
});
