import { loadConfig } from './config';
import { secretBox } from './crypto';
import { migrate, openDb } from './db';
import { buildServer } from './server';

const config = loadConfig();
const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir });
const applied = await migrate(db);
const app = await buildServer({ db, box: secretBox(config.encryptionKey), accessToken: config.accessToken, webDist: config.webDist, logger: true });
await app.listen({ port: config.port, host: config.host });
app.log.info(`animation-flow on http://${config.host}:${config.port} · database: ${config.databaseUrl ? 'postgres' : 'embedded (PGlite)'}${applied ? ` · ${applied} migration(s) applied` : ''}${config.accessToken ? ' · access token required' : ''}${config.webDist ? '' : ' · web app not built (pnpm build)'}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, async () => { await app.close(); await db.close(); process.exit(0); });
