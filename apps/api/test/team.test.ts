import type { FastifyInstance } from 'fastify';
import { encodeWav, SR } from '@af/audio';
import type { PostFetch } from '@af/providers';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { signer } from '../src/render/sign';
import { buildServer } from '../src/server';
import { signIn, signUp, type Client } from './client';
import { openTestDb } from './testdb';

const tone = encodeWav({ sampleRate: SR, channels: [Float32Array.from({ length: SR }, (_, i) => Math.sin(i / 20) * 0.2)] });
const postFetch: PostFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => tone.buffer.slice(tone.byteOffset, tone.byteOffset + tone.byteLength) as ArrayBuffer });
let db: Db, app: FastifyInstance, owner: Client;
const invite = async (by: Client, role: string, email?: string) => {
  const r = await by.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role, ...(email ? { email } : {}) } });
  expect(r.statusCode).toBe(201);
  return r.json().path.replace('/invite/', '') as string;
};

beforeAll(async () => {
  db = await openTestDb();
  const key = randomBytes(32);
  app = await buildServer({ db, box: secretBox(key), signer: signer(key), voicesDir: mkdtempSync(join(tmpdir(), 'af-v-')), postFetch, signup: 'open' });
  owner = await signUp(app, 'owner@example.org', { name: 'Olga' });
});
afterAll(async () => { await app.close(); await db.close(); });

describe('invitations', () => {
  it('lets a person join with the role given, once', async () => {
    const token = await invite(owner, 'editor');
    expect((await app.inject(`/api/invitations/${token}`)).json()).toMatchObject({ workspace: 'Mon espace', role: 'editor' });
    const ed = await signUp(app, 'ed@example.org', { name: 'Ed', invitation: token });
    expect(ed.workspaces).toEqual([{ id: owner.workspaces[0]!.id, name: 'Mon espace', role: 'editor' }]);
    expect((await app.inject(`/api/invitations/${token}`)).statusCode).toBe(404);
    const members = (await owner.inject('/api/workspace')).json().members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`);
    expect(members).toEqual(['Olga:owner', 'Ed:editor']);
  });

  it('can be kept for one e-mail, revoked, or accepted by someone already signed in', async () => {
    const only = await invite(owner, 'viewer', 'vi@example.org');
    expect((await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { 'x-requested-with': 'animation-flow' }, payload: { email: 'intrus@example.org', name: 'I', password: 'mot-de-passe-solide-1', invitation: only } })).statusCode).toBe(400);
    await signUp(app, 'vi@example.org', { name: 'Vi', invitation: only });
    const revoked = await invite(owner, 'editor');
    const list = (await owner.inject('/api/workspace')).json().invitations;
    await owner.inject({ method: 'DELETE', url: `/api/workspace/invitations/${list[0].id}` });
    expect((await app.inject(`/api/invitations/${revoked}`)).statusCode).toBe(404);
    const outsider = await signUp(app, 'out@example.org', { name: 'Out' }); // open sign-up: own workspace
    const t = await invite(owner, 'viewer');
    const r = await outsider.inject({ method: 'POST', url: `/api/invitations/${t}/accept` });
    expect(r.json().workspaces.map((w: { role: string }) => w.role).sort()).toEqual(['owner', 'viewer']);
  });
});

describe('roles', () => {
  let ed: Client, vi: Client, projectId = '';
  beforeAll(async () => { ed = await signIn(app, 'ed@example.org'); vi = await signIn(app, 'vi@example.org'); });

  it('viewers read, editors write, admins manage keys', async () => {
    const created = await ed.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank', title: 'Film d’Ed' } });
    expect(created.statusCode).toBe(201);
    projectId = created.json().id;
    expect(created.json()).toMatchObject({ createdBy: 'Ed', updatedBy: 'Ed' });
    expect((await vi.inject(`/api/projects/${projectId}`)).statusCode).toBe(200);
    expect((await vi.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank' } })).statusCode).toBe(403);
    expect((await vi.inject({ method: 'PUT', url: `/api/projects/${projectId}`, payload: { project: created.json().project, baseVersion: 1 } })).statusCode).toBe(403);
    expect((await vi.inject({ method: 'POST', url: `/api/projects/${projectId}/renders`, payload: {} })).statusCode).toBe(403);
    expect((await vi.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Bonjour' } })).statusCode).toBe(403);
    expect((await ed.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'x', apiKey: 'sk-aaaaaaaaaaaaa' } })).statusCode).toBe(403);
    expect((await ed.inject({ method: 'PUT', url: '/api/assignments/storyboard', payload: { credentialId: null, model: '' } })).statusCode).toBe(403);
    expect((await ed.inject({ method: 'POST', url: '/api/workspace/invitations', payload: { role: 'viewer' } })).statusCode).toBe(403);
    expect((await owner.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'labo', apiKey: 'sk-aaaaaaaaaaaaa' } })).statusCode).toBe(201);
    expect((await ed.inject('/api/credentials')).json().map((k: { label: string }) => k.label)).toEqual(['labo']);
  });

  it('keeps who saved each version', async () => {
    const p = (await owner.inject(`/api/projects/${projectId}`)).json();
    const saved = await owner.inject({ method: 'PUT', url: `/api/projects/${projectId}`, payload: { project: { ...p.project, title: 'Renommé' }, baseVersion: 1 } });
    expect(saved.json()).toMatchObject({ version: 2, updatedBy: 'Olga', createdBy: 'Ed' });
    expect((await vi.inject(`/api/projects/${projectId}/versions`)).json().map((v: { by: string }) => v.by)).toEqual(['Olga', 'Ed']);
  });

  it('protects the owner, hands ownership over, lets members leave', async () => {
    const members = (await owner.inject('/api/workspace')).json().members as { userId: string; name: string }[];
    const id = (n: string) => members.find((m) => m.name === n)!.userId;
    expect((await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${id('Ed')}`, payload: { role: 'admin' } })).statusCode).toBe(200);
    ed = await signIn(app, 'ed@example.org');
    expect((await ed.inject({ method: 'PATCH', url: `/api/workspace/members/${id('Olga')}`, payload: { role: 'viewer' } })).statusCode).toBe(403);
    expect((await ed.inject({ method: 'DELETE', url: `/api/workspace/members/${id('Olga')}` })).statusCode).toBe(403);
    expect((await ed.inject({ method: 'PATCH', url: `/api/workspace/members/${id('Ed')}`, payload: { role: 'owner' } })).statusCode).toBe(403);
    expect((await owner.inject({ method: 'DELETE', url: `/api/workspace/members/${id('Olga')}` })).statusCode).toBe(403); // the owner cannot just leave
    expect((await owner.inject({ method: 'PATCH', url: `/api/workspace/members/${id('Ed')}`, payload: { role: 'owner' } })).statusCode).toBe(200);
    const roles = (await owner.inject('/api/workspace')).json().members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`);
    expect(roles).toContain('Olga:admin');
    expect(roles).toContain('Ed:owner');
    expect((await vi.inject({ method: 'DELETE', url: `/api/workspace/members/${id('Vi')}` })).statusCode).toBe(204);
    expect((await vi.inject('/api/projects')).statusCode).toBe(409); // no workspace left
  });
});

describe('isolation between workspaces', () => {
  it('another workspace sees none of this one', async () => {
    const other = await signUp(app, 'rival@example.org', { name: 'Rival' });
    const mine = (await owner.inject('/api/projects')).json(), pid = mine[0].id;
    expect((await other.inject(`/api/projects/${pid}`)).statusCode).toBe(404);
    expect((await other.inject({ method: 'PUT', url: `/api/projects/${pid}`, payload: { project: {}, baseVersion: 1 } })).statusCode).toBe(404);
    expect((await other.inject({ method: 'DELETE', url: `/api/projects/${pid}` })).statusCode).toBe(404);
    expect((await other.inject(`/api/projects/${pid}/renders`)).json()).toEqual([]);
    expect((await other.inject('/api/projects')).json()).toEqual([]);
    expect((await other.inject('/api/credentials')).json()).toEqual([]);
    expect((await other.inject('/api/generations')).json()).toEqual([]);
    // pretending to act in the first workspace
    other.ws = owner.workspaces[0]!.id;
    expect((await other.inject('/api/projects')).statusCode).toBe(403);
    other.ws = null;
    // a render of the first workspace, asked for by id
    const job = (await owner.inject({ method: 'POST', url: `/api/projects/${pid}/renders`, payload: { width: 640, quality: 'draft' } })).json();
    expect((await other.inject(`/api/renders/${job.id}`)).statusCode).toBe(404);
    expect((await other.inject({ method: 'POST', url: `/api/renders/${job.id}/cancel` })).statusCode).toBe(404);
  });

  it('recordings are kept apart even for the same text and voice', async () => {
    const setup = async (c: Client) => {
      const k = (await c.inject({ method: 'POST', url: '/api/credentials', payload: { provider: 'openai', label: 'voix', apiKey: 'sk-voice-aaaaaaaaaa' } })).json();
      await c.inject({ method: 'PUT', url: '/api/assignments/narration', payload: { credentialId: k.id, model: 'tts-1', voice: 'nova' } });
    };
    const other = await signIn(app, 'rival@example.org');
    const own = await signIn(app, 'owner@example.org'); // Olga is admin now; Ed owns the workspace
    await setup(own); await setup(other);
    const a = (await own.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Même texte.' } })).json();
    const b = (await other.inject({ method: 'POST', url: '/api/voices', payload: { text: 'Même texte.' } })).json();
    expect(a.asset).not.toBe(b.asset);
    expect((await other.inject({ method: 'POST', url: '/api/voices/links', payload: { assets: [a.asset] } })).json()).toEqual({});
    expect((await app.inject(a.url)).statusCode).toBe(200);
    expect((await app.inject(a.url.replace(own.workspaces[0]!.id, other.workspaces[0]!.id))).statusCode).toBe(403);
  });
});

describe('several workspaces', () => {
  it('creates, switches with the header, and deletes on typed confirmation', async () => {
    const c = await signIn(app, 'out@example.org');
    const ws = (await c.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'Atelier' } })).json();
    c.ws = ws.id;
    expect((await c.inject({ method: 'POST', url: '/api/projects', payload: { template: 'blank', title: 'Dans l’atelier' } })).statusCode).toBe(201);
    expect((await c.inject('/api/projects')).json().map((p: { title: string }) => p.title)).toEqual(['Dans l’atelier']);
    expect((await c.inject({ method: 'DELETE', url: '/api/workspace', payload: { confirm: 'atelier' } })).statusCode).toBe(400);
    expect((await c.inject({ method: 'DELETE', url: '/api/workspace', payload: { confirm: 'Atelier' } })).statusCode).toBe(204);
    expect((await db.query(`SELECT 1 FROM projects WHERE title = 'Dans l’atelier'`)).rows).toEqual([]);
    c.ws = null;
    expect((await c.inject('/api/workspaces')).json().map((w: { name: string }) => w.name)).not.toContain('Atelier');
  });
});
