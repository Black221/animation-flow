import { loadConfig } from './config';
import { secretBox } from './crypto';
import { migrate, openDb } from './db';
import { startRunner, type Runner } from './render/runner';
import { signer } from './render/sign';
import { buildServer } from './server';

const config = loadConfig();
if (config.role === 'worker' && !config.databaseUrl) throw new Error('ROLE=worker needs DATABASE_URL: the embedded database cannot be shared between processes');
const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir });
const applied = await migrate(db);

let runner: Runner | null = null;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg, ...extra }));
if (config.role !== 'api') {
  runner = startRunner({ db, rendersDir: config.rendersDir, voicesDir: config.voicesDir, fontsDir: config.fontsDir ?? undefined, threads: config.renderThreads, log });
  log(`render worker ${runner.id} · ${config.renderThreads} thread(s) · videos in ${config.rendersDir}${config.fontsDir ? '' : ' · no fonts found (FONTS_DIR)'}`);
}

let close = async () => { await runner?.stop(); await db.close(); };
if (config.role !== 'worker') {
  const app = await buildServer({ db, box: secretBox(config.encryptionKey), signer: signer(config.encryptionKey), accessToken: config.accessToken, webDist: config.webDist, voicesDir: config.voicesDir, logger: true });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`animation-flow on http://${config.host}:${config.port} · database: ${config.databaseUrl ? 'postgres' : 'embedded (PGlite)'} · role: ${config.role}${applied ? ` · ${applied} migration(s) applied` : ''}${config.accessToken ? ' · access token required' : ''}${config.webDist ? '' : ' · web app not built (pnpm build)'}`);
  const base = close; close = async () => { await app.close(); await base(); };
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void close().then(() => process.exit(0)); });
