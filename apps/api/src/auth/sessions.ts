// Sessions: a random token in an HttpOnly cookie; the database only keeps its SHA-256, so a leaked database
// dump cannot be replayed. 30 days, extended while in use; changing a password ends the other sessions.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import { requestIsHttps } from '../net/headers';

export const COOKIE = 'af_session';
const DAYS = 30;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function readCookie(req: FastifyRequest, name = COOKIE): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const secure = (req: FastifyRequest) => process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && requestIsHttps(req));
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string | null) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(secure(req) ? ['Secure'] : [])];
  reply.header('set-cookie', token ? `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${DAYS * 86400}; ${attrs.join('; ')}` : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`);
}

export async function createSession(db: Db, userId: string, userAgent = ''): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(days => $3), $4)`, [hashToken(token), userId, DAYS, userAgent.slice(0, 300)]);
  return token;
}

export interface SessionUser { id: string; email: string; name: string; sessionId: string }

export async function sessionUser(db: Db, token: string | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  // a suspended account has no session
  const { rows } = await db.query<{ id: string; email: string; name: string; last_seen_at: Date }>(
    `SELECT u.id, u.email, u.name, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now() AND u.suspended_at IS NULL`, [id]);
  const r = rows[0];
  if (!r) return null;
  // sliding expiry, written at most once an hour
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) void db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`, [id, DAYS]).catch(() => undefined);
  return { id: r.id, email: r.email, name: r.name, sessionId: id };
}

export const endSession = (db: Db, sessionId: string) => db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
export const endOtherSessions = (db: Db, userId: string, keep: string) => db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, keep]);
export { hashToken };
