// Configuration from the environment only. No secret ever lives in a file of the repository.
//   PORT, HOST                 where to listen (HOST defaults to 127.0.0.1: local use)
//   DATABASE_URL               postgres://… ; without it, an embedded PGlite database in DATA_DIR
//   DATA_DIR                   local data (embedded database, development key), default ./.data
//   APP_ENCRYPTION_KEY         32 bytes, base64 or hex: encrypts the API keys stored in the database. Required in
//                              production; in development one is generated once into DATA_DIR (never committed)
//   APP_ACCESS_TOKEN           optional shared token: when set, every /api call must send "Authorization: Bearer …"
//   WEB_DIST                   built web app to serve (default ../web/dist)
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string | null;
  dataDir: string;
  encryptionKey: Buffer;
  accessToken: string | null;
  webDist: string | null;
  production: boolean;
}

export function parseKey(raw: string): Buffer {
  const s = raw.trim(), buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64 or hex); e.g. `openssl rand -base64 32`');
  return buf;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production', dataDir = resolve(env.DATA_DIR ?? '.data');
  let encryptionKey: Buffer;
  if (env.APP_ENCRYPTION_KEY) encryptionKey = parseKey(env.APP_ENCRYPTION_KEY);
  else if (production) throw new Error('APP_ENCRYPTION_KEY is required in production');
  else {
    mkdirSync(dataDir, { recursive: true });
    const file = join(dataDir, 'dev-encryption-key');
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    encryptionKey = parseKey(readFileSync(file, 'utf8'));
  }
  const webDist = resolve(env.WEB_DIST ?? '../web/dist');
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL || null,
    dataDir,
    encryptionKey,
    accessToken: env.APP_ACCESS_TOKEN || null,
    webDist: existsSync(join(webDist, 'index.html')) ? webDist : null,
    production,
  };
}
