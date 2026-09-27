// The team: the current workspace, its members and their roles, invitation links; creating and deleting
// workspaces. Admins manage members and invitations; only the owner can hand over ownership or delete.
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RANK, userOf, wsOf, type Role } from '../auth/context';
import { hashToken } from '../auth/sessions';
import type { Db } from '../db';
import type { LiveHub } from '../live/hub';
import { workspacesOf } from './auth';

const Uuid = z.string().uuid();

export function workspaceRoutes(app: FastifyInstance, db: Db, dirs: { voicesDir: string }, hub?: LiveHub) {
  app.get('/api/workspaces', { config: { auth: 'user' } }, async (req) => workspacesOf(db, userOf(req).id));

  app.post('/api/workspaces', { config: { auth: 'user' } }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'nom attendu' });
    const id = randomUUID();
    await db.tx(async (q) => {
      await q.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [id, b.data.name]);
      await q.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, userOf(req).id]);
    });
    return reply.code(201).send({ id, name: b.data.name, role: 'owner' });
  });

  app.get('/api/workspace', { config: { role: 'viewer' } }, async (req) => {
    const ws = wsOf(req), admin = RANK[ws.role] >= RANK.admin;
    const members = (await db.query<{ user_id: string; name: string; email: string; role: Role; created_at: Date }>(
      `SELECT m.user_id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`, [ws.id])).rows
      .map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role, joinedAt: m.created_at }));
    const invitations = admin ? (await db.query<{ id: string; role: string; email: string | null; created_at: Date; expires_at: Date; by: string | null }>(
      `SELECT i.id, i.role, i.email, i.created_at, i.expires_at, u.name AS by FROM invitations i LEFT JOIN users u ON u.id = i.created_by
        WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`, [ws.id])).rows
      .map((i) => ({ id: i.id, role: i.role, email: i.email, createdAt: i.created_at, expiresAt: i.expires_at, by: i.by })) : [];
    return { id: ws.id, name: ws.name, role: ws.role, members, invitations };
  });

  app.patch('/api/workspace', { config: { role: 'admin' } }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'nom attendu' });
    await db.query('UPDATE workspaces SET name = $2 WHERE id = $1', [wsOf(req).id, b.data.name]);
    return { ok: true };
  });

  // the link is shown once: only its hash is stored
  app.post('/api/workspace/invitations', { config: { role: 'admin' } }, async (req, reply) => {
    const b = z.object({ role: z.enum(['admin', 'editor', 'viewer']).default('editor'), email: z.string().trim().toLowerCase().email().optional(), days: z.number().int().min(1).max(30).default(7) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invitation invalide' });
    const ws = wsOf(req);
    if (b.data.role === 'admin' && RANK[ws.role] < RANK.admin) return reply.code(403).send({ error: 'réservé aux administrateurs' });
    const token = randomBytes(24).toString('base64url'), id = randomUUID();
    await db.query(`INSERT INTO invitations (id, workspace_id, token_hash, role, email, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
      [id, ws.id, hashToken(token), b.data.role, b.data.email ?? null, userOf(req).id, b.data.days]);
    return reply.code(201).send({ id, role: b.data.role, email: b.data.email ?? null, path: `/invite/${token}`, days: b.data.days });
  });

  app.delete('/api/workspace/invitations/:id', { config: { role: 'admin' } }, async (req, reply) => {
    const id = Uuid.safeParse((req.params as { id: string }).id);
    const r = id.success ? await db.query('UPDATE invitations SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL RETURNING id', [id.data, wsOf(req).id]) : { rows: [] };
    return r.rows.length ? reply.code(204).send() : reply.code(404).send({ error: 'invitation introuvable' });
  });

  app.patch('/api/workspace/members/:userId', { config: { role: 'admin' } }, async (req, reply) => {
    const uid = Uuid.safeParse((req.params as { userId: string }).userId), b = z.object({ role: z.enum(['owner', 'admin', 'editor', 'viewer']) }).safeParse(req.body);
    if (!uid.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const ws = wsOf(req), me = userOf(req).id;
    const target = (await db.query<{ role: Role }>('SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2', [ws.id, uid.data])).rows[0];
    if (!target) return reply.code(404).send({ error: 'membre introuvable' });
    if (target.role === 'owner' && uid.data !== me) return reply.code(403).send({ error: 'le rôle du propriétaire ne change que par transmission' });
    if (b.data.role === 'owner') {
      // handing over: the new owner takes the role, the current one becomes admin
      if (ws.role !== 'owner') return reply.code(403).send({ error: 'seul le propriétaire transmet la propriété' });
      if (uid.data === me) return { ok: true };
      await db.tx(async (q) => {
        await q.query(`UPDATE memberships SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, [ws.id, uid.data]);
        await q.query(`UPDATE memberships SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, [ws.id, me]);
      });
      await hub?.kick(ws.id, uid.data); await hub?.kick(ws.id, me);
      return { ok: true };
    }
    if (target.role === 'owner') return reply.code(403).send({ error: 'transmettez la propriété avant de changer votre rôle' });
    await db.query('UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2', [ws.id, uid.data, b.data.role]);
    await hub?.kick(ws.id, uid.data); // open live editors reconnect with the new role
    return { ok: true };
  });

  // an admin removes a member; anyone can leave (the owner hands over first)
  app.delete('/api/workspace/members/:userId', { config: { role: 'viewer' } }, async (req, reply) => {
    const uid = Uuid.safeParse((req.params as { userId: string }).userId);
    if (!uid.success) return reply.code(400).send({ error: 'requête invalide' });
    const ws = wsOf(req), me = userOf(req).id;
    if (uid.data !== me && RANK[ws.role] < RANK.admin) return reply.code(403).send({ error: 'réservé aux administrateurs' });
    const target = (await db.query<{ role: Role }>('SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2', [ws.id, uid.data])).rows[0];
    if (!target) return reply.code(404).send({ error: 'membre introuvable' });
    if (target.role === 'owner') return reply.code(403).send({ error: "le propriétaire ne peut pas partir : transmettez d'abord la propriété" });
    await db.query('DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2', [ws.id, uid.data]);
    await hub?.kick(ws.id, uid.data);
    return reply.code(204).send();
  });

  // deleting a workspace deletes its projects, keys, renders and recordings: the owner types its name to confirm
  app.delete('/api/workspace', { config: { role: 'owner' } }, async (req, reply) => {
    const ws = wsOf(req), b = z.object({ confirm: z.string() }).safeParse(req.body ?? {});
    if (!b.success || b.data.confirm !== ws.name) return reply.code(400).send({ error: "tapez le nom exact de l'espace pour confirmer" });
    const files = (await db.query<{ file: string | null }>('SELECT r.file FROM renders r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = $1', [ws.id])).rows;
    await db.query('DELETE FROM workspaces WHERE id = $1', [ws.id]);
    await hub?.kick(ws.id);
    for (const f of files) if (f.file) rmSync(f.file, { force: true });
    rmSync(join(dirs.voicesDir, ws.id), { recursive: true, force: true });
    return reply.code(204).send();
  });
}
