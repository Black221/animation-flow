// The back office: a server of its own, on its own port (only this machine by default: reach it through a VPN, an SSH
// tunnel or a reverse proxy that asks who you are), serving its own app and only the administration API. It shares
// the database with the app but not its sessions: signing in here makes a back-office session (its own cookie,
// SameSite=Strict, 12 hours, never extended), open to platform admins only, checked again at every request.
// Every write carries its own CSRF header and is written to the audit log.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { readCookie } from '../auth/sessions';
import { dummyHash, verifyPassword } from '../auth/password';
import type { RouteAuth } from '../auth/context';
import type { StripeConfig } from '../billing';
import type { Db } from '../db';
import { QuotaError, quotas } from '../plans';
import { adminRoutes, audit } from './routes';

export const ADMIN_COOKIE = 'af_admin';
export const ADMIN_CSRF = 'animation-flow-admin';
const HOURS = 12;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

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

const secure = (req: FastifyRequest) => process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'));
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

export async function buildAdminServer(deps: AdminServerDeps): Promise<FastifyInstance> {
  const { db } = deps, allowed = deps.allowedIps ?? [];
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: (deps.trustProxy ?? false) as boolean,
    logger: deps.logger ? { level: 'info', redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], censor: '[masqué]' } } : false,
  });
  app.decorateRequest('ctx', null);

  app.addHook('onRequest', async (req, reply) => {
    // nobody frames it, nothing of it is cached, nothing of it leaks through a referrer
    reply.header('x-frame-options', 'DENY').header('content-security-policy', "frame-ancestors 'none'").header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (!ipAllowed(req.ip, allowed)) return reply.code(403).send({ error: 'adresse non autorisée' });
  });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const cfg = (req.routeOptions.config ?? {}) as RouteAuth;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== ADMIN_CSRF) return reply.code(403).send({ error: 'requête refusée (en-tête x-requested-with manquant)' });
    const token = readCookie(req, ADMIN_COOKIE);
    if (token && token.length <= 200) {
      // a platform admin, not suspended, now (rights taken away end the session at the next request)
      const r = (await db.query<{ id: string; email: string; name: string }>(
        `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.scope = 'admin' AND s.expires_at > now() AND u.platform_admin AND u.suspended_at IS NULL`, [hash(token)])).rows[0];
      if (r) req.ctx = { user: { ...r, sessionId: hash(token), admin: true }, workspace: null };
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

  const fails = new Limiter(5), failsByIp = new Limiter(20);
  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ ok: true, backOffice: true }));
  app.get('/api/auth/me', { config: { auth: 'public' } }, async (req) => ({ user: req.ctx ? { id: req.ctx.user.id, name: req.ctx.user.name, email: req.ctx.user.email } : null, appUrl: req.ctx ? deps.appUrl ?? null : null }));
  app.post('/api/auth/login', { config: { auth: 'public' } }, async (req, reply) => {
    const b = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'e-mail et mot de passe attendus' });
    const key = `${b.data.email}|${req.ip}`;
    if (fails.blocked(key) || failsByIp.blocked(req.ip)) return reply.code(429).send({ error: 'trop de tentatives : réessayez dans quelques minutes' });
    const u = (await db.query<{ id: string; password_hash: string; ok: boolean }>('SELECT id, password_hash, (platform_admin AND suspended_at IS NULL) AS ok FROM users WHERE email = $1', [b.data.email])).rows[0];
    const good = await verifyPassword(b.data.password, u?.password_hash ?? (await dummyHash()));
    // one answer for a wrong password and for an account that has no access here
    if (!u || !good || !u.ok) { fails.hit(key); failsByIp.hit(req.ip); req.log.warn({ ip: req.ip }, 'back-office sign-in refused'); return reply.code(401).send({ error: 'accès refusé : identifiants incorrects, ou compte sans accès au back-office' }); }
    fails.reset(key);
    const token = randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO sessions (id, user_id, expires_at, user_agent, scope) VALUES ($1, $2, now() + make_interval(hours => $3), $4, 'admin')`, [hash(token), u.id, HOURS, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
    const me = (await db.query<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE id = $1', [u.id])).rows[0]!;
    await audit(db, { id: me.id, name: me.name }, req.ip, 'sign-in', 'session', null, 'connexion au back-office');
    setCookie(req, reply, token);
    return { user: me };
  });
  app.post('/api/auth/logout', { config: { auth: 'public' } }, async (req, reply) => {
    if (req.ctx) await db.query('DELETE FROM sessions WHERE id = $1', [req.ctx.user.sessionId]);
    setCookie(req, reply, null);
    return { ok: true };
  });

  const quota = quotas(db, { enabled: deps.plans ?? true, voicesDir: deps.voicesDir, imagesDir: deps.imagesDir });
  adminRoutes(app, db, quota, deps.communityDir, { payments: !!deps.stripe, prices: deps.stripe?.prices ?? null });

  if (deps.adminDist && existsSync(deps.adminDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.adminDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  } else app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'introuvable' }));
  return app;
}
