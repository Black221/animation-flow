// A signed-in test client: signs up (or in), keeps the session cookie, sends the CSRF header and, if set, the
// workspace to act in. Tests call client.inject() the way they would call app.inject().
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

export interface Client {
  inject(o: InjectOptions | string): Promise<LightMyRequestResponse>;
  user: { id: string; email: string; name: string };
  workspaces: { id: string; name: string; role: string }[];
  /** acting workspace (x-workspace-id); by default the first one */
  ws: string | null;
  cookie: string;
}

const cookieOf = (setCookie: string | string[] | undefined) => ((Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '').split(';')[0]!;

function client(app: FastifyInstance, cookie: string, body: { user: Client['user']; workspaces: Client['workspaces'] }): Client {
  const c: Client = {
    user: body.user, workspaces: body.workspaces, ws: null, cookie,
    inject(o) {
      const opts: InjectOptions = typeof o === 'string' ? { url: o } : { ...o };
      opts.headers = { cookie: c.cookie, 'x-requested-with': 'animation-flow', ...(c.ws ? { 'x-workspace-id': c.ws } : {}), ...(opts.headers ?? {}) };
      return app.inject(opts);
    },
  };
  return c;
}

export const PASSWORD = 'mot-de-passe-solide-1';

export async function signUp(app: FastifyInstance, email: string, o: { name?: string; invitation?: string; password?: string } = {}): Promise<Client> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { 'x-requested-with': 'animation-flow' }, payload: { email, name: o.name ?? email.split('@')[0], password: o.password ?? PASSWORD, ...(o.invitation ? { invitation: o.invitation } : {}) } });
  if (r.statusCode !== 201) throw new Error(`signup ${email}: ${r.statusCode} ${r.body}`);
  return client(app, cookieOf(r.headers['set-cookie']), r.json());
}

export async function signIn(app: FastifyInstance, email: string, password = PASSWORD): Promise<Client> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'animation-flow' }, payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode} ${r.body}`);
  return client(app, cookieOf(r.headers['set-cookie']), r.json());
}
