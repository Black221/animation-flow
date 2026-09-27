// Projects: validated on every write (schema + library check), versioned (every save keeps the previous JSON with
// its author), and protected against lost updates: a save must name the version it started from, or it gets 409
// and the current one. Everything is scoped to the current workspace: another workspace's project is "not found".
import { checkAgainstLibrary, timeProject, toSrt } from '@af/engine';
import { catalog, registry } from '@af/library';
import { parseProject, projectJsonSchema } from '@af/schema';
import { stylePacks } from '@af/styles';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import { logReset, saveLog, type LiveHub } from '../live/hub';
import { TEMPLATES } from '../templates';

interface Row { id: string; title: string; data: unknown; version: number; remix_of: string | null; publication_id: string | null; remix_title: string | null; created_at: Date; updated_at: Date; updated_by_name: string | null; created_by_name: string | null }
const summary = (r: Row) => ({ id: r.id, title: r.title, version: r.version, remixOf: r.remix_of ? { id: r.remix_of, title: r.remix_title ?? '' } : null, publicationId: r.publication_id, createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by_name, createdBy: r.created_by_name });
const Uuid = z.object({ id: z.string().uuid() });
const SELECT = `SELECT p.*, uu.name AS updated_by_name, cu.name AS created_by_name,
  (SELECT id FROM publications pub WHERE pub.project_id = p.id) AS publication_id, (SELECT title FROM publications o WHERE o.id = p.remix_of) AS remix_title FROM projects p
  LEFT JOIN users uu ON uu.id = p.updated_by LEFT JOIN users cu ON cu.id = p.created_by`;

export function projectRoutes(app: FastifyInstance, db: Db, hub?: LiveHub) {
  const load = async (id: string, ws: string) => (await db.query<Row>(`${SELECT} WHERE p.id = $1 AND p.workspace_id = $2`, [id, ws])).rows[0];

  app.get('/api/library', { config: { auth: 'user' } }, async () => ({
    catalog,
    styles: Object.values(stylePacks).map((s) => ({ id: s.id, label: s.label, description: s.description })),
    templates: Object.keys(TEMPLATES),
  }));
  app.get('/api/schema', { config: { auth: 'user' } }, async () => projectJsonSchema());
  // a template as a project (the home page plays one as a showcase; nothing in them is private)
  app.get('/api/templates/:name', { config: { auth: 'public' } }, async (req, reply) => {
    const make = TEMPLATES[(req.params as { name: string }).name];
    if (!make) return reply.code(404).send({ error: 'modèle inconnu' });
    reply.header('cache-control', 'public, max-age=3600');
    return make();
  });

  app.get('/api/projects', { config: { role: 'viewer' } }, async (req) =>
    (await db.query<Row>(`${SELECT} WHERE p.workspace_id = $1 ORDER BY p.updated_at DESC`, [wsOf(req).id])).rows.map(summary));

  app.post('/api/projects', { config: { role: 'editor' } }, async (req, reply) => {
    const body = z.object({ template: z.string().optional(), title: z.string().max(200).optional(), project: z.unknown().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'requête invalide' });
    const { template = 'example', title, project } = body.data;
    if (!project && !TEMPLATES[template]) return reply.code(400).send({ error: `modèle inconnu : ${template}` });
    const parsed = parseProject(project ?? TEMPLATES[template]!(title));
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    const id = randomUUID(), data = JSON.stringify(parsed.project), ws = wsOf(req).id, by = userOf(req).id;
    await db.tx(async (q) => {
      await q.query('INSERT INTO projects (id, title, data, workspace_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)', [id, parsed.project.title, data, ws, by]);
      await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, 1, $2, $3)', [id, data, by]);
    });
    const row = (await load(id, ws))!;
    return reply.code(201).send({ ...summary(row), project: parsed.project, warnings: checkAgainstLibrary(parsed.project, registry, catalog) });
  });

  app.get('/api/projects/:id', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const row = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!row) return reply.code(404).send({ error: 'projet introuvable' });
    const parsed = parseProject(row.data);
    return { ...summary(row), project: row.data, warnings: parsed.ok ? checkAgainstLibrary(parsed.project, registry, catalog) : [] };
  });

  app.put('/api/projects/:id', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), body = z.object({ project: z.unknown(), baseVersion: z.number().int() }).safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'requête invalide : { project, baseVersion } attendus' });
    const ws = wsOf(req).id, user = userOf(req);
    if (!(await load(p.data.id, ws))) return reply.code(404).send({ error: 'projet introuvable' });
    const parsed = parseProject(body.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    const data = JSON.stringify(parsed.project);
    const result = await db.tx(async (q) => {
      // people editing it live (in any process): their changes become a version first, so the version compared
      // below is the real latest one
      await saveLog(q, p.data.id, null);
      const cur = (await q.query<{ version: number }>('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [p.data.id])).rows[0]!;
      if (cur.version !== body.data.baseVersion) return null;
      const version = cur.version + 1;
      await q.query('UPDATE projects SET data = $1, title = $2, version = $3, updated_at = now(), updated_by = $5 WHERE id = $4', [data, parsed.project.title, version, p.data.id, user.id]);
      await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, $2, $3, $4)', [p.data.id, version, data, user.id]);
      await logReset(q, p.data.id, parsed.project, version, user, `enregistré par ${user.name}`); // everyone editing live restarts from it
      return version;
    });
    const row = (await load(p.data.id, ws))!;
    if (result == null) return reply.code(409).send({ error: 'le projet a été modifié entre-temps', current: { ...summary(row), project: row.data } });
    return { ...summary((await load(row.id, ws))!), project: parsed.project, warnings: checkAgainstLibrary(parsed.project, registry, catalog) };
  });

  app.delete('/api/projects/:id', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const r = p.success ? await db.query('DELETE FROM projects WHERE id = $1 AND workspace_id = $2 RETURNING id', [p.data.id, wsOf(req).id]) : { rows: [] };
    if (r.rows.length) await hub?.closeProject(p.data!.id);
    return r.rows.length ? reply.code(204).send() : reply.code(404).send({ error: 'projet introuvable' });
  });

  app.get('/api/projects/:id/versions', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success || !(await load(p.data.id, wsOf(req).id))) return reply.code(404).send({ error: 'projet introuvable' });
    return (await db.query<{ version: number; created_at: Date; name: string | null }>(
      'SELECT v.version, v.created_at, u.name FROM project_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.project_id = $1 ORDER BY v.version DESC', [p.data.id])).rows
      .map((r) => ({ version: r.version, createdAt: r.created_at, by: r.name }));
  });

  app.get('/api/projects/:id/subtitles.srt', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const row = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    const parsed = row ? parseProject(row.data) : null;
    if (!parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    return reply.type('application/x-subrip; charset=utf-8').header('content-disposition', 'attachment; filename="sous-titres.srt"').send(toSrt(parsed.project, timeProject(parsed.project)));
  });
}
