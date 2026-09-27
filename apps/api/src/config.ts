// Configuration from the environment only. No secret ever lives in a file of the repository.
//   PORT, HOST                 where to listen (HOST defaults to 127.0.0.1: local use)
//   DATABASE_URL               postgres://… ; without it, an embedded PGlite database in DATA_DIR
//   DATA_DIR                   local data (embedded database, development key), default ./.data
//   APP_ENCRYPTION_KEY         32 bytes, base64 or hex: encrypts the API keys stored in the database. Required in
//                              production; in development one is generated once into DATA_DIR (never committed)
//   SIGNUP                     invite (default: only the first account and invited people) · open (anyone)
//   COOKIE_SECURE              true / false: force the Secure flag on the session cookie (default: when HTTPS)
//   WEB_DIST                   built web app to serve (default ../web/dist)
//   ROLE                       all (default: API + render worker in one process) · api · worker (renders only; needs a
//                              shared PostgreSQL and a shared RENDERS_DIR)
//   RENDERS_DIR                where videos are written (default DATA_DIR/renders)
//   VOICES_DIR                 recorded lines, one WAV per text and voice (default DATA_DIR/voices)
//   RENDER_THREADS             threads per render job (default: CPU count − 1)
//   FONTS_DIR                  fonts for server rendering (default: the editor's fonts)
//   SMTP_URL                   smtp(s)://user:password@host:port : enables e-mail (invitations, forgotten passwords)
//   MAIL_FROM                  sender, e.g. "animation-flow <noreply@example.org>" (required with SMTP_URL)
//   APP_URL                    public address of the app, e.g. https://anim.example.org (required with SMTP_URL:
//                              links in e-mails are built from it, never from the request)
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string | null;
  dataDir: string;
  encryptionKey: Buffer;
  signup: 'invite' | 'open';
  webDist: string | null;
  production: boolean;
  role: 'all' | 'api' | 'worker';
  rendersDir: string;
  voicesDir: string;
  renderThreads: number;
  fontsDir: string | null;
  mail: { smtpUrl: string; from: string; appUrl: string } | null;
}

export function parseKey(raw: string): Buffer {
  const s = raw.trim(), buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64 or hex); e.g. `openssl rand -base64 32`');
  return buf;
}

function mailConfig(env: NodeJS.ProcessEnv): Config['mail'] {
  if (!env.SMTP_URL) return null;
  if (!/^smtps?:\/\//.test(env.SMTP_URL)) throw new Error('SMTP_URL must start with smtp:// or smtps://');
  if (!env.MAIL_FROM) throw new Error('MAIL_FROM is required with SMTP_URL');
  let appUrl: URL;
  try { appUrl = new URL(env.APP_URL ?? ''); } catch { throw new Error('APP_URL (the public address of the app, e.g. https://anim.example.org) is required with SMTP_URL'); }
  if (!/^https?:$/.test(appUrl.protocol)) throw new Error('APP_URL must be http(s)');
  return { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM, appUrl: appUrl.origin + appUrl.pathname.replace(/\/+$/, '') };
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
  const role = (env.ROLE ?? 'all') as Config['role'];
  if (!['all', 'api', 'worker'].includes(role)) throw new Error('ROLE must be all, api or worker');
  const fontsDir = [env.FONTS_DIR, join(webDist, 'fonts'), resolve('../web/public/fonts')].find((d): d is string => !!d && existsSync(d)) ?? null;
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL || null,
    dataDir,
    encryptionKey,
    signup: env.SIGNUP === 'open' ? 'open' : 'invite',
    webDist: existsSync(join(webDist, 'index.html')) ? webDist : null,
    production,
    role,
    rendersDir: resolve(env.RENDERS_DIR ?? join(dataDir, 'renders')),
    voicesDir: resolve(env.VOICES_DIR ?? join(dataDir, 'voices')),
    renderThreads: Math.max(1, Number(env.RENDER_THREADS ?? Math.max(1, availableParallelism() - 1))),
    fontsDir,
    mail: mailConfig(env),
  };
}
