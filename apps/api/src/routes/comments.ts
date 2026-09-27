// Comments on scenes. A thread is pinned to a scene (by id, so it follows the scene when scenes move), optionally
// to an element and a moment of the scene (seconds from its start); replies belong to a thread and share its
// place. Every member comments, viewers included; the author edits or deletes their own comments; editors (and the
// author) resolve or reopen a thread; admins delete any comment. People editing the project live see each change
// at once (event `comments`).
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RANK, userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import type { LiveHub } from '../live/hub';

interface Row {
  id: string; project_id: string; parent_id: string | null; scene_id: string; element_id: string | null; t: number | null; body: string;
  author_id: string | null; author_name: string | null; created_at: Date; edited_at: Date | null; resolved_at: Date | null; resolved_by_name: string | null;
}
const view = (r: Row) => ({
  id: r.id, projectId: r.project_id, parentId: r.parent_id, sceneId: r.scene_id, elementId: r.element_id, t: r.t, body: r.body,
  author: r.author_id ? { id: r.author_id, name: r.author_name } : null, createdAt: r.created_at, editedAt: r.edited_at,
  resolvedAt: r.resolved_at, resolvedBy: r.resolved_by_name,
});
export type CommentView = ReturnType<typeof view>;
const SELECT = `SELECT c.*, a.name AS author_name, rb.name AS resolved_by_name FROM comments c
  JOIN projects p ON p.id = c.project_id LEFT JOIN users a ON a.id = c.author_id LEFT JOIN users rb ON rb.id = c.resolved_by`;
const Uuid = z.object({ id: z.string().uuid() });
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identifiant');
const Body = z.string().trim().min(1, 'commentaire vide').max(4000, '4000 caractères au plus');
const Create = z.object({ body: Body, sceneId: Id.optional(), elementId: Id.nullable().optional(), t: z.number().min(0).max(86_400).nullable().optional(), parentId: z.string().uuid().optional() });
const Patch = z.object({ body: Body.optional(), resolved: z.boolean().optional() }).refine((b) => b.body !== undefined || b.resolved !== undefined, 'rien à changer');

export function commentRoutes(app: FastifyInstance, db: Db, hub?: LiveHub) {
  const load = async (id: string, ws: string) => (await db.query<Row>(`${SELECT} WHERE c.id = $1 AND p.workspace_id = $2`, [id, ws])).rows[0];
  const inWorkspace = async (projectId: string, ws: string) => (await db.query('SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2', [projectId, ws])).rows.length > 0;
  const tell = (projectId: string, data: unknown) => void hub?.emit(projectId, 'comments', data);

  app.get('/api/projects/:id/comments', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), ws = wsOf(req).id;
    if (!p.success || !(await inWorkspace(p.data.id, ws))) return reply.code(404).send({ error: 'projet introuvable' });
    return (await db.query<Row>(`${SELECT} WHERE c.project_id = $1 AND p.workspace_id = $2 ORDER BY c.created_at, c.id`, [p.data.id, ws])).rows.map(view);
  });

  app.post('/api/projects/:id/comments', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = Create.safeParse(req.body), ws = wsOf(req).id;
    if (!p.success || !(await inWorkspace(p.data.id, ws))) return reply.code(404).send({ error: 'projet introuvable' });
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    let { sceneId, elementId = null, t = null } = b.data;
    if (b.data.parentId) {
      // a reply: in the same project, to a thread (not to a reply), at the thread's place
      const parent = await load(b.data.parentId, ws);
      if (!parent || parent.project_id !== p.data.id) return reply.code(400).send({ error: 'fil introuvable' });
      if (parent.parent_id) return reply.code(400).send({ error: 'on répond au fil, pas à une réponse' });
      ({ scene_id: sceneId, element_id: elementId, t } = parent);
    } else if (!sceneId) return reply.code(400).send({ error: 'scène manquante' });
    const id = randomUUID();
    await db.query('INSERT INTO comments (id, project_id, parent_id, scene_id, element_id, t, body, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, p.data.id, b.data.parentId ?? null, sceneId, elementId, t, b.data.body, userOf(req).id]);
    const c = view((await load(id, ws))!);
    tell(p.data.id, { kind: 'upsert', comment: c });
    return reply.code(201).send(c);
  });

  app.patch('/api/comments/:id', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = Patch.safeParse(req.body), ws = wsOf(req);
    const c = p.success ? await load(p.data.id, ws.id) : undefined;
    if (!c) return reply.code(404).send({ error: 'commentaire introuvable' });
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    const me = userOf(req).id, mine = c.author_id === me;
    if (b.data.body !== undefined && !mine) return reply.code(403).send({ error: 'seul l\'auteur modifie son commentaire' });
    if (b.data.resolved !== undefined) {
      if (c.parent_id) return reply.code(400).send({ error: 'on résout le fil, pas une réponse' });
      if (!mine && RANK[ws.role] < RANK.editor) return reply.code(403).send({ error: 'réservé aux éditeurs et à l\'auteur' });
    }
    await db.query(`UPDATE comments SET body = COALESCE($2, body), edited_at = CASE WHEN $2::text IS NULL THEN edited_at ELSE now() END,
                    resolved_at = CASE WHEN $3::boolean IS NULL THEN resolved_at WHEN $3 THEN COALESCE(resolved_at, now()) ELSE NULL END,
                    resolved_by = CASE WHEN $3::boolean IS NULL THEN resolved_by WHEN $3 THEN COALESCE(resolved_by, $4) ELSE NULL END
                    WHERE id = $1`, [c.id, b.data.body ?? null, b.data.resolved ?? null, me]);
    const next = view((await load(c.id, ws.id))!);
    tell(c.project_id, { kind: 'upsert', comment: next });
    return next;
  });

  app.delete('/api/comments/:id', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), ws = wsOf(req);
    const c = p.success ? await load(p.data.id, ws.id) : undefined;
    if (!c) return reply.code(404).send({ error: 'commentaire introuvable' });
    if (c.author_id !== userOf(req).id && RANK[ws.role] < RANK.admin) return reply.code(403).send({ error: 'réservé à l\'auteur et aux administrateurs' });
    await db.query('DELETE FROM comments WHERE id = $1', [c.id]); // replies go with their thread
    tell(c.project_id, { kind: 'delete', id: c.id });
    return reply.code(204).send();
  });
}
