// Projects: validated on every write (schema + library check), versioned (every save keeps the previous JSON), and
// protected against lost updates: a save must name the version it started from, or it gets 409 and the current one.
import { checkAgainstLibrary, timeProject, toSrt } from '@af/engine';
import { catalog, registry } from '@af/library';
import { parseProject, projectJsonSchema } from '@af/schema';
import { stylePacks } from '@af/styles';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { TEMPLATES } from '../templates';

interface Row { id: string; title: string; data: unknown; version: number; created_at: Date; updated_at: Date }
const summary = (r: Row) => ({ id: r.id, title: r.title, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
const Uuid = z.object({ id: z.string().uuid() });

export function projectRoutes(app: FastifyInstance, db: Db) {
  const load = async (id: string) => (await db.query<Row>('SELECT * FROM projects WHERE id = $1', [id])).rows[0];

  app.get('/api/library', async () => ({
    catalog,
    styles: Object.values(stylePacks).map((s) => ({ id: s.id, label: s.label, description: s.description })),
    templates: Object.keys(TEMPLATES),
  }));
  app.get('/api/schema', async () => projectJsonSchema());

  app.get('/api/projects', async () => (await db.query<Row>('SELECT id, title, version, created_at, updated_at FROM projects ORDER BY updated_at DESC')).rows.map(summary));

  app.post('/api/projects', async (req, reply) => {
    const body = z.object({ template: z.string().optional(), title: z.string().max(200).optional(), project: z.unknown().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'requête invalide' });
    const { template = 'example', title, project } = body.data;
    if (!project && !TEMPLATES[template]) return reply.code(400).send({ error: `modèle inconnu : ${template}` });
    const parsed = parseProject(project ?? TEMPLATES[template]!(title));
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    const id = randomUUID(), data = JSON.stringify(parsed.project);
    await db.query('INSERT INTO projects (id, title, data) VALUES ($1, $2, $3)', [id, parsed.project.title, data]);
    await db.query('INSERT INTO project_versions (project_id, version, data) VALUES ($1, 1, $2)', [id, data]);
    const row = (await load(id))!;
    return reply.code(201).send({ ...summary(row), project: parsed.project, warnings: checkAgainstLibrary(parsed.project, registry, catalog) });
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const row = p.success ? await load(p.data.id) : undefined;
    if (!row) return reply.code(404).send({ error: 'projet introuvable' });
    const parsed = parseProject(row.data);
    return { ...summary(row), project: row.data, warnings: parsed.ok ? checkAgainstLibrary(parsed.project, registry, catalog) : [] };
  });

  app.put('/api/projects/:id', async (req, reply) => {
    const p = Uuid.safeParse(req.params), body = z.object({ project: z.unknown(), baseVersion: z.number().int() }).safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'requête invalide : { project, baseVersion } attendus' });
    const row = await load(p.data.id);
    if (!row) return reply.code(404).send({ error: 'projet introuvable' });
    if (row.version !== body.data.baseVersion) return reply.code(409).send({ error: 'le projet a été modifié entre-temps', current: { ...summary(row), project: row.data } });
    const parsed = parseProject(body.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    const data = JSON.stringify(parsed.project), version = row.version + 1;
    const upd = await db.query<Row>('UPDATE projects SET data = $1, title = $2, version = $3, updated_at = now() WHERE id = $4 AND version = $5 RETURNING *', [data, parsed.project.title, version, row.id, row.version]);
    if (!upd.rows[0]) return reply.code(409).send({ error: 'le projet a été modifié entre-temps' });
    await db.query('INSERT INTO project_versions (project_id, version, data) VALUES ($1, $2, $3)', [row.id, version, data]);
    return { ...summary(upd.rows[0]), project: parsed.project, warnings: checkAgainstLibrary(parsed.project, registry, catalog) };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const r = p.success ? await db.query('DELETE FROM projects WHERE id = $1 RETURNING id', [p.data.id]) : { rows: [] };
    return r.rows.length ? reply.code(204).send() : reply.code(404).send({ error: 'projet introuvable' });
  });

  app.get('/api/projects/:id/versions', async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success || !(await load(p.data.id))) return reply.code(404).send({ error: 'projet introuvable' });
    return (await db.query<{ version: number; created_at: Date }>('SELECT version, created_at FROM project_versions WHERE project_id = $1 ORDER BY version DESC', [p.data.id])).rows.map((r) => ({ version: r.version, createdAt: r.created_at }));
  });

  app.get('/api/projects/:id/subtitles.srt', async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const row = p.success ? await load(p.data.id) : undefined;
    const parsed = row ? parseProject(row.data) : null;
    if (!parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    return reply.type('application/x-subrip; charset=utf-8').header('content-disposition', 'attachment; filename="sous-titres.srt"').send(toSrt(parsed.project, timeProject(parsed.project)));
  });
}
