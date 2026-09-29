// Model providers and API keys. A key goes in once (POST / PATCH), is sealed before it is stored, and never comes
// back out: listings show the provider, the label and a hint (…a3F9). Tests and model calls open it server-side.
// Keys and model choices belong to a workspace; members see them (masked), admins manage them.
import { maskKey, PROVIDERS, providerById, taskById, TASKS, testCredential, type FetchLike } from '@af/providers';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SecretBox } from '../crypto';
import { wsOf } from '../auth/context';
import type { Db } from '../db';

interface Row { id: string; provider: string; label: string; secret: string | null; hint: string; base_url: string | null; created_at: Date; last_tested_at: Date | null; last_test_ok: boolean | null }
const view = (r: Row) => ({ id: r.id, provider: r.provider, label: r.label, hint: r.hint, baseUrl: r.base_url, createdAt: r.created_at, lastTestedAt: r.last_tested_at, lastTestOk: r.last_test_ok });
const Uuid = z.object({ id: z.string().uuid() });
const Url = z.string().url().refine((u) => /^https?:\/\//.test(u), 'adresse http(s) attendue');
const Input = z.object({ provider: z.string(), label: z.string().trim().min(1).max(80), apiKey: z.string().trim().min(1).max(4096).optional(), baseUrl: Url.optional() });
const Patch = z.object({ label: z.string().trim().min(1).max(80).optional(), apiKey: z.string().trim().min(1).max(4096).optional(), baseUrl: Url.nullable().optional() });

export function providerRoutes(app: FastifyInstance, db: Db, box: SecretBox, fetchImpl: FetchLike) {
  const load = async (id: string, ws: string) => (await db.query<Row>('SELECT * FROM credentials WHERE id = $1 AND workspace_id = $2', [id, ws])).rows[0];

  app.get('/api/providers', { config: { auth: 'user' } }, async () => ({ providers: PROVIDERS, tasks: TASKS }));

  app.get('/api/credentials', { config: { role: 'viewer' } }, async (req) => (await db.query<Row>('SELECT * FROM credentials WHERE workspace_id = $1 ORDER BY created_at', [wsOf(req).id])).rows.map(view));

  app.post('/api/credentials', { config: { role: 'admin' } }, async (req, reply) => {
    const b = Input.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'requête invalide', issues: b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const p = providerById(b.data.provider);
    if (!p) return reply.code(400).send({ error: `fournisseur inconnu : ${b.data.provider}` });
    if (!b.data.apiKey && !p.keyOptional) return reply.code(400).send({ error: 'clé manquante' });
    if (p.needsBaseUrl && !b.data.baseUrl) return reply.code(400).send({ error: 'adresse du serveur manquante' });
    const id = randomUUID(), ws = wsOf(req).id;
    await db.query('INSERT INTO credentials (id, provider, label, secret, hint, base_url, workspace_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, p.id, b.data.label, b.data.apiKey ? box.seal(b.data.apiKey) : null, maskKey(b.data.apiKey), b.data.baseUrl ?? null, ws]);
    return reply.code(201).send(view((await load(id, ws))!));
  });

  app.patch('/api/credentials/:id', { config: { role: 'admin' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = Patch.safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const ws = wsOf(req).id, row = await load(p.data.id, ws);
    if (!row) return reply.code(404).send({ error: 'clé introuvable' });
    const { label, apiKey, baseUrl } = b.data;
    // the key goes wherever the address says: moving a stored key to another address needs the key itself, typed again
    // (otherwise any administrator could send the owner's key to a server of theirs and read it there)
    if (baseUrl !== undefined && (baseUrl ?? null) !== row.base_url && row.secret && !apiKey) return reply.code(400).send({ error: "changer l'adresse du serveur demande de saisir la clé à nouveau" });
    await db.query(`UPDATE credentials SET label = $2, secret = $3, hint = $4, base_url = $5, last_tested_at = CASE WHEN $6 THEN NULL ELSE last_tested_at END, last_test_ok = CASE WHEN $6 THEN NULL ELSE last_test_ok END WHERE id = $1`,
      [row.id, label ?? row.label, apiKey ? box.seal(apiKey) : row.secret, apiKey ? maskKey(apiKey) : row.hint, baseUrl === undefined ? row.base_url : baseUrl, !!apiKey || baseUrl !== undefined]);
    return view((await load(row.id, ws))!);
  });

  app.delete('/api/credentials/:id', { config: { role: 'admin' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const r = p.success ? await db.query('DELETE FROM credentials WHERE id = $1 AND workspace_id = $2 RETURNING id', [p.data.id, wsOf(req).id]) : { rows: [] };
    return r.rows.length ? reply.code(204).send() : reply.code(404).send({ error: 'clé introuvable' });
  });

  app.post('/api/credentials/:id/test', { config: { role: 'admin' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), row = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!row) return reply.code(404).send({ error: 'clé introuvable' });
    let apiKey: string | undefined;
    try { apiKey = row.secret ? box.open(row.secret) : undefined; }
    catch { return reply.code(500).send({ error: "la clé ne peut pas être déchiffrée (APP_ENCRYPTION_KEY a changé ?) : saisissez-la de nouveau" }); }
    const result = await testCredential(row.provider, { apiKey, baseUrl: row.base_url ?? undefined }, fetchImpl);
    await db.query('UPDATE credentials SET last_tested_at = now(), last_test_ok = $2 WHERE id = $1', [row.id, result.ok]);
    return result;
  });

  app.get('/api/assignments', { config: { role: 'viewer' } }, async (req) => {
    const { rows } = await db.query<{ task: string; credential_id: string | null; model: string; voice: string }>('SELECT task, credential_id, model, voice FROM model_assignments WHERE workspace_id = $1', [wsOf(req).id]);
    return TASKS.map((t) => { const r = rows.find((x) => x.task === t.id); return { task: t.id, credentialId: r?.credential_id ?? null, model: r?.model ?? '', voice: r?.voice ?? '' }; });
  });

  app.put('/api/assignments/:task', { config: { role: 'admin' } }, async (req, reply) => {
    const task = taskById((req.params as { task: string }).task);
    const b = z.object({ credentialId: z.string().uuid().nullable(), model: z.string().max(200).default(''), voice: z.string().max(200).default('') }).safeParse(req.body);
    if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
    if (!b.success) return reply.code(400).send({ error: 'requête invalide' });
    if (b.data.credentialId) {
      const c = await load(b.data.credentialId, wsOf(req).id), p = c && providerById(c.provider);
      if (!c || !p) return reply.code(400).send({ error: 'clé introuvable' });
      if (!p.kinds.includes(task.kind)) return reply.code(400).send({ error: `${p.label} ne fournit pas de modèle pour « ${task.label} »` });
    }
    await db.query(`INSERT INTO model_assignments (workspace_id, task, credential_id, model, voice, updated_at) VALUES ($5, $1, $2, $3, $4, now())
                    ON CONFLICT (workspace_id, task) DO UPDATE SET credential_id = EXCLUDED.credential_id, model = EXCLUDED.model, voice = EXCLUDED.voice, updated_at = now()`, [task.id, b.data.credentialId, b.data.model, b.data.voice, wsOf(req).id]);
    return { task: task.id, credentialId: b.data.credentialId, model: b.data.model, voice: b.data.voice };
  });
}
