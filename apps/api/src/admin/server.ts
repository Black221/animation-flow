// The back office: the platform manager's tool, a server of its own on its own port (only this machine by default:
// reach it through a VPN, an SSH tunnel or a reverse proxy that asks who you are), serving its own app and only the
// administration API. Its accounts are not the platform's users: managers (the platform's staff) have their own
// accounts, sessions and invitations; a user of the platform administers their own workspace in the app, never here.
// The first manager is created with a setup secret (ADMIN_SETUP_TOKEN, or one written to a file on the server).
// Sessions: their own cookie, SameSite=Strict, 12 hours, never extended, checked again at every request. Every
// write carries its own CSRF header and is written to the audit log.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { readCookie } from '../auth/sessions';
import { dummyHash, hashPassword, PASSWORD_RULE, passwordOk, verifyPassword } from '../auth/password';
import type { RouteAuth } from '../auth/context';
import type { StripeConfig } from '../billing';
import type { Db, Queryable } from '../db';
import { QuotaError, quotas } from '../plans';
import { adminRoutes, audit } from './routes';
import { VERSION } from '../version';
import { isApiRequest, requestIsHttps, securityHeaders } from '../net/headers';

export const ADMIN_COOKIE = 'af_admin';
export const ADMIN_CSRF = 'animation-flow-admin';
const HOURS = 12, INVITE_DAYS = 3;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const Email = z.string().trim().toLowerCase().email('adresse e-mail invalide').max(200);

export interface AdminServerDeps {
  db: Db;
  voicesDir: string; imagesDir: string; communityDir: string;
  plans?: boolean;
  stripe?: StripeConfig | null;
  /** the built back-office app to serve */
  adminDist?: string | null;
  logger?: boolean;
  trustProxy?: boolean | number | string;
  /** only these addresses (exact, or IPv4 ranges like 10.0.0.0/8) may reach it; none: any that reaches the port */
  allowedIps?: string[];
  /** the app's public address: links from the back office to the films, to the app */
  appUrl?: string | null;
  /** the secret that creates the first manager; without it, one is made and written to `setupTokenFile` */
  setupToken?: string | null;
  setupTokenFile?: string | null;
  /** where it is reached (for the setup link written to the file) */
  publicUrl?: string | null;
}

/** exact addresses and IPv4 ranges (a.b.c.d/n); IPv4 seen through IPv6 (::ffff:a.b.c.d) counts as IPv4 */
export function ipAllowed(ip: string, list: string[]): boolean {
  if (!list.length) return true;
  const v4 = (s: string) => { const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(s); return m ? m.slice(1).reduce((a, x) => a * 256 + Number(x), 0) : null; };
  const addr = v4(ip);
  return list.some((rule) => {
    const [base, bits] = rule.split('/');
    if (bits === undefined) return rule === ip || (addr != null && v4(rule) === addr);
    const b = v4(base ?? ''), n = Number(bits);
    if (addr == null || b == null || !(n >= 0 && n <= 32)) return false;
    return Math.floor(addr / 2 ** (32 - n)) === Math.floor(b / 2 ** (32 - n));
  });
}

/** a manager account (the setup, an invitation, a test) */
export async function createManager(db: Queryable, m: { email: string; name: string; password: string; createdBy?: string | null }) {
  const id = randomUUID(), email = m.email.trim().toLowerCase(), name = m.name.trim();
  await db.query('INSERT INTO staff (id, email, name, password_hash, created_by) VALUES ($1, $2, $3, $4, $5)', [id, email, name, await hashPassword(m.password), m.createdBy ?? null]);
  return { id, email, name };
}

const secure = (req: FastifyRequest) => process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && requestIsHttps(req));
const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string | null) =>
  reply.header('set-cookie', `${ADMIN_COOKIE}=${token ? encodeURIComponent(token) : ''}; Max-Age=${token ? HOURS * 3600 : 0}; Path=/; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`);

/** tries per key over 15 minutes, in memory */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number) {}
  private live(key: string) { const now = Date.now(); return (this.hits.get(key) ?? []).filter((t) => now - t < 15 * 60_000); }
  blocked(key: string) { return this.live(key).length >= this.max; }
  hit(key: string) { const h = this.live(key); h.push(Date.now()); this.hits.set(key, h); if (this.hits.size > 10_000) this.hits.clear(); }
  reset(key: string) { this.hits.delete(key); }
}
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function buildAdminServer(deps: AdminServerDeps): Promise<FastifyInstance> {
  const { db } = deps, allowed = deps.allowedIps ?? [];
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: (deps.trustProxy ?? false) as boolean,
    logger: deps.logger ? { level: 'info', redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], censor: '[masqué]' } } : false,
  });
  app.decorateRequest('ctx', null);

  const noManager = async () => !(await db.query('SELECT 1 FROM staff LIMIT 1')).rows.length;
  // the setup secret, while there is no manager: given, or made here and written to a file only the server's owner
  // reads (its path is logged, never the secret)
  let setupToken: string | null = null;
  if (await noManager()) {
    setupToken = deps.setupToken ?? randomBytes(24).toString('base64url');
    if (!deps.setupToken && deps.setupTokenFile) {
      writeFileSync(deps.setupTokenFile, `${setupToken}\n${deps.publicUrl ? `${deps.publicUrl}/setup?token=${setupToken}\n` : ''}`, { mode: 0o600 });
      app.log.warn(`back office: no manager yet — the link that creates the first one is in ${deps.setupTokenFile}`);
    }
  }

  // CSP, never framed, no referrer at all, HSTS over HTTPS (net/headers.ts); before the address check, so a refusal has them too
  securityHeaders(app, { referrer: 'no-referrer' });
  app.addHook('onRequest', async (req, reply) => {
    // nothing of it is cached (the security headers, net/headers.ts, are set just before)
    if (isApiRequest(req)) reply.header('cache-control', 'no-store');
    if (!ipAllowed(req.ip, allowed)) return reply.code(403).send({ error: 'adresse non autorisée' });
  });
  app.addHook('preHandler', async (req, reply) => {
    if (!isApiRequest(req)) return; // on the route, never on the raw path (see net/headers.ts)
    const cfg = (req.routeOptions.config ?? {}) as RouteAuth;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== ADMIN_CSRF) return reply.code(403).send({ error: 'requête refusée (en-tête x-requested-with manquant)' });
    const token = readCookie(req, ADMIN_COOKIE);
    if (token && token.length <= 200) {
      // a manager whose account is not disabled, now (disabling ends the session at the next request)
      const r = (await db.query<{ id: string; email: string; name: string }>(
        `SELECT m.id, m.email, m.name FROM staff_sessions s JOIN staff m ON m.id = s.staff_id WHERE s.id = $1 AND s.expires_at > now() AND m.disabled_at IS NULL`, [hash(token)])).rows[0];
      if (r) req.ctx = { user: { ...r, sessionId: hash(token) }, workspace: null };
    }
    if (cfg.auth === 'public') return;
    if (!req.ctx) return reply.code(401).send({ error: 'connexion requise' });
  });
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    if (err instanceof QuotaError) return reply.code(402).send(err.body);
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) req.log.error(err);
    reply.code(code).send({ error: code === 500 ? 'erreur interne' : err.message });
  });

  const openSession = async (req: FastifyRequest, reply: FastifyReply, staffId: string) => {
    const token = randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO staff_sessions (id, staff_id, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(hours => $3), $4)`, [hash(token), staffId, HOURS, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    await db.query('UPDATE staff SET last_login_at = now() WHERE id = $1', [staffId]);
    setCookie(req, reply, token);
  };
  const me = async (id: string) => (await db.query<{ id: string; name: string; email: string }>('SELECT id, name, email FROM staff WHERE id = $1', [id])).rows[0]!;

  const fails = new Limiter(5), failsByIp = new Limiter(20), setups = new Limiter(10);
  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ ok: true, backOffice: true, ...VERSION }));
  app.get('/api/auth/me', { config: { auth: 'public' } }, async (req) => ({ user: req.ctx ? { id: req.ctx.user.id, name: req.ctx.user.name, email: req.ctx.user.email } : null, appUrl: req.ctx ? deps.appUrl ?? null : null, setup: !req.ctx && (await noManager()) }));

  app.post('/api/auth/login', { config: { auth: 'public' } }, async (req, reply) => {
    const b = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'e-mail et mot de passe attendus' });
    const key = `${b.data.email}|${req.ip}`;
    if (fails.blocked(key) || failsByIp.blocked(req.ip)) return reply.code(429).send({ error: 'trop de tentatives : réessayez dans quelques minutes' });
    const m = (await db.query<{ id: string; password_hash: string; disabled: boolean }>('SELECT id, password_hash, disabled_at IS NOT NULL AS disabled FROM staff WHERE email = $1', [b.data.email])).rows[0];
    const good = await verifyPassword(b.data.password, m?.password_hash ?? (await dummyHash()));
    // one answer for a wrong password, an unknown account (a user of the platform, say) and a disabled one
    if (!m || !good || m.disabled) { fails.hit(key); failsByIp.hit(req.ip); req.log.warn({ ip: req.ip }, 'back-office sign-in refused'); return reply.code(401).send({ error: 'accès refusé : identifiants incorrects, ou compte sans accès au back-office' }); }
    fails.reset(key);
    await openSession(req, reply, m.id);
    const who = await me(m.id);
    await audit(db, who, req.ip, 'sign-in', 'session', null, 'connexion au back-office');
    return { user: who };
  });
  app.post('/api/auth/logout', { config: { auth: 'public' } }, async (req, reply) => {
    if (req.ctx) await db.query('DELETE FROM staff_sessions WHERE id = $1', [req.ctx.user.sessionId]);
    setCookie(req, reply, null);
    return { ok: true };
  });
  // a manager's own password; the other sessions end
  app.post('/api/auth/password', { config: { auth: 'admin' } }, async (req, reply) => {
    const b = z.object({ current: z.string().max(200), next: z.string().max(200) }).safeParse(req.body), who = req.ctx!.user;
    if (!b.success) return reply.code(400).send({ error: 'mots de passe attendus' });
    if (!passwordOk(b.data.next)) return reply.code(400).send({ error: `mot de passe : ${PASSWORD_RULE}` });
    const m = (await db.query<{ password_hash: string }>('SELECT password_hash FROM staff WHERE id = $1', [who.id])).rows[0]!;
    if (!(await verifyPassword(b.data.current, m.password_hash))) return reply.code(400).send({ error: 'mot de passe actuel incorrect' });
    await db.query('UPDATE staff SET password_hash = $2 WHERE id = $1', [who.id, await hashPassword(b.data.next)]);
    await db.query('DELETE FROM staff_sessions WHERE staff_id = $1 AND id <> $2', [who.id, who.sessionId]);
    await audit(db, who, req.ip, 'password', 'staff', who.id, 'a changé son mot de passe');
    return { ok: true };
  });

  // ---------------------------------------------------------------- the first manager
  app.get('/api/setup', { config: { auth: 'public' } }, async () => ({ needed: await noManager() }));
  app.post('/api/setup', { config: { auth: 'public' } }, async (req, reply) => {
    const b = z.object({ token: z.string().max(200), email: Email, name: z.string().trim().min(1).max(80), password: z.string().max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    if (setups.blocked(req.ip)) return reply.code(429).send({ error: 'trop de tentatives : réessayez plus tard' });
    if (!(await noManager()) || !setupToken) return reply.code(409).send({ error: 'le back-office a déjà son gérant : connectez-vous' });
    if (!same(b.data.token, setupToken)) { setups.hit(req.ip); return reply.code(403).send({ error: 'code de création incorrect' }); }
    if (!passwordOk(b.data.password)) return reply.code(400).send({ error: `mot de passe : ${PASSWORD_RULE}` });
    const m = await createManager(db, b.data);
    setupToken = null;
    if (deps.setupTokenFile && existsSync(deps.setupTokenFile)) rmSync(deps.setupTokenFile, { force: true });
    await openSession(req, reply, m.id);
    await audit(db, m, req.ip, 'setup', 'staff', m.id, 'a créé le back-office (premier gérant)');
    return reply.code(201).send({ user: m });
  });

  // ---------------------------------------------------------------- the managers
  app.get('/api/admin/staff', { config: { auth: 'admin' } }, async (req) => {
    const staff = (await db.query<{ id: string; name: string; email: string; created_at: Date; last_login_at: Date | null; disabled_at: Date | null; by: string | null }>(
      'SELECT m.id, m.name, m.email, m.created_at, m.last_login_at, m.disabled_at, c.name AS by FROM staff m LEFT JOIN staff c ON c.id = m.created_by ORDER BY m.created_at')).rows;
    const invitations = (await db.query<{ id: string; email: string; created_at: Date; expires_at: Date; by: string | null }>(
      'SELECT i.id, i.email, i.created_at, i.expires_at, c.name AS by FROM staff_invitations i LEFT JOIN staff c ON c.id = i.created_by WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC')).rows;
    return {
      staff: staff.map((m) => ({ id: m.id, name: m.name, email: m.email, createdAt: m.created_at, lastLoginAt: m.last_login_at, disabled: !!m.disabled_at, by: m.by, you: m.id === req.ctx!.user.id })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, createdAt: i.created_at, expiresAt: i.expires_at, by: i.by })),
    };
  });
  // another manager: a link, shown once (only its hash is kept), valid three days
  app.post('/api/admin/staff/invitations', { config: { auth: 'admin' } }, async (req, reply) => {
    const b = z.object({ email: Email }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'adresse e-mail invalide' });
    if ((await db.query('SELECT 1 FROM staff WHERE email = $1', [b.data.email])).rows.length) return reply.code(409).send({ error: 'cette adresse a déjà un compte gérant' });
    const token = randomBytes(24).toString('base64url'), id = randomUUID();
    await db.query(`INSERT INTO staff_invitations (id, token_hash, email, created_by, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`, [id, hash(token), b.data.email, req.ctx!.user.id, INVITE_DAYS]);
    await audit(db, req.ctx!.user, req.ip, 'invite-manager', 'staff', id, `a invité ${b.data.email} comme gérant`);
    return reply.code(201).send({ id, email: b.data.email, path: `/join/${token}`, days: INVITE_DAYS });
  });
  app.delete('/api/admin/staff/invitations/:id', { config: { auth: 'admin' } }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const r = id.success ? await db.query<{ email: string }>('UPDATE staff_invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email', [id.data]) : { rows: [] };
    if (!r.rows.length) return reply.code(404).send({ error: 'invitation introuvable' });
    await audit(db, req.ctx!.user, req.ip, 'revoke-invitation', 'staff', id.data!, `a annulé l’invitation de ${r.rows[0]!.email}`);
    return reply.code(204).send();
  });
  const openInvite = async (token: string) => (await db.query<{ id: string; email: string; expires_at: Date; created_by: string | null }>(
    'SELECT id, email, expires_at, created_by FROM staff_invitations WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()', [hash(token)])).rows[0];
  app.get('/api/join/:token', { config: { auth: 'public' } }, async (req, reply) => {
    const inv = await openInvite((req.params as { token: string }).token.slice(0, 200));
    return inv ? { email: inv.email, expiresAt: inv.expires_at } : reply.code(404).send({ error: 'invitation invalide ou expirée' });
  });
  app.post('/api/join/:token', { config: { auth: 'public' } }, async (req, reply) => {
    const inv = await openInvite((req.params as { token: string }).token.slice(0, 200));
    if (!inv) return reply.code(404).send({ error: 'invitation invalide ou expirée' });
    const b = z.object({ name: z.string().trim().min(1).max(80), password: z.string().max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'nom et mot de passe attendus' });
    if (!passwordOk(b.data.password)) return reply.code(400).send({ error: `mot de passe : ${PASSWORD_RULE}` });
    if ((await db.query('SELECT 1 FROM staff WHERE email = $1', [inv.email])).rows.length) return reply.code(409).send({ error: 'cette adresse a déjà un compte gérant' });
    const m = await createManager(db, { email: inv.email, name: b.data.name, password: b.data.password, createdBy: inv.created_by });
    await db.query('UPDATE staff_invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
    await openSession(req, reply, m.id);
    await audit(db, m, req.ip, 'join', 'staff', m.id, 'a rejoint les gérants (invitation)');
    return reply.code(201).send({ user: m });
  });
  // disable or enable, or remove, another manager — never oneself
  const Id = z.object({ id: z.string().uuid() });
  app.patch('/api/admin/staff/:id', { config: { auth: 'admin' } }, async (req, reply) => {
    const p = Id.safeParse(req.params), b = z.object({ disabled: z.boolean() }).safeParse(req.body ?? {});
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    if (p.data.id === req.ctx!.user.id) return reply.code(400).send({ error: 'vous ne pouvez pas désactiver votre propre compte' });
    const m = (await db.query<{ name: string }>('SELECT name FROM staff WHERE id = $1', [p.data.id])).rows[0];
    if (!m) return reply.code(404).send({ error: 'gérant introuvable' });
    await db.query('UPDATE staff SET disabled_at = $2 WHERE id = $1', [p.data.id, b.data.disabled ? new Date() : null]);
    if (b.data.disabled) await db.query('DELETE FROM staff_sessions WHERE staff_id = $1', [p.data.id]);
    await audit(db, req.ctx!.user, req.ip, b.data.disabled ? 'disable-manager' : 'enable-manager', 'staff', p.data.id, `${b.data.disabled ? 'a désactivé' : 'a réactivé'} le gérant ${m.name}`);
    return { ok: true };
  });
  app.delete('/api/admin/staff/:id', { config: { auth: 'admin' } }, async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'gérant introuvable' });
    if (p.data.id === req.ctx!.user.id) return reply.code(400).send({ error: 'vous ne pouvez pas retirer votre propre compte' });
    const r = await db.query<{ name: string }>('DELETE FROM staff WHERE id = $1 RETURNING name', [p.data.id]);
    if (!r.rows.length) return reply.code(404).send({ error: 'gérant introuvable' });
    await audit(db, req.ctx!.user, req.ip, 'remove-manager', 'staff', p.data.id, `a retiré le gérant ${r.rows[0]!.name}`);
    return reply.code(204).send();
  });

  const quota = quotas(db, { enabled: deps.plans ?? false, voicesDir: deps.voicesDir, imagesDir: deps.imagesDir });
  adminRoutes(app, db, quota, deps.communityDir, { payments: !!deps.stripe, prices: deps.stripe?.prices ?? null });

  if (deps.adminDist && existsSync(deps.adminDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.adminDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (isApiRequest(req) || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  } else app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'introuvable' }));
  return app;
}
