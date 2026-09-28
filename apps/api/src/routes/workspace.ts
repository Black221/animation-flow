// The team: the current workspace, its members and their roles, invitation links; creating and deleting
// workspaces. Admins manage members and invitations; only the owner can hand over ownership or delete.
import { publicationsOf } from './community';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RANK, userOf, wsOf, type Role } from '../auth/context';
import { hashToken } from '../auth/sessions';
import type { Db } from '../db';
import type { LiveHub } from '../live/hub';
import { invitationMail, type MailSetup } from '../mail';
import { workspacesOf } from './auth';
import { FREE_WORKSPACES_PER_OWNER, QuotaError, type Quotas } from '../plans';

const Uuid = z.string().uuid();

export function workspaceRoutes(app: FastifyInstance, db: Db, dirs: { voicesDir: string; imagesDir?: string | undefined; communityDir?: string | undefined }, hub: LiveHub | undefined, mail: MailSetup | null, quota: Quotas) {
  app.get('/api/workspaces', { config: { auth: 'user' } }, async (req) => workspacesOf(db, userOf(req).id));

  app.post('/api/workspaces', { config: { auth: 'user' } }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'nom attendu' });
    // free workspaces are not a way round the free plan's limits
    if (quota.enabled) {
      const free = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND m.role = 'owner' AND w.plan = 'free'`, [userOf(req).id])).rows[0]!.n;
      if (free >= FREE_WORKSPACES_PER_OWNER) throw new QuotaError('workspaces', 'free', FREE_WORKSPACES_PER_OWNER, free, `Vous avez déjà ${free} espaces gratuits : passez l'un d'eux à un plan payant pour en créer un autre.`);
    }
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

  // the link is shown once (and, if asked and e-mail is set up, sent to the address): only its hash is stored
  app.post('/api/workspace/invitations', { config: { role: 'admin' } }, async (req, reply) => {
    const b = z.object({ role: z.enum(['admin', 'editor', 'viewer']).default('editor'), email: z.string().trim().toLowerCase().email().optional(), days: z.number().int().min(1).max(30).default(7), send: z.boolean().default(false) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invitation invalide' });
    if (b.data.send && !b.data.email) return reply.code(400).send({ error: "adresse e-mail manquante pour l'envoi" });
    if (b.data.send && !mail) return reply.code(400).send({ error: "l'envoi d'e-mails n'est pas configuré (SMTP_URL)" });
    const ws = wsOf(req);
    if (b.data.role === 'admin' && RANK[ws.role] < RANK.admin) return reply.code(403).send({ error: 'réservé aux administrateurs' });
    await quota.ensure(ws.id, 'members');
    const token = randomBytes(24).toString('base64url'), id = randomUUID();
    await db.query(`INSERT INTO invitations (id, workspace_id, token_hash, role, email, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
      [id, ws.id, hashToken(token), b.data.role, b.data.email ?? null, userOf(req).id, b.data.days]);
    let sent = false, sendError: string | undefined;
    if (b.data.send && mail && b.data.email) {
      try {
        await mail.mailer.send(invitationMail({ to: b.data.email, by: userOf(req).name, workspace: ws.name, role: b.data.role, url: `${mail.appUrl}/invite/${token}`, days: b.data.days }));
        sent = true;
      } catch (e) {
        req.log.error({ err: (e as Error).message }, 'invitation e-mail not sent');
        sendError = "l'e-mail n'a pas pu partir : transmettez le lien vous-même";
      }
    }
    return reply.code(201).send({ id, role: b.data.role, email: b.data.email ?? null, path: `/invite/${token}`, days: b.data.days, sent, ...(sendError ? { sendError } : {}) });
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
    const published = await publicationsOf(db, ws.id);
    await db.query('DELETE FROM workspaces WHERE id = $1', [ws.id]);
    await hub?.kick(ws.id);
    for (const f of files) if (f.file) rmSync(f.file, { force: true });
    rmSync(join(dirs.voicesDir, ws.id), { recursive: true, force: true });
    if (dirs.imagesDir) rmSync(join(dirs.imagesDir, ws.id), { recursive: true, force: true });
    if (dirs.communityDir) for (const id of published) rmSync(join(dirs.communityDir, id), { recursive: true, force: true });
    return reply.code(204).send();
  });
}
