import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import { migrate, openDb } from '../src/db';
import { adoptLegacyVoices } from '../src/routes/voices';
import { buildServer } from '../src/server';
import { signUp } from './client';

describe('upgrading a database from before accounts', () => {
  it('keeps every project, key, model choice and recording, handed to the first account', async () => {
    const db = await openDb({ url: null, memory: true });
    await migrate(db, 4); // the schema as it was before accounts (migration 5 adds them)
    const box = secretBox(randomBytes(32)), pid = randomUUID(), cid = randomUUID();
    await db.query(`INSERT INTO projects (id, title, data) VALUES ($1, 'Ancien film', '{}')`, [pid]);
    await db.query(`INSERT INTO project_versions (project_id, version, data) VALUES ($1, 1, '{}')`, [pid]);
    await db.query(`INSERT INTO credentials (id, provider, label, secret, hint) VALUES ($1, 'openai', 'ancienne clé', $2, '…abcd')`, [cid, box.seal('sk-old-key-abcd')]);
    await db.query(`INSERT INTO model_assignments (task, credential_id, model) VALUES ('storyboard', $1, 'gpt-old')`, [cid]);
    await db.query(`INSERT INTO generations (id, status, input) VALUES ($1, 'done', '{}')`, [randomUUID()]);
    const voices = mkdtempSync(join(tmpdir(), 'af-v-')), asset = 'a'.repeat(32);
    mkdirSync(voices, { recursive: true }); writeFileSync(join(voices, `${asset}.wav`), 'RIFF');

    expect(await migrate(db)).toBe(1);
    const ws = (await db.query<{ id: string }>('SELECT id FROM workspaces')).rows;
    expect(ws).toHaveLength(1);
    for (const t of ['projects', 'credentials', 'model_assignments', 'generations']) {
      expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE workspace_id = $1`, [ws[0]!.id])).rows[0]!.n, t).toBe(1);
    }
    expect(adoptLegacyVoices(voices, ws[0]!.id)).toBe(1);
    expect(existsSync(join(voices, ws[0]!.id, `${asset}.wav`))).toBe(true);

    const app = await buildServer({ db, box, voicesDir: voices });
    const owner = await signUp(app, 'first@example.org');
    expect(owner.workspaces).toEqual([{ id: ws[0]!.id, name: 'Mon espace', role: 'owner' }]);
    expect((await owner.inject('/api/projects')).json().map((p: { title: string }) => p.title)).toEqual(['Ancien film']);
    expect((await owner.inject('/api/credentials')).json().map((c: { label: string }) => c.label)).toEqual(['ancienne clé']);
    expect((await owner.inject('/api/assignments')).json()).toContainEqual({ task: 'storyboard', credentialId: cid, model: 'gpt-old', voice: '' });
    expect(Object.keys((await owner.inject({ method: 'POST', url: '/api/voices/links', payload: { assets: [asset] } })).json())).toEqual([asset]);
    await app.close(); await db.close();
  });
});
