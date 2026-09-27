// The HTTP server. buildServer() takes its dependencies (database, secret box, optional fetch for providers) so tests
// run it in memory with app.inject(), without a network or a real Postgres.
import type { FetchLike, JsonPost, PostFetch } from '@af/providers';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { installAuth } from './auth/context';
import { existsSync } from 'node:fs';
import type { SecretBox } from './crypto';
import type { Db } from './db';
import { projectRoutes } from './routes/projects';
import { providerRoutes } from './routes/providers';
import { renderRoutes } from './routes/renders';
import { voiceRoutes } from './routes/voices';
import { generationRoutes } from './routes/generations';
import { authRoutes, type SignupMode } from './routes/auth';
import { workspaceRoutes } from './routes/workspace';
import { liveRoutes } from './routes/live';
import { LiveHub } from './live/hub';
import { signer, type Signer } from './render/sign';

export interface ServerDeps {
  db: Db;
  box: SecretBox;
  /** who may create an account besides the first one and invited people */
  signup?: SignupMode;
  webDist?: string | null;
  fetchImpl?: FetchLike;
  logger?: boolean;
  /** signs video links; defaults to a random key (links then die with the process) */
  signer?: Signer;
  /** where recorded lines are stored */
  voicesDir: string;
  /** for voice providers (tests) */
  postFetch?: PostFetch;
  /** for text models (tests) */
  llmFetch?: JsonPost;
  /** live co-editing: delay before a change is saved (ms) */
  liveSaveDelay?: number;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: deps.logger ? { level: 'info', redact: { paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'], censor: '[masqué]' } } : false,
  });

  // accounts, sessions, workspaces and roles: every route below declares what it needs (see auth/context.ts)
  installAuth(app, deps.db);
  const { default: websocket } = await import('@fastify/websocket');
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });
  const hub = new LiveHub(deps.db, deps.liveSaveDelay ?? 2000);
  app.addHook('onClose', async () => { await hub.flushAll(); });
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) req.log.error(err);
    reply.code(code).send({ error: code === 500 ? 'erreur interne' : err.message });
  });

  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ ok: true }));
  authRoutes(app, deps.db, deps.signup ?? 'invite');
  workspaceRoutes(app, deps.db, { voicesDir: deps.voicesDir }, hub);
  projectRoutes(app, deps.db, hub);
  liveRoutes(app, hub);
  providerRoutes(app, deps.db, deps.box, deps.fetchImpl);
  const sign = deps.signer ?? signer(randomBytes(32));
  renderRoutes(app, deps.db, sign);
  voiceRoutes(app, deps.db, deps.box, sign, deps.voicesDir, deps.postFetch);
  generationRoutes(app, deps.db, deps.box, deps.llmFetch);

  if (deps.webDist && existsSync(deps.webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.webDist, wildcard: false });
    // the editor is a single-page app: unknown non-API paths load it
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'introuvable' }));
  }
  return app;
}
