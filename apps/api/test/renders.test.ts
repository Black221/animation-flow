import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { claim, enqueue, requeueStale } from '../src/render/queue';
import { startRunner, type Runner } from '../src/render/runner';
import { signer } from '../src/render/sign';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const key = randomBytes(32), rendersDir = mkdtempSync(join(tmpdir(), 'af-renders-')), voicesDir = mkdtempSync(join(tmpdir(), 'af-voices-'));
let db: Db, app: FastifyInstance, c: Client, runner: Runner, blank = '', example = '';

const until = async (f: () => Promise<boolean>, ms = 60_000) => { const t = Date.now(); while (!(await f())) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)); } };
const render = async (id: string) => (await c.inject({ url: `/api/renders/${id}` })).json();

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(key), signer: signer(key), voicesDir });
  c = await signUp(app, 'owner@example.org');
  blank = (await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank', title: 'Court' } })).json().id;
  example = (await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'example' } })).json().id;
  runner = startRunner({ db, rendersDir, voicesDir, threads: 0, pollMs: 50 });
});
afterAll(async () => { await runner.stop(); await app.close(); await db.close(); });

describe('render jobs', () => {
  let done = '';
  it('renders a saved version to MP4 and serves it through a signed link', async () => {
    const r = await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { width: 640, quality: 'draft' } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ status: 'queued', framesTotal: 120, projectVersion: 1, videoUrl: null });
    done = r.json().id;
    await until(async () => (await render(done)).status === 'done');
    const j = await render(done);
    expect(j).toMatchObject({ framesDone: 120, framesTotal: 120, error: null });
    expect(j.bytes).toBeGreaterThan(1000);
    const video = await c.inject({ url: j.videoUrl });
    expect(video.statusCode).toBe(200);
    expect(video.headers['content-type']).toBe('video/mp4');
    expect(video.rawPayload.subarray(4, 8).toString()).toBe('ftyp');
    const part = await c.inject({ url: j.videoUrl, headers: { range: 'bytes=0-99' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(100);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${j.bytes}`);
  }, 90_000);

  it('refuses a forged or expired link', async () => {
    expect((await c.inject({ url: `/api/renders/${done}/video?exp=9999999999&sig=forged` })).statusCode).toBe(403);
    const old = signer(key, () => Date.now() - 7200_000).sign(done);
    expect((await c.inject({ url: `/api/renders/${done}/video?${old}` })).statusCode).toBe(403);
    expect((await c.inject({ url: `/api/renders/${done}/video` })).statusCode).toBe(403);
  });

  it('renders a single scene', async () => {
    const r = await c.inject({ method: 'POST', url: `/api/projects/${example}/renders`, payload: { width: 640, quality: 'draft', sceneId: 's2' } });
    expect(r.statusCode).toBe(202);
    expect(r.json().options).toMatchObject({ sceneId: 's2', width: 640, crf: 28 });
    await until(async () => (await render(r.json().id)).status === 'done');
    expect((await render(r.json().id)).framesDone).toBe(r.json().framesTotal);
  }, 90_000);

  it('delivers other shapes and files: a vertical GIF with the narration drawn in, a square WebM', async () => {
    const gif = await c.inject({ method: 'POST', url: `/api/projects/${example}/renders`, payload: { format: 'gif', aspect: '9:16', size: 360, quality: 'draft', sceneId: 's2' } });
    expect(gif.statusCode).toBe(202);
    // a GIF has no subtitle track and no sound: the narration is drawn into it
    expect(gif.json().options).toMatchObject({ format: 'gif', aspect: '9:16', framing: 'follow', width: 360, height: 640, subtitles: false, burn: true, audio: false });
    const sq = await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { format: 'webm', aspect: '1:1', framing: 'fit', size: 360, quality: 'draft', subtitles: 'off' } });
    expect(sq.json().options).toMatchObject({ format: 'webm', width: 360, height: 360, subtitles: false, burn: false, crf: 40 });
    await until(async () => (await render(gif.json().id)).status === 'done' && (await render(sq.json().id)).status === 'done', 120_000);
    const g = await c.inject({ url: `${(await render(gif.json().id)).videoUrl}&download=1` });
    expect(g.headers['content-type']).toBe('image/gif');
    expect(g.headers['content-disposition']).toContain('.gif');
    expect(g.rawPayload.subarray(0, 6).toString()).toBe('GIF89a');
    expect(existsSync(join(rendersDir, `${gif.json().id}.gif`))).toBe(true);
    const w = await c.inject({ url: (await render(sq.json().id)).videoUrl });
    expect(w.headers['content-type']).toBe('video/webm');
    expect(w.rawPayload.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML, the start of a WebM file
  }, 150_000);

  it('keeps a GIF short and small', async () => {
    const big = await c.inject({ method: 'POST', url: `/api/projects/${example}/renders`, payload: { format: 'gif', size: 720, sceneId: 's2' } });
    expect(big.statusCode).toBe(400);
    expect(big.json().error).toMatch(/540 lignes/);
  });

  it('validates options', async () => {
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { format: 'avi' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { aspect: '21:9' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { size: 480 } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { width: 777 } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { style: 'oil' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'POST', url: `/api/projects/${blank}/renders`, payload: { sceneId: 'nope' } })).statusCode).toBe(400);
  });

  it('cancels a running render and removes nothing but the job', async () => {
    const r = await c.inject({ method: 'POST', url: `/api/projects/${example}/renders`, payload: { width: 640, quality: 'draft' } });
    const id = r.json().id;
    await until(async () => { const j = await render(id); return j.status === 'running' && j.framesDone > 0; });
    expect((await c.inject({ method: 'POST', url: `/api/renders/${id}/cancel` })).json().status).toBe('canceled');
    await runner.idle();
    const j = await render(id);
    expect(j.status).toBe('canceled');
    expect(existsSync(join(rendersDir, `${id}.mp4`))).toBe(false);
    expect((await c.inject({ method: 'DELETE', url: `/api/renders/${id}` })).statusCode).toBe(204);
  }, 90_000);

  it('lists renders of a project and deletes a finished one with its file', async () => {
    const list = (await c.inject({ url: `/api/projects/${blank}/renders` })).json();
    expect(list.map((x: { id: string }) => x.id)).toContain(done);
    expect(existsSync(join(rendersDir, `${done}.mp4`))).toBe(true);
    expect((await c.inject({ method: 'DELETE', url: `/api/renders/${done}` })).statusCode).toBe(204);
    expect(existsSync(join(rendersDir, `${done}.mp4`))).toBe(false);
  });
});

describe('queue', () => {
  it('gives a job to one worker only, and puts back jobs whose worker went silent', async () => {
    await runner.stop();
    const job = await enqueue(db, blank, 1, null, { style: 'flat', width: 640, crf: 28, subtitles: false }, 120);
    const [a, b] = await Promise.all([claim(db, 'w1'), claim(db, 'w2')]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual([job.id]);
    await db.query(`UPDATE renders SET heartbeat_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);
    expect(await requeueStale(db)).toBe(1);
    expect((await render(job.id)).status).toBe('queued');
    await claim(db, 'w3');
    await db.query(`UPDATE renders SET heartbeat_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);
    await requeueStale(db);
    expect((await render(job.id))).toMatchObject({ status: 'failed', error: expect.stringContaining('interrompu') });
    runner = startRunner({ db, rendersDir, voicesDir, threads: 0, pollMs: 50 });
  });
});

describe('runner', () => {
  it('creates its videos folder (the soundtrack is written there before the first frame)', async () => {
    const dir = join(rendersDir, 'nested', 'renders'), r = startRunner({ db, rendersDir: dir, voicesDir, threads: 0, pollMs: 50 });
    expect(existsSync(dir)).toBe(true);
    await r.stop();
  });
});

describe('signed links', () => {
  it('render routes need a session, a signed video link does not', async () => {
    const job = await enqueue(db, blank, 1, null, { style: 'flat', width: 640, crf: 28, subtitles: false }, 120);
    expect((await app.inject({ url: `/api/renders/${job.id}` })).statusCode).toBe(401);
    // not rendered yet: the link is valid but there is no video, so 404 and not 401
    expect((await app.inject({ url: `/api/renders/${job.id}/video?${signer(key).sign(job.id)}` })).statusCode).toBe(404);
  });
});
