// The community: publish a project, watch it without an account, like it, remix it into another workspace (media
// included), publish the remix; who may withdraw what; nobody's e-mail is ever shown.
import { encodeWav } from '@af/audio';
import { textHash } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

let db: Db, app: FastifyInstance, awa: Client, ben: Client;
const voicesDir = mkdtempSync(join(tmpdir(), 'af-cv-')), communityDir = mkdtempSync(join(tmpdir(), 'af-cc-'));
const anon = (url: string, method: 'GET' | 'POST' = 'GET') => app.inject({ method, url, headers: { 'x-requested-with': 'animation-flow' } });
const VOICE = 'a1'.repeat(16);

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir, communityDir, signup: 'open' });
  awa = await signUp(app, 'awa@example.org', { name: 'Awa' });
  ben = await signUp(app, 'ben@example.org', { name: 'Ben' });
});
afterAll(async () => { await app.close(); await db.close(); });

describe('community', () => {
  let projectId = '', pubId = '';
  it('publishes a saved project with its recordings, for anyone to watch', async () => {
    projectId = (await awa.inject({ method: 'POST', url: '/api/projects', payload: { template: 'pizza' } })).json().id;
    // one recorded line (as the voices route would have stored it)
    const doc = (await awa.inject({ url: `/api/projects/${projectId}` })).json(), ws = awa.workspaces[0]!.id;
    mkdirSync(join(voicesDir, ws), { recursive: true });
    writeFileSync(join(voicesDir, ws, `${VOICE}.wav`), encodeWav({ sampleRate: 48000, channels: [new Float32Array(4800).fill(0.1)] }, 16));
    const line = doc.project.scenes[0].narration[0];
    line.audio = { asset: VOICE, textHash: textHash(line.text) }; line.duration = 0.1;
    expect((await awa.inject({ method: 'PUT', url: `/api/projects/${projectId}`, payload: { project: doc.project, baseVersion: doc.version } })).statusCode).toBe(200);

    expect((await awa.inject({ url: `/api/projects/${projectId}/publication` })).json().publication).toBeNull();
    const r = await awa.inject({ method: 'POST', url: `/api/projects/${projectId}/publish`, payload: { title: 'Pizza Time, la pub', description: 'Une pub pour une pizzeria.', tags: ['Pub', 'pizza', 'pizza'], license: 'cc-by-sa' } });
    expect(r.statusCode).toBe(201);
    pubId = r.json().id;
    expect(r.json()).toMatchObject({ title: 'Pizza Time, la pub', tags: ['pub', 'pizza'], license: 'cc-by-sa', author: { name: 'Awa' }, version: 2, remixes: 0, likes: 0 });
    expect((await awa.inject({ url: `/api/projects/${projectId}/publication` })).json().publication.id).toBe(pubId);

    // no account needed to find it, open it, hear it and see it
    const list = (await anon('/api/community')).json();
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([pubId]);
    expect(list.tags).toEqual(expect.arrayContaining([{ tag: 'pub', count: 1 }]));
    const d = (await anon(`/api/community/${pubId}`)).json();
    expect(d.project.title).toBe('Pizza Time');
    expect(d.media.voices).toEqual([VOICE]);
    expect(d.canManage).toBe(false);
    expect(d.licenseLabel).toContain('BY-SA');
    const wav = await anon(`/api/community/${pubId}/voices/${VOICE}.wav`);
    expect(wav.statusCode).toBe(200);
    expect(wav.headers['content-type']).toBe('audio/wav');
    const png = await anon(`/api/community/${pubId}/thumbnail.png`);
    expect(png.statusCode).toBe(200);
    expect(png.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await anon(`/api/community/${pubId}/voices/${'f'.repeat(32)}.wav`)).statusCode).toBe(404);
    expect((await anon(`/api/community/${pubId}/voices/../../etc.wav`)).statusCode).toBe(404);
  });

  it('counts views once per visitor, and likes from signed-in people', async () => {
    expect((await anon(`/api/community/${pubId}/view`, 'POST')).json()).toMatchObject({ counted: true, views: 1 });
    expect((await anon(`/api/community/${pubId}/view`, 'POST')).json()).toEqual({ counted: false });
    expect((await anon(`/api/community/${pubId}/like`, 'POST')).statusCode).toBe(401);
    expect((await ben.inject({ method: 'POST', url: `/api/community/${pubId}/like` })).json()).toEqual({ liked: true, likes: 1 });
    expect((await ben.inject({ method: 'POST', url: `/api/community/${pubId}/like` })).json()).toEqual({ liked: true, likes: 1 });
    expect((await ben.inject({ url: `/api/community/${pubId}` })).json().liked).toBe(true);
    expect((await awa.inject({ url: `/api/community/${pubId}` })).json()).toMatchObject({ liked: false, likes: 1, canManage: true });
    expect((await ben.inject({ method: 'DELETE', url: `/api/community/${pubId}/like` })).json()).toEqual({ liked: false, likes: 0 });
    await ben.inject({ method: 'POST', url: `/api/community/${pubId}/like` });
  });

  let remixId = '', remixPub = '';
  it('remixes into another workspace with its media, and the remix remembers its origin', async () => {
    const r = await ben.inject({ method: 'POST', url: `/api/community/${pubId}/remix` });
    expect(r.statusCode).toBe(201);
    remixId = r.json().id;
    expect(r.json().title).toBe('Pizza Time, la pub (remix)');
    const p = (await ben.inject({ url: `/api/projects/${remixId}` })).json();
    expect(p.project.scenes[0].narration[0].audio.asset).toBe(VOICE);
    expect(existsSync(join(voicesDir, ben.workspaces[0]!.id, `${VOICE}.wav`))).toBe(true); // heard in Ben's workspace too
    const mine = (await ben.inject({ url: '/api/projects' })).json().find((x: { id: string }) => x.id === remixId);
    expect(mine.remixOf).toEqual({ id: pubId, title: 'Pizza Time, la pub' });
    expect((await anon(`/api/community/${pubId}`)).json().remixes).toBe(1);

    // Ben publishes his remix: share-alike stays share-alike
    const pr = await ben.inject({ method: 'POST', url: `/api/projects/${remixId}/publish`, payload: { title: 'Pizza Time, version nuit', tags: ['pizza'], license: 'cc0' } });
    remixPub = pr.json().id;
    expect(pr.json()).toMatchObject({ license: 'cc-by-sa', remixOf: { id: pubId, title: 'Pizza Time, la pub', author: 'Awa' }, author: { name: 'Ben' } });
    expect((await anon(`/api/community/${pubId}`)).json().remixList.map((x: { id: string }) => x.id)).toEqual([remixPub]);
  });

  it('searches, filters by tag and author, sorts, and shows authors by name only', async () => {
    const ids = async (q: string) => (await anon(`/api/community?${q}`)).json().items.map((x: { title: string }) => x.title);
    expect(await ids('q=nuit')).toEqual(['Pizza Time, version nuit']);
    expect(await ids('tag=pub')).toEqual(['Pizza Time, la pub']);
    expect(await ids('sort=remixed')).toEqual(['Pizza Time, la pub', 'Pizza Time, version nuit']);
    expect(await ids(`author=${ben.user.id}`)).toEqual(['Pizza Time, version nuit']);
    expect(await ids('q=100%25')).toEqual([]);
    const author = (await anon(`/api/community/authors/${awa.user.id}`)).json();
    expect(author).toMatchObject({ name: 'Awa', publications: 1, likes: 1, remixes: 1 });
    for (const url of ['/api/community', `/api/community/${pubId}`, `/api/community/${remixPub}`, `/api/community/authors/${awa.user.id}`]) expect((await anon(url)).body).not.toContain('@example.org');
  });

  it('updates a publication from its project, and only its author or their workspace admins withdraw it', async () => {
    const again = await awa.inject({ method: 'POST', url: `/api/projects/${projectId}/publish`, payload: { title: 'Pizza Time !', tags: ['pub'] } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: pubId, title: 'Pizza Time !', license: 'cc-by' });
    expect((await ben.inject({ method: 'DELETE', url: `/api/community/${pubId}` })).statusCode).toBe(403);
    expect((await ben.inject({ method: 'POST', url: `/api/projects/${projectId}/publish`, payload: { title: 'x' } })).statusCode).toBe(404); // not his project
    expect((await awa.inject({ method: 'DELETE', url: `/api/community/${pubId}` })).statusCode).toBe(204);
    expect((await anon(`/api/community/${pubId}`)).statusCode).toBe(404);
    expect(existsSync(join(communityDir, pubId))).toBe(false);
    // the remix lives on, without its origin
    expect((await anon(`/api/community/${remixPub}`)).json().remixOf).toBeNull();
  });

  it('removes a workspace’s publications with it', async () => {
    const ws = ben.workspaces[0]!;
    expect(existsSync(join(communityDir, remixPub))).toBe(true);
    expect((await ben.inject({ method: 'DELETE', url: '/api/workspace', payload: { confirm: ws.name } })).statusCode).toBe(204);
    expect((await anon(`/api/community/${remixPub}`)).statusCode).toBe(404);
    expect(existsSync(join(communityDir, remixPub))).toBe(false);
  });
});
