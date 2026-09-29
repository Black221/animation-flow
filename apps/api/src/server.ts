// The HTTP server. buildServer() takes its dependencies (database, secret box, optional fetch for providers) so tests
// run it in memory with app.inject(), without a network or a real Postgres.
import type { FetchLike, JsonPost, PostFetch } from '@af/providers';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { installAuth } from './auth/context';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretBox } from './crypto';
import { databaseUnavailable, type Db } from './db';
import { projectRoutes } from './routes/projects';
import { providerRoutes } from './routes/providers';
import { renderRoutes } from './routes/renders';
import { voiceRoutes } from './routes/voices';
import { generationRoutes } from './routes/generations';
import { imageRoutes } from './routes/images';
import { uploadRoutes } from './routes/uploads';
import { thumbnailRoutes } from './routes/thumbnails';
import { communityRoutes } from './routes/community';
import { authRoutes, type SignupMode } from './routes/auth';
import { workspaceRoutes } from './routes/workspace';
import { liveRoutes } from './routes/live';
import { commentRoutes } from './routes/comments';
import { LiveHub } from './live/hub';
import { signer, type Signer } from './render/sign';
import type { MailSetup } from './mail';
import { QuotaError, quotas } from './plans';
import { planRoutes } from './routes/plans';
import { stripeClient, type StripeConfig, type StripeFetch } from './billing';
import { readiness, type ReadyOptions } from './ready';
import { safeFetch } from './net/safe-fetch';
import { isApiRequest, securityHeaders } from './net/headers';
import { VERSION } from './version';

export interface ServerDeps {
  db: Db;
  box: SecretBox;
  /** who may create an account besides the first one and invited people */
  signup?: SignupMode;
  webDist?: string | null;
  /** every call to a provider goes through this (default: safeFetch, see net/safe-fetch.ts); tests replace it */
  fetchImpl?: FetchLike;
  /** let providers live on private or local addresses (ALLOW_PRIVATE_PROVIDERS=true: a private server with Ollama) */
  allowPrivateProviders?: boolean;
  logger?: boolean;
  /** signs video links; defaults to a random key (links then die with the process) */
  signer?: Signer;
  /** where recorded lines are stored */
  voicesDir: string;
  /** where decors painted by an image model are stored (default: a folder inside voicesDir) */
  imagesDir?: string | undefined;
  /** where published projects keep their media (default: a folder inside voicesDir) */
  communityDir?: string | undefined;
  /** for voice providers (tests) */
  postFetch?: PostFetch;
  /** for text models (tests) */
  llmFetch?: JsonPost;
  /** live co-editing: delay before a change is saved (ms) */
  liveSaveDelay?: number;
  /** e-mail (invitations, forgotten passwords); none by default */
  mail?: MailSetup | null;
  /** fonts for images rendered on the server (drawings shown to models) */
  fontsDir?: string | undefined;
  /** behind a reverse proxy: which X-Forwarded-* to believe (client address, protocol, host) */
  trustProxy?: boolean | number | string;
  /** plans and quotas (the app's configuration turns them on: PLANS); off here, nothing is limited */
  plans?: boolean;
  /** paying for a plan (none: plans are changed by the platform admin) */
  stripe?: StripeConfig | null;
  /** for Stripe (tests) */
  stripeFetch?: StripeFetch;
  /** the readiness probe: the data folder to write to (default: voicesDir), FFmpeg's check (tests) */
  ready?: Partial<ReadyOptions>;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    // a hop count is supported at run time (proxy-addr), though the types only list true, addresses or a function
    trustProxy: (deps.trustProxy ?? false) as boolean,
    logger: deps.logger ? { level: 'info', redact: { paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'], censor: '[masqué]' } } : false,
  });

  // CSP, framing, sniffing, referrer, HSTS over HTTPS: on every answer, pages and API alike (see net/headers.ts)
  securityHeaders(app, { referrer: 'same-origin' });
  // accounts, sessions, workspaces and roles: every route below declares what it needs (see auth/context.ts)
  installAuth(app, deps.db);
  const { default: websocket } = await import('@fastify/websocket');
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });
  // live editing: rooms in this process, kept in step with the other processes through the database
  const hub = new LiveHub(deps.db, deps.liveSaveDelay ?? 2000);
  await hub.start();
  app.addHook('onClose', async () => { await hub.close(); });
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    if (err instanceof QuotaError) return reply.code(402).send(err.body);
    // the database is out of reach: 503, so a load balancer tries another replica and a client knows to come back
    if (databaseUnavailable(err)) { req.log.warn({ code: (err as { code?: string }).code }, 'database unavailable'); return reply.code(503).send({ error: 'service momentanément indisponible, réessayez dans un instant' }); }
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) req.log.error(err);
    reply.code(code).send({ error: code === 500 ? 'erreur interne' : err.message });
  });

  // liveness (the process answers) and readiness (it can work: database, storage, FFmpeg); see ready.ts
  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ ok: true, ...VERSION }));
  const ready = readiness(deps.db, { dataDir: deps.voicesDir, ...deps.ready });
  app.get('/api/ready', { config: { auth: 'public' } }, async (_req, reply) => {
    const checks = await ready(), ok = checks.database && checks.storage && checks.ffmpeg;
    return reply.code(ok ? 200 : 503).header('cache-control', 'no-store').send({ ok, checks });
  });
  authRoutes(app, deps.db, deps.signup ?? 'invite', deps.mail ?? null, hub);
  const imagesDir = deps.imagesDir ?? join(deps.voicesDir, '_images'), communityDir = deps.communityDir ?? join(deps.voicesDir, '_community');
  const quota = quotas(deps.db, { enabled: deps.plans ?? false, voicesDir: deps.voicesDir, imagesDir });
  workspaceRoutes(app, deps.db, { voicesDir: deps.voicesDir, imagesDir, communityDir }, hub, deps.mail ?? null, quota);
  projectRoutes(app, deps.db, hub, quota);
  liveRoutes(app, hub);
  commentRoutes(app, deps.db, hub);
  // no call to a provider may fall back on the global fetch: whatever a test does not replace goes through safeFetch
  const outbound = safeFetch({ allowPrivate: deps.allowPrivateProviders ?? false });
  providerRoutes(app, deps.db, deps.box, deps.fetchImpl ?? outbound);
  const sign = deps.signer ?? signer(randomBytes(32));
  renderRoutes(app, deps.db, sign, quota);
  voiceRoutes(app, deps.db, deps.box, sign, deps.voicesDir, deps.postFetch ?? outbound, quota);
  generationRoutes(app, deps.db, deps.box, deps.llmFetch ?? outbound, deps.fontsDir, imagesDir, quota);
  imageRoutes(app, deps.db, deps.box, sign, imagesDir, deps.llmFetch ?? outbound, quota);
  uploadRoutes(app, deps.db, sign, { voicesDir: deps.voicesDir, imagesDir }, quota);
  const thumbnail = thumbnailRoutes(app, deps.db, imagesDir, deps.fontsDir);
  communityRoutes(app, deps.db, { voicesDir: deps.voicesDir, imagesDir, communityDir }, thumbnail, quota);
  planRoutes(app, deps.db, quota, deps.stripe ? { stripe: stripeClient(deps.stripe, deps.stripeFetch), config: deps.stripe } : null);

  if (deps.webDist && existsSync(deps.webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: deps.webDist, wildcard: false });
    // the editor is a single-page app: unknown non-API paths load it
    app.setNotFoundHandler((req, reply) => (isApiRequest(req) || req.method !== 'GET' ? reply.code(404).send({ error: 'introuvable' }) : reply.sendFile('index.html')));
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'introuvable' }));
  }
  return app;
}
