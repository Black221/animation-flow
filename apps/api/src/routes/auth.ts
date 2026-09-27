// Accounts: sign up (the very first account, an invitation, or open sign-up), sign in, sign out, profile.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { userOf } from '../auth/context';
import { dummyHash, hashPassword, PASSWORD_RULE, passwordOk, verifyPassword } from '../auth/password';
import { createSession, endOtherSessions, endSession, hashToken, setSessionCookie } from '../auth/sessions';
import type { Db, Queryable } from '../db';

export type SignupMode = 'invite' | 'open';
const Email = z.string().trim().toLowerCase().email('adresse e-mail invalide').max(200);

/** tries per e-mail and per address over 15 minutes, in memory (one process) */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  hit(key: string) { const now = Date.now(), h = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs); h.push(now); this.hits.set(key, h); if (this.hits.size > 10000) this.hits.clear(); return h.length <= this.max; }
  reset(key: string) { this.hits.delete(key); }
}

export async function workspacesOf(db: Queryable, userId: string) {
  return (await db.query<{ id: string; name: string; role: string }>(`SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.created_at`, [userId])).rows;
}

/** an invitation still usable, by its token */
export async function openInvitation(db: Queryable, token: string) {
  const { rows } = await db.query<{ id: string; workspace_id: string; workspace: string; role: string; email: string | null; expires_at: Date }>(
    `SELECT i.id, i.workspace_id, w.name AS workspace, i.role, i.email, i.expires_at FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, [hashToken(token)]);
  return rows[0] ?? null;
}

export async function acceptInvitation(q: Queryable, inv: { id: string; workspace_id: string; role: string }, userId: string) {
  await q.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO NOTHING`, [inv.workspace_id, userId, inv.role]);
  await q.query(`UPDATE invitations SET accepted_by = $2, accepted_at = now() WHERE id = $1`, [inv.id, userId]);
}

export function authRoutes(app: FastifyInstance, db: Db, signup: SignupMode) {
  const logins = new Limiter(10, 15 * 60_000), signups = new Limiter(20, 60 * 60_000);
  const ip = (req: FastifyRequest) => req.ip;
  const me = async (userId: string) => {
    const { rows } = await db.query<{ id: string; email: string; name: string; created_at: Date }>('SELECT id, email, name, created_at FROM users WHERE id = $1', [userId]);
    return { user: rows[0], workspaces: await workspacesOf(db, userId) };
  };
  const hasUsers = async () => (await db.query('SELECT 1 FROM users LIMIT 1')).rows.length > 0;

  app.get('/api/auth/me', { config: { auth: 'public' } }, async (req) => {
    const setup = !(await hasUsers());
    if (!req.ctx) return { user: null, workspaces: [], signup, setup };
    return { ...(await me(req.ctx.user.id)), signup, setup };
  });

  app.post('/api/auth/signup', { config: { auth: 'public' } }, async (req, reply) => {
    const b = z.object({ email: Email, name: z.string().trim().min(1).max(80), password: z.string(), invitation: z.string().max(200).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    if (!passwordOk(b.data.password)) return reply.code(400).send({ error: `mot de passe : ${PASSWORD_RULE}` });
    if (!signups.hit(ip(req))) return reply.code(429).send({ error: 'trop de tentatives : réessayez plus tard' });
    const inv = b.data.invitation ? await openInvitation(db, b.data.invitation) : null;
    if (b.data.invitation && !inv) return reply.code(400).send({ error: 'invitation invalide ou expirée' });
    if (inv?.email && inv.email !== b.data.email) return reply.code(400).send({ error: `cette invitation est réservée à ${inv.email}` });
    const first = !(await hasUsers());
    if (!first && !inv && signup !== 'open') return reply.code(403).send({ error: 'inscription sur invitation seulement' });
    const id = randomUUID(), hash = await hashPassword(b.data.password);
    try {
      await db.tx(async (q) => {
        await q.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, b.data.email, b.data.name, hash]);
        if (inv) return acceptInvitation(q, inv, id);
        // the first account takes over the workspace holding the data from before accounts existed
        const orphan = first ? (await q.query<{ id: string }>(`SELECT w.id FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id) ORDER BY w.created_at LIMIT 1`)).rows[0] : undefined;
        const ws = orphan?.id ?? randomUUID();
        if (!orphan) await q.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [ws, `Espace de ${b.data.name}`]);
        await q.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws, id]);
      });
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return reply.code(409).send({ error: 'un compte existe déjà avec cette adresse' });
      throw e;
    }
    setSessionCookie(req, reply, await createSession(db, id, String(req.headers['user-agent'] ?? '')));
    return reply.code(201).send({ ...(await me(id)), signup, setup: false });
  });

  app.post('/api/auth/login', { config: { auth: 'public' } }, async (req, reply) => {
    const b = z.object({ email: Email, password: z.string().max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'e-mail et mot de passe attendus' });
    const key = `${b.data.email}|${ip(req)}`;
    if (!logins.hit(key) || !logins.hit(`ip|${ip(req)}`)) return reply.code(429).send({ error: 'trop de tentatives : réessayez dans quelques minutes' });
    const { rows } = await db.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [b.data.email]);
    const ok = await verifyPassword(b.data.password, rows[0]?.password_hash ?? (await dummyHash()));
    if (!rows[0] || !ok) return reply.code(401).send({ error: 'e-mail ou mot de passe incorrect' });
    logins.reset(key);
    setSessionCookie(req, reply, await createSession(db, rows[0].id, String(req.headers['user-agent'] ?? '')));
    return { ...(await me(rows[0].id)), signup, setup: false };
  });

  app.post('/api/auth/logout', { config: { auth: 'public' } }, async (req, reply) => {
    if (req.ctx) await endSession(db, req.ctx.user.sessionId);
    setSessionCookie(req, reply, null);
    return { ok: true };
  });

  app.patch('/api/auth/me', { config: { auth: 'user' } }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), password: z.object({ current: z.string(), next: z.string() }).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'requête invalide' });
    const u = userOf(req);
    if (b.data.name) await db.query('UPDATE users SET name = $2 WHERE id = $1', [u.id, b.data.name]);
    if (b.data.password) {
      if (!passwordOk(b.data.password.next)) return reply.code(400).send({ error: `nouveau mot de passe : ${PASSWORD_RULE}` });
      const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.id]);
      if (!(await verifyPassword(b.data.password.current, rows[0]!.password_hash))) return reply.code(400).send({ error: 'mot de passe actuel incorrect' });
      await db.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [u.id, await hashPassword(b.data.password.next)]);
      await endOtherSessions(db, u.id, u.sessionId); // everywhere else is signed out
    }
    return me(u.id);
  });

  // invitations, as seen by the person invited (before or after signing in)
  app.get('/api/invitations/:token', { config: { auth: 'public' } }, async (req, reply) => {
    const inv = await openInvitation(db, (req.params as { token: string }).token);
    if (!inv) return reply.code(404).send({ error: 'invitation invalide, expirée ou déjà utilisée' });
    return { workspace: inv.workspace, role: inv.role, email: inv.email, expiresAt: inv.expires_at };
  });
  app.post('/api/invitations/:token/accept', { config: { auth: 'user' } }, async (req, reply) => {
    const inv = await openInvitation(db, (req.params as { token: string }).token);
    if (!inv) return reply.code(404).send({ error: 'invitation invalide, expirée ou déjà utilisée' });
    const u = userOf(req);
    if (inv.email && inv.email !== u.email) return reply.code(403).send({ error: `cette invitation est réservée à ${inv.email}` });
    await db.tx((q) => acceptInvitation(q, inv, u.id));
    return { workspace: { id: inv.workspace_id, name: inv.workspace, role: inv.role }, workspaces: await workspacesOf(db, u.id) };
  });
}
