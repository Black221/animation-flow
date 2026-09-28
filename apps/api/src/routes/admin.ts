// The platform's administration (platform admins only: the first account, and whoever it names): an overview, the
// accounts (their workspaces, plans and usage; suspend, name an admin), a workspace's plan and custom limits, and the
// reports on published films (dismiss, hide from the community, remove). E-mails appear here and nowhere public.
import type { FastifyInstance } from 'fastify';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { userOf } from '../auth/context';
import type { Db } from '../db';
import { PLAN_IDS, PLANS, type Limits, type PlanId, type Quotas } from '../plans';

const Uuid = z.object({ id: z.string().uuid() });
const Limit = z.number().int().min(0).max(10_000_000).nullable();
/** custom limits: a number, null (no limit), or left out (the plan's) */
const Overrides = z.object({
  projects: Limit, members: Limit, storageMb: Limit, generations: Limit, aiActions: Limit, renderMinutes: Limit,
  maxWidth: z.union([z.literal(640), z.literal(960), z.literal(1280), z.literal(1920)]), decorImages: z.boolean(), priority: z.boolean(),
}).partial().strict();

export function adminRoutes(app: FastifyInstance, db: Db, quota: Quotas, communityDir: string) {
  const cfg = { config: { auth: 'admin' as const } };

  app.get('/api/admin/overview', cfg, async () => {
    const n = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0]!.n);
    const byPlan = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<PlanId, number>;
    for (const r of (await db.query<{ plan: PlanId; n: string }>('SELECT plan, count(*) AS n FROM workspaces GROUP BY plan')).rows) byPlan[r.plan] = Number(r.n);
    const paying = (await db.query<{ plan: PlanId; n: string }>(`SELECT plan, count(*) AS n FROM workspaces WHERE billing_status IN ('active', 'trialing', 'past_due') AND plan <> 'free' GROUP BY plan`)).rows;
    const usage = Object.fromEntries((await db.query<{ kind: string; n: number }>(`SELECT kind, COALESCE(sum(amount), 0)::float AS n FROM usage_events WHERE created_at >= date_trunc('month', now()) GROUP BY kind`)).rows.map((r) => [r.kind, Math.round(Number(r.n) * 10) / 10]));
    return {
      plansEnabled: quota.enabled,
      users: await n('SELECT count(*) AS n FROM users'), newUsers: await n(`SELECT count(*) AS n FROM users WHERE created_at >= date_trunc('month', now())`),
      suspended: await n('SELECT count(*) AS n FROM users WHERE suspended_at IS NOT NULL'), activeUsers: await n(`SELECT count(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > now() - interval '30 days'`),
      workspaces: await n('SELECT count(*) AS n FROM workspaces'), byPlan,
      paying: paying.reduce((a, r) => a + Number(r.n), 0), monthlyRevenue: paying.reduce((a, r) => a + Number(r.n) * PLANS[r.plan].price, 0),
      projects: await n('SELECT count(*) AS n FROM projects'), publications: await n('SELECT count(*) AS n FROM publications'),
      usage, openReports: await n(`SELECT count(*) AS n FROM reports WHERE status = 'open'`),
    };
  });

  const List = z.object({ q: z.string().trim().max(100).optional(), filter: z.enum(['all', 'admins', 'suspended', 'paying']).default('all'), limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) });
  app.get('/api/admin/users', cfg, async (req, reply) => {
    const b = List.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const where: string[] = [], args: unknown[] = [];
    if (b.data.q) { args.push(`%${b.data.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); where.push(`(u.name ILIKE $${args.length} OR u.email ILIKE $${args.length})`); }
    if (b.data.filter === 'admins') where.push('u.platform_admin');
    if (b.data.filter === 'suspended') where.push('u.suspended_at IS NOT NULL');
    if (b.data.filter === 'paying') where.push(`EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = u.id AND m.role = 'owner' AND w.plan <> 'free')`);
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${cond}`, args)).rows[0]!.n);
    const users = (await db.query<{ id: string; name: string; email: string; created_at: Date; platform_admin: boolean; suspended_at: Date | null; last_seen: Date | null }>(
      `SELECT u.id, u.name, u.email, u.created_at, u.platform_admin, u.suspended_at, (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM users u ${cond} ORDER BY u.created_at DESC LIMIT ${b.data.limit} OFFSET ${b.data.offset}`, args)).rows;
    const ws = users.length ? (await db.query<{ user_id: string; id: string; name: string; role: string; plan: PlanId }>(
      `SELECT m.user_id, w.id, w.name, m.role, w.plan FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ANY($1::uuid[]) ORDER BY m.created_at`, [users.map((u) => u.id)])).rows : [];
    return {
      total,
      items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at, lastSeenAt: u.last_seen, admin: u.platform_admin, suspended: !!u.suspended_at,
        workspaces: ws.filter((w) => w.user_id === u.id).map((w) => ({ id: w.id, name: w.name, role: w.role, plan: w.plan })) })),
    };
  });

  app.get('/api/admin/users/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const u = p.success ? (await db.query<{ id: string; name: string; email: string; created_at: Date; platform_admin: boolean; suspended_at: Date | null }>('SELECT id, name, email, created_at, platform_admin, suspended_at FROM users WHERE id = $1', [p.data.id])).rows[0] : undefined;
    if (!u) return reply.code(404).send({ error: 'utilisateur introuvable' });
    const ws = (await db.query<{ id: string; name: string; role: string }>('SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.created_at', [u.id])).rows;
    const workspaces = [];
    for (const w of ws) { const pl = await quota.of(w.id); workspaces.push({ ...w, plan: pl.plan, limits: pl.limits, overrides: pl.overrides, billing: pl.billing, usage: await quota.usage(w.id) }); }
    const publications = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM publications WHERE author_id = $1', [u.id])).rows[0]!.n);
    return { id: u.id, name: u.name, email: u.email, createdAt: u.created_at, admin: u.platform_admin, suspended: !!u.suspended_at, suspendedAt: u.suspended_at, workspaces, publications };
  });

  // suspend (the sessions end: signed out everywhere) or restore; name or remove a platform admin — never oneself
  app.patch('/api/admin/users/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ suspended: z.boolean(), admin: z.boolean() }).partial().safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    if (p.data.id === userOf(req).id) return reply.code(400).send({ error: 'vous ne pouvez pas vous suspendre ni vous retirer vos propres droits' });
    const found = (await db.query('SELECT 1 FROM users WHERE id = $1', [p.data.id])).rows.length;
    if (!found) return reply.code(404).send({ error: 'utilisateur introuvable' });
    if (b.data.suspended != null) {
      await db.query('UPDATE users SET suspended_at = $2 WHERE id = $1', [p.data.id, b.data.suspended ? new Date() : null]);
      if (b.data.suspended) await db.query('DELETE FROM sessions WHERE user_id = $1', [p.data.id]);
    }
    if (b.data.admin != null) await db.query('UPDATE users SET platform_admin = $2 WHERE id = $1', [p.data.id, b.data.admin]);
    return { ok: true };
  });

  // a workspace's plan, and limits of its own over the plan's (a gift, a partner, a school)
  app.patch('/api/admin/workspaces/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]).optional(), quotas: Overrides.optional() }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(404).send({ error: 'espace introuvable' });
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    const r = await db.query('SELECT 1 FROM workspaces WHERE id = $1', [p.data.id]);
    if (!r.rows.length) return reply.code(404).send({ error: 'espace introuvable' });
    if (b.data.plan) await db.query('UPDATE workspaces SET plan = $2 WHERE id = $1', [p.data.id, b.data.plan]);
    if (b.data.quotas) await db.query('UPDATE workspaces SET quotas = $2 WHERE id = $1', [p.data.id, JSON.stringify(b.data.quotas as Partial<Limits>)]);
    const pl = await quota.of(p.data.id);
    return { plan: pl.plan, limits: pl.limits, overrides: pl.overrides, usage: await quota.usage(p.data.id) };
  });

  // ---------------------------------------------------------------- moderation
  app.get('/api/admin/reports', cfg, async (req) => {
    const status = z.enum(['open', 'resolved', 'all']).catch('open').parse((req.query as { status?: string }).status);
    const rows = (await db.query<{ id: string; reason: string; message: string; status: string; created_at: Date; resolved_at: Date | null; publication_id: string; title: string; hidden_at: Date | null; author_id: string | null; author: string | null; reporter: string | null; resolver: string | null; reports: string }>(
      `SELECT r.id, r.reason, r.message, r.status, r.created_at, r.resolved_at, p.id AS publication_id, p.title, p.hidden_at, p.author_id, a.name AS author, u.name AS reporter, v.name AS resolver,
              (SELECT count(*) FROM reports x WHERE x.publication_id = p.id AND x.status = 'open') AS reports
         FROM reports r JOIN publications p ON p.id = r.publication_id LEFT JOIN users a ON a.id = p.author_id LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN users v ON v.id = r.resolved_by
        ${status === 'all' ? '' : status === 'open' ? `WHERE r.status = 'open'` : `WHERE r.status <> 'open'`} ORDER BY r.created_at DESC LIMIT 200`)).rows;
    return rows.map((r) => ({ id: r.id, reason: r.reason, message: r.message, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedBy: r.resolver, reporter: r.reporter,
      publication: { id: r.publication_id, title: r.title, hidden: !!r.hidden_at, author: r.author_id ? { id: r.author_id, name: r.author ?? '' } : null, openReports: Number(r.reports) } }));
  });

  // dismiss (nothing wrong), hide (out of the community, its author still sees it) or remove the film; every open
  // report on the same film is settled with it
  app.post('/api/admin/reports/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ action: z.enum(['dismiss', 'hide', 'remove']) }).safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const r = (await db.query<{ publication_id: string }>('SELECT publication_id FROM reports WHERE id = $1', [p.data.id])).rows[0];
    if (!r) return reply.code(404).send({ error: 'signalement introuvable' });
    const status = { dismiss: 'dismissed', hide: 'hidden', remove: 'removed' }[b.data.action];
    await db.query(`UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE publication_id = $1 AND status = 'open'`, [r.publication_id, status, userOf(req).id]);
    if (b.data.action === 'hide') await db.query('UPDATE publications SET hidden_at = now() WHERE id = $1', [r.publication_id]);
    if (b.data.action === 'remove') { await db.query('DELETE FROM publications WHERE id = $1', [r.publication_id]); rmSync(join(communityDir, r.publication_id), { recursive: true, force: true }); }
    return { ok: true, status };
  });

  // a hidden film back in the community (or hidden without a report)
  app.patch('/api/admin/publications/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ hidden: z.boolean() }).safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const r = await db.query('UPDATE publications SET hidden_at = $2 WHERE id = $1 RETURNING id', [p.data.id, b.data.hidden ? new Date() : null]);
    return r.rows.length ? { ok: true } : reply.code(404).send({ error: 'publication introuvable' });
  });
}

