// The HTTP server. buildServer() takes its dependencies (database, secret box, optional fetch for providers) so tests
// run it in memory with app.inject(), without a network or a real Postgres.
import type { FetchLike, PostFetch } from '@af/providers';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { SecretBox } from './crypto';
import type { Db } from './db';
import { projectRoutes } from './routes/projects';
import { providerRoutes } from './routes/providers';
import { renderRoutes } from './routes/renders';
import { voiceRoutes } from './routes/voices';
import { signer, type Signer } from './render/sign';

export interface ServerDeps {
  db: Db;
  box: SecretBox;
  accessToken?: string | null;
  webDist?: string | null;
  fetchImpl?: FetchLike;
  logger?: boolean;
  /** signs video links; defaults to a random key (links then die with the process) */
  signer?: Signer;
  /** where recorded lines are stored */
  voicesDir: string;
  /** for voice providers (tests) */
  postFetch?: PostFetch;
}

const sameToken = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: deps.logger ? { level: 'info', redact: { paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'], censor: '[masqué]' } } : false,
  });

  // one shared access token (small team, local use): every API route except the health check
  if (deps.accessToken) {
    const token = deps.accessToken;
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url === '/api/health' || (req.routeOptions.config as { public?: boolean } | undefined)?.public) return;
      const h = req.headers.authorization ?? '';
      if (!h.startsWith('Bearer ') || !sameToken(h.slice(7), token)) return reply.code(401).send({ error: 'accès refusé : jeton manquant ou invalide' });
    });
  }
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) req.log.error(err);
    reply.code(code).send({ error: code === 500 ? 'erreur interne' : err.message });
  });

  app.get('/api/health', async () => ({ ok: true, auth: !!deps.accessToken }));
  projectRoutes(app, deps.db);
  providerRoutes(app, deps.db, deps.box, deps.fetchImpl);
  const sign = deps.signer ?? signer(randomBytes(32));
  renderRoutes(app, deps.db, sign);
  voiceRoutes(app, deps.db, deps.box, sign, deps.voicesDir, deps.postFetch);

  if (deps.webDist && existsSync(deps.webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.webDist, wildcard: false });
    // the editor is a single-page app: unknown non-API paths load it
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  }
  return app;
}
