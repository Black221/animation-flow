// The HTTP server. buildServer() takes its dependencies (database, secret box, optional fetch for providers) so tests
// run it in memory with app.inject(), without a network or a real Postgres.
import type { FetchLike } from '@af/providers';
import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { SecretBox } from './crypto';
import type { Db } from './db';
import { projectRoutes } from './routes/projects';
import { providerRoutes } from './routes/providers';

export interface ServerDeps {
  db: Db;
  box: SecretBox;
  accessToken?: string | null;
  webDist?: string | null;
  fetchImpl?: FetchLike;
  logger?: boolean;
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
      if (!req.url.startsWith('/api/') || req.url === '/api/health') return;
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

  if (deps.webDist && existsSync(deps.webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.webDist, wildcard: false });
    // the editor is a single-page app: unknown non-API paths load it
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  }
  return app;
}
