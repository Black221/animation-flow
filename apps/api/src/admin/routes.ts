// The back office's API (served by the back-office server only, to the platform's managers): the overview, the accounts, the
// workspaces (plan, custom limits, members, usage, billing), the subscriptions, the community's films (reports,
// hiding, removing), the plans as configured, and the audit log. Every write says who did what to what, in the log.
// E-mails appear here and nowhere public.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { userOf } from '../auth/context';
import type { PaidPlan } from '../billing';
import type { Db, Queryable } from '../db';
import { PLAN_IDS, PLANS, planList, type Limits, type PlanId, type Quotas } from '../plans';

const Uuid = z.object({ id: z.string().uuid() });
const Limit = z.number().int().min(0).max(10_000_000).nullable();
/** custom limits: a number, null (no limit), or left out (the plan's) */
const Overrides = z.object({
  projects: Limit, members: Limit, storageMb: Limit, generations: Limit, aiActions: Limit, renderMinutes: Limit,
  maxWidth: z.union([z.literal(640), z.literal(960), z.literal(1280), z.literal(1920)]), decorImages: z.boolean(), priority: z.boolean(),
}).partial().strict();
const Page = { limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).max(100_000).default(0) };
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** one line of the audit log */
export async function audit(db: Queryable, who: { id: string; name: string }, ip: string | null, action: string, targetType: string, targetId: string | null, summary: string) {
  await db.query('INSERT INTO admin_audit (id, admin_id, admin_name, action, target_type, target_id, summary, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [randomUUID(), who.id, who.name, action, targetType, targetId, summary.slice(0, 500), ip]);
}

export function adminRoutes(app: FastifyInstance, db: Db, quota: Quotas, communityDir: string, billing: { payments: boolean; prices: Record<PaidPlan, string> | null }) {
  const cfg = { config: { auth: 'admin' as const } };
  const log = (req: FastifyRequest, action: string, type: string, id: string | null, summary: string) => audit(db, userOf(req), req.ip, action, type, id, summary);
  const nameOf = async (table: 'users' | 'workspaces' | 'publications', id: string) => (await db.query<{ n: string }>(`SELECT ${table === 'publications' ? 'title' : 'name'} AS n FROM ${table} WHERE id = $1`, [id])).rows[0]?.n ?? null;

  // ---------------------------------------------------------------- overview
  app.get('/api/admin/overview', cfg, async () => {
    const n = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0]!.n);
    const byPlan = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<PlanId, number>;
    for (const r of (await db.query<{ plan: PlanId; n: string }>('SELECT plan, count(*) AS n FROM workspaces GROUP BY plan')).rows) byPlan[r.plan] = Number(r.n);
    const paying = (await db.query<{ plan: PlanId; n: string }>(`SELECT plan, count(*) AS n FROM workspaces WHERE billing_status IN ('active', 'trialing', 'past_due') AND plan <> 'free' GROUP BY plan`)).rows;
    const usage = Object.fromEntries((await db.query<{ kind: string; n: number }>(`SELECT kind, COALESCE(sum(amount), 0)::float AS n FROM usage_events WHERE created_at >= date_trunc('month', now()) GROUP BY kind`)).rows.map((r) => [r.kind, Math.round(Number(r.n) * 10) / 10]));
    // sign-ups of the last 30 days, day by day (days without any included)
    const days = (await db.query<{ d: string; n: string }>(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, count(*) AS n FROM users WHERE created_at > now() - interval '30 days' GROUP BY 1`)).rows;
    const signups = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10); return { day: d, count: Number(days.find((x) => x.d === d)?.n ?? 0) }; });
    return {
      plansEnabled: quota.enabled, payments: billing.payments,
      users: await n('SELECT count(*) AS n FROM users'), newUsers: await n(`SELECT count(*) AS n FROM users WHERE created_at >= date_trunc('month', now())`),
      suspended: await n('SELECT count(*) AS n FROM users WHERE suspended_at IS NOT NULL'), activeUsers: await n(`SELECT count(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > now() - interval '30 days'`),
      workspaces: await n('SELECT count(*) AS n FROM workspaces'), byPlan,
      paying: paying.reduce((a, r) => a + Number(r.n), 0), monthlyRevenue: paying.reduce((a, r) => a + Number(r.n) * PLANS[r.plan].price, 0),
      pastDue: await n(`SELECT count(*) AS n FROM workspaces WHERE billing_status = 'past_due'`),
      projects: await n('SELECT count(*) AS n FROM projects'), publications: await n('SELECT count(*) AS n FROM publications'), hidden: await n('SELECT count(*) AS n FROM publications WHERE hidden_at IS NOT NULL'),
      renders: await n(`SELECT count(*) AS n FROM renders WHERE created_at >= date_trunc('month', now())`), queued: await n(`SELECT count(*) AS n FROM renders WHERE status IN ('queued', 'running')`),
      usage, openReports: await n(`SELECT count(*) AS n FROM reports WHERE status = 'open'`), signups,
    };
  });

  // ---------------------------------------------------------------- accounts
  const Users = z.object({ q: z.string().trim().max(100).optional(), filter: z.enum(['all', 'suspended', 'paying']).default('all'), ...Page });
  app.get('/api/admin/users', cfg, async (req, reply) => {
    const b = Users.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const where: string[] = [], args: unknown[] = [];
    if (b.data.q) { args.push(like(b.data.q)); where.push(`(u.name ILIKE $${args.length} OR u.email ILIKE $${args.length})`); }
    if (b.data.filter === 'suspended') where.push('u.suspended_at IS NOT NULL');
    if (b.data.filter === 'paying') where.push(`EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = u.id AND m.role = 'owner' AND w.plan <> 'free')`);
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${cond}`, args)).rows[0]!.n);
    const users = (await db.query<{ id: string; name: string; email: string; created_at: Date; suspended_at: Date | null; last_seen: Date | null }>(
      `SELECT u.id, u.name, u.email, u.created_at, u.suspended_at, (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM users u ${cond} ORDER BY u.created_at DESC LIMIT ${b.data.limit} OFFSET ${b.data.offset}`, args)).rows;
    const ws = users.length ? (await db.query<{ user_id: string; id: string; name: string; role: string; plan: PlanId }>(
      `SELECT m.user_id, w.id, w.name, m.role, w.plan FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ANY($1::uuid[]) ORDER BY m.created_at`, [users.map((u) => u.id)])).rows : [];
    return {
      total,
      items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at, lastSeenAt: u.last_seen, suspended: !!u.suspended_at,
        workspaces: ws.filter((w) => w.user_id === u.id).map((w) => ({ id: w.id, name: w.name, role: w.role, plan: w.plan })) })),
    };
  });

  app.get('/api/admin/users/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const u = p.success ? (await db.query<{ id: string; name: string; email: string; created_at: Date; suspended_at: Date | null }>('SELECT id, name, email, created_at, suspended_at FROM users WHERE id = $1', [p.data.id])).rows[0] : undefined;
    if (!u) return reply.code(404).send({ error: 'utilisateur introuvable' });
    const ws = (await db.query<{ id: string; name: string; role: string }>('SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.created_at', [u.id])).rows;
    const workspaces = [];
    for (const w of ws) { const pl = await quota.of(w.id); workspaces.push({ ...w, plan: pl.plan, limits: pl.limits, overrides: pl.overrides, billing: pl.billing, usage: await quota.usage(w.id) }); }
    const count = async (sql: string) => Number((await db.query<{ n: string }>(sql, [u.id])).rows[0]!.n);
    return {
      id: u.id, name: u.name, email: u.email, createdAt: u.created_at, suspended: !!u.suspended_at, suspendedAt: u.suspended_at, workspaces,
      publications: await count('SELECT count(*) AS n FROM publications WHERE author_id = $1'),
      sessions: await count(`SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND expires_at > now()`),
      lastSeenAt: (await db.query<{ t: Date | null }>(`SELECT max(last_seen_at) AS t FROM sessions WHERE user_id = $1`, [u.id])).rows[0]?.t ?? null,
    };
  });

  // suspend a user of the platform (the sessions end: signed out everywhere) or restore them
  app.patch('/api/admin/users/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ suspended: z.boolean() }).strict().safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const name = await nameOf('users', p.data.id);
    if (name == null) return reply.code(404).send({ error: 'utilisateur introuvable' });
    {
      await db.query('UPDATE users SET suspended_at = $2 WHERE id = $1', [p.data.id, b.data.suspended ? new Date() : null]);
      if (b.data.suspended) await db.query('DELETE FROM sessions WHERE user_id = $1', [p.data.id]);
      await log(req, b.data.suspended ? 'suspend' : 'restore', 'user', p.data.id, `${b.data.suspended ? 'a suspendu' : 'a réactivé'} ${name}`);
    }
    return { ok: true };
  });

  // signed out everywhere (a lost phone, a shared computer), without suspending
  app.post('/api/admin/users/:id/signout', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), name = p.success ? await nameOf('users', p.data.id) : null;
    if (!p.success || name == null) return reply.code(404).send({ error: 'utilisateur introuvable' });
    const r = await db.query(`DELETE FROM sessions WHERE user_id = $1 RETURNING id`, [p.data.id]);
    await log(req, 'signout', 'user', p.data.id, `a déconnecté ${name} partout (${r.rows.length} session(s))`);
    return { ended: r.rows.length };
  });

  // ---------------------------------------------------------------- workspaces
  const Spaces = z.object({ q: z.string().trim().max(100).optional(), plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]).optional(), billing: z.enum(['any', 'subscribed', 'past_due', 'custom']).default('any'), ...Page });
  const OWNER = `LEFT JOIN LATERAL (SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) o ON true`;
  app.get('/api/admin/workspaces', cfg, async (req, reply) => {
    const b = Spaces.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const where: string[] = [], args: unknown[] = [];
    if (b.data.q) { args.push(like(b.data.q)); where.push(`(w.name ILIKE $${args.length} OR o.name ILIKE $${args.length} OR o.email ILIKE $${args.length})`); }
    if (b.data.plan) { args.push(b.data.plan); where.push(`w.plan = $${args.length}`); }
    if (b.data.billing === 'subscribed') where.push(`w.billing_status IN ('active', 'trialing', 'past_due')`);
    if (b.data.billing === 'past_due') where.push(`w.billing_status = 'past_due'`);
    if (b.data.billing === 'custom') where.push(`w.quotas <> '{}'::jsonb`);
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM workspaces w ${OWNER} ${cond}`, args)).rows[0]!.n);
    const rows = (await db.query<{ id: string; name: string; plan: PlanId; billing_status: string | null; plan_renews_at: Date | null; quotas: object; created_at: Date; owner_id: string | null; owner_name: string | null; owner_email: string | null; members: string; projects: string }>(
      `SELECT w.id, w.name, w.plan, w.billing_status, w.plan_renews_at, w.quotas, w.created_at, o.id AS owner_id, o.name AS owner_name, o.email AS owner_email,
              (SELECT count(*) FROM memberships m WHERE m.workspace_id = w.id) AS members, (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id) AS projects
         FROM workspaces w ${OWNER} ${cond} ORDER BY w.created_at DESC LIMIT ${b.data.limit} OFFSET ${b.data.offset}`, args)).rows;
    return {
      total,
      items: rows.map((r) => ({ id: r.id, name: r.name, plan: r.plan, billingStatus: r.billing_status, renewsAt: r.plan_renews_at, custom: Object.keys(r.quotas ?? {}).length > 0, createdAt: r.created_at,
        owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? '', email: r.owner_email ?? '' } : null, members: Number(r.members), projects: Number(r.projects) })),
    };
  });

  app.get('/api/admin/workspaces/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const w = p.success ? (await db.query<{ id: string; name: string; created_at: Date; stripe_customer_id: string | null; stripe_subscription_id: string | null }>('SELECT id, name, created_at, stripe_customer_id, stripe_subscription_id FROM workspaces WHERE id = $1', [p.data.id])).rows[0] : undefined;
    if (!w) return reply.code(404).send({ error: 'espace introuvable' });
    const pl = await quota.of(w.id);
    const members = (await db.query<{ user_id: string; name: string; email: string; role: string; created_at: Date }>('SELECT m.user_id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at', [w.id])).rows;
    const recent = (await db.query<{ kind: string; amount: number; created_at: Date; who: string | null }>(`SELECT e.kind, e.amount, e.created_at, u.name AS who FROM usage_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.workspace_id = $1 ORDER BY e.created_at DESC LIMIT 20`, [w.id])).rows;
    const n = async (sql: string) => Number((await db.query<{ n: string }>(sql, [w.id])).rows[0]!.n);
    return {
      id: w.id, name: w.name, createdAt: w.created_at, plan: pl.plan, limits: pl.limits, overrides: pl.overrides, usage: await quota.usage(w.id),
      billing: { ...pl.billing, customerId: w.stripe_customer_id, subscriptionId: w.stripe_subscription_id },
      members: members.map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role, joinedAt: m.created_at })),
      projects: await n('SELECT count(*) AS n FROM projects WHERE workspace_id = $1'), publications: await n('SELECT count(*) AS n FROM publications WHERE workspace_id = $1'),
      recentUsage: recent.map((e) => ({ kind: e.kind, amount: Math.round(Number(e.amount) * 10) / 10, at: e.created_at, by: e.who })),
    };
  });

  // a workspace's plan, and limits of its own over the plan's (a gift, a partner, a school)
  app.patch('/api/admin/workspaces/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]).optional(), quotas: Overrides.optional() }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(404).send({ error: 'espace introuvable' });
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    const name = await nameOf('workspaces', p.data.id);
    if (name == null) return reply.code(404).send({ error: 'espace introuvable' });
    if (b.data.plan) { await db.query('UPDATE workspaces SET plan = $2 WHERE id = $1', [p.data.id, b.data.plan]); await log(req, 'set-plan', 'workspace', p.data.id, `a passé « ${name} » au plan ${PLANS[b.data.plan].label}`); }
    if (b.data.quotas) {
      await db.query('UPDATE workspaces SET quotas = $2 WHERE id = $1', [p.data.id, JSON.stringify(b.data.quotas as Partial<Limits>)]);
      const said = Object.entries(b.data.quotas).map(([k, v]) => `${k} ${v === null ? 'illimité' : v}`).join(', ');
      await log(req, 'set-limits', 'workspace', p.data.id, said ? `a fixé pour « ${name} » : ${said}` : `a remis « ${name} » aux limites de son plan`);
    }
    const pl = await quota.of(p.data.id);
    return { plan: pl.plan, limits: pl.limits, overrides: pl.overrides, usage: await quota.usage(p.data.id) };
  });

  // ---------------------------------------------------------------- subscriptions
  app.get('/api/admin/subscriptions', cfg, async () => {
    const rows = (await db.query<{ id: string; name: string; plan: PlanId; billing_status: string | null; plan_renews_at: Date | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; owner: string | null; email: string | null }>(
      `SELECT w.id, w.name, w.plan, w.billing_status, w.plan_renews_at, w.stripe_customer_id, w.stripe_subscription_id, o.name AS owner, o.email
         FROM workspaces w ${OWNER}
        WHERE w.billing_status IS NOT NULL OR w.plan <> 'free' ORDER BY (w.billing_status = 'past_due') DESC NULLS LAST, w.plan_renews_at NULLS LAST, w.name LIMIT 500`)).rows;
    const items = rows.map((r) => ({ id: r.id, name: r.name, plan: r.plan, status: r.billing_status, renewsAt: r.plan_renews_at, customerId: r.stripe_customer_id, subscriptionId: r.stripe_subscription_id, owner: r.owner ? { name: r.owner, email: r.email ?? '' } : null,
      source: (r.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(r.billing_status ?? '') ? 'stripe' : r.plan !== 'free' ? 'granted' : 'ended') as 'stripe' | 'granted' | 'ended' }));
    const paid = items.filter((i) => i.source === 'stripe');
    return {
      payments: billing.payments, items,
      revenue: PLAN_IDS.filter((p) => p !== 'free').map((p) => ({ plan: p, count: paid.filter((i) => i.plan === p).length, monthly: paid.filter((i) => i.plan === p).length * PLANS[p].price })),
    };
  });

  // ---------------------------------------------------------------- the plans, as this server has them
  app.get('/api/admin/plans', cfg, async () => ({ enabled: quota.enabled, payments: billing.payments, prices: billing.prices, plans: planList() }));

  // ---------------------------------------------------------------- the community's films
  const Pubs = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['all', 'visible', 'hidden', 'reported']).default('all'), ...Page });
  app.get('/api/admin/publications', cfg, async (req, reply) => {
    const b = Pubs.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const where: string[] = [], args: unknown[] = [];
    if (b.data.q) { args.push(like(b.data.q)); where.push(`(p.title ILIKE $${args.length} OR a.name ILIKE $${args.length})`); }
    if (b.data.status === 'visible') where.push('p.hidden_at IS NULL');
    if (b.data.status === 'hidden') where.push('p.hidden_at IS NOT NULL');
    if (b.data.status === 'reported') where.push(`EXISTS (SELECT 1 FROM reports r WHERE r.publication_id = p.id AND r.status = 'open')`);
    const from = 'FROM publications p LEFT JOIN users a ON a.id = p.author_id', cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n ${from} ${cond}`, args)).rows[0]!.n);
    const rows = (await db.query<{ id: string; title: string; created_at: Date; hidden_at: Date | null; likes: number; views: number; remixes: number; duration: number; author_id: string | null; author: string | null; reports: string }>(
      `SELECT p.id, p.title, p.created_at, p.hidden_at, p.likes, p.views, p.remixes, p.duration, p.author_id, a.name AS author,
              (SELECT count(*) FROM reports r WHERE r.publication_id = p.id AND r.status = 'open') AS reports
         ${from} ${cond} ORDER BY p.created_at DESC LIMIT ${b.data.limit} OFFSET ${b.data.offset}`, args)).rows;
    return { total, items: rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, hidden: !!r.hidden_at, likes: r.likes, views: r.views, remixes: r.remixes, duration: r.duration, author: r.author_id ? { id: r.author_id, name: r.author ?? '' } : null, openReports: Number(r.reports) })) };
  });

  const removePublication = async (id: string) => { await db.query('DELETE FROM publications WHERE id = $1', [id]); rmSync(join(communityDir, id), { recursive: true, force: true }); };

  // a film hidden (out of the community, its author still sees it) or back
  app.patch('/api/admin/publications/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ hidden: z.boolean() }).safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const r = await db.query<{ title: string }>('UPDATE publications SET hidden_at = $2 WHERE id = $1 RETURNING title', [p.data.id, b.data.hidden ? new Date() : null]);
    if (!r.rows.length) return reply.code(404).send({ error: 'publication introuvable' });
    await log(req, b.data.hidden ? 'hide' : 'unhide', 'publication', p.data.id, `${b.data.hidden ? 'a masqué' : 'a remis dans la communauté'} « ${r.rows[0]!.title} »`);
    return { ok: true };
  });
  app.delete('/api/admin/publications/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), title = p.success ? await nameOf('publications', p.data.id) : null;
    if (!p.success || title == null) return reply.code(404).send({ error: 'publication introuvable' });
    await removePublication(p.data.id);
    await log(req, 'remove', 'publication', p.data.id, `a retiré « ${title} » de la communauté`);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- reports
  app.get('/api/admin/reports', cfg, async (req) => {
    const status = z.enum(['open', 'resolved', 'all']).catch('open').parse((req.query as { status?: string }).status);
    const rows = (await db.query<{ id: string; reason: string; message: string; status: string; created_at: Date; resolved_at: Date | null; publication_id: string; title: string; hidden_at: Date | null; author_id: string | null; author: string | null; reporter: string | null; resolver: string | null; reports: string }>(
      `SELECT r.id, r.reason, r.message, r.status, r.created_at, r.resolved_at, p.id AS publication_id, p.title, p.hidden_at, p.author_id, a.name AS author, u.name AS reporter, v.name AS resolver,
              (SELECT count(*) FROM reports x WHERE x.publication_id = p.id AND x.status = 'open') AS reports
         FROM reports r JOIN publications p ON p.id = r.publication_id LEFT JOIN users a ON a.id = p.author_id LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN staff v ON v.id = r.resolved_by
        ${status === 'all' ? '' : status === 'open' ? `WHERE r.status = 'open'` : `WHERE r.status <> 'open'`} ORDER BY r.created_at DESC LIMIT 200`)).rows;
    return rows.map((r) => ({ id: r.id, reason: r.reason, message: r.message, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedBy: r.resolver, reporter: r.reporter,
      publication: { id: r.publication_id, title: r.title, hidden: !!r.hidden_at, author: r.author_id ? { id: r.author_id, name: r.author ?? '' } : null, openReports: Number(r.reports) } }));
  });

  // dismiss (nothing wrong), hide or remove the film; every open report on the same film is settled with it
  app.post('/api/admin/reports/:id', cfg, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ action: z.enum(['dismiss', 'hide', 'remove']) }).safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const r = (await db.query<{ publication_id: string; title: string }>('SELECT r.publication_id, p.title FROM reports r JOIN publications p ON p.id = r.publication_id WHERE r.id = $1', [p.data.id])).rows[0];
    if (!r) return reply.code(404).send({ error: 'signalement introuvable' });
    const status = { dismiss: 'dismissed', hide: 'hidden', remove: 'removed' }[b.data.action];
    await db.query(`UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE publication_id = $1 AND status = 'open'`, [r.publication_id, status, userOf(req).id]);
    if (b.data.action === 'hide') await db.query('UPDATE publications SET hidden_at = now() WHERE id = $1', [r.publication_id]);
    if (b.data.action === 'remove') await removePublication(r.publication_id);
    await log(req, `report-${b.data.action}`, 'publication', r.publication_id, `${{ dismiss: 'a classé sans suite les signalements de', hide: 'a masqué, sur signalement,', remove: 'a retiré, sur signalement,' }[b.data.action]} « ${r.title} »`);
    return { ok: true, status };
  });

  // ---------------------------------------------------------------- the audit log
  const Audit = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: Page.offset });
  app.get('/api/admin/audit', cfg, async (req, reply) => {
    const b = Audit.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const args: unknown[] = b.data.q ? [like(b.data.q)] : [], cond = b.data.q ? 'WHERE summary ILIKE $1 OR admin_name ILIKE $1 OR action ILIKE $1' : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM admin_audit ${cond}`, args)).rows[0]!.n);
    const rows = (await db.query<{ id: string; admin_id: string | null; admin_name: string; action: string; target_type: string; target_id: string | null; summary: string; ip: string | null; created_at: Date }>(
      `SELECT * FROM admin_audit ${cond} ORDER BY created_at DESC LIMIT ${b.data.limit} OFFSET ${b.data.offset}`, args)).rows;
    return { total, items: rows.map((r) => ({ id: r.id, admin: { id: r.admin_id, name: r.admin_name }, action: r.action, target: { type: r.target_type, id: r.target_id }, summary: r.summary, ip: r.ip, at: r.created_at })) };
  });
}
