// Who is asking, in which workspace, with which role. Every /api route declares what it needs in its config:
//   { auth: 'public' }            no account needed (health, sign-in, signed media links)
//   { auth: 'user' }              signed in, any workspace or none (profile, workspace list)
//   { role: 'viewer' | 'editor' | 'admin' | 'owner' }   member of the current workspace with at least that role
// The default is { role: 'viewer' }: a route that forgets to say is closed, not open.
// The current workspace comes from the x-workspace-id header (the editor sends the one picked in its switcher),
// otherwise the user's first workspace. Every write must carry x-requested-with: a header a page on another site
// cannot send without CORS, which this server never grants (CSRF). Only a route that another service calls, and
// that proves who it is otherwise (the payment provider's signed webhook), says { csrf: false }.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import { readCookie, sessionUser, type SessionUser } from './sessions';
import { isApiRequest } from '../net/headers';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export interface Ctx { user: SessionUser; workspace: { id: string; name: string; role: Role } | null }
export interface RouteAuth { auth?: 'public' | 'user' | 'admin'; role?: Role; public?: boolean; csrf?: boolean }
/** the back office's routes say { auth: 'admin' }: its own server checks them (a manager's session), never this one */

declare module 'fastify' {
  interface FastifyRequest { ctx: Ctx | null }
}

export const CSRF_HEADER = 'x-requested-with';

export function installAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('ctx', null);
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isApiRequest(req)) return; // on the route, never on the raw path (see net/headers.ts)
    const cfg = (req.routeOptions.config ?? {}) as RouteAuth;
    const isPublic = cfg.auth === 'public' || cfg.public === true;
    // every write carries the header, signed in or not (sign-in and sign-up too: no logging a victim into
    // someone else's account from another site)
    if (cfg.csrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== 'animation-flow') {
      return reply.code(403).send({ error: 'requête refusée (en-tête x-requested-with manquant)' });
    }
    const user = await sessionUser(db, readCookie(req));
    if (!user) { if (isPublic) return; return reply.code(401).send({ error: 'connexion requise' }); }
    req.ctx = { user, workspace: null };
    if (cfg.auth === 'admin') return reply.code(404).send({ error: 'introuvable' });
    if (isPublic || cfg.auth === 'user') return;
    // a browser cannot set headers on a WebSocket: the workspace may come as ?ws= there
    const q = (req.query ?? {}) as { ws?: unknown };
    const wanted = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : typeof q.ws === 'string' ? q.ws : null;
    const { rows } = await db.query<{ id: string; name: string; role: Role }>(
      `SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ${wanted ? 'AND w.id::text = $2' : ''} ORDER BY m.created_at LIMIT 1`,
      wanted ? [user.id, wanted] : [user.id]);
    const ws = rows[0];
    if (!ws) return reply.code(wanted ? 403 : 409).send({ error: wanted ? "vous n'êtes pas membre de cet espace" : "vous n'appartenez à aucun espace de travail" });
    req.ctx.workspace = ws;
    const need = cfg.role ?? 'viewer';
    if (RANK[ws.role] < RANK[need]) return reply.code(403).send({ error: `réservé aux rôles ${(Object.keys(RANK) as Role[]).filter((r) => RANK[r] >= RANK[need]).join(', ')}` });
  });
}

/** the workspace of an authorised request (the hook guarantees it for role-protected routes) */
export const wsOf = (req: FastifyRequest) => req.ctx!.workspace!;
export const userOf = (req: FastifyRequest) => req.ctx!.user;
