import { loadConfig } from './config';
import { secretBox } from './crypto';
import { migrate, openDb } from './db';
import { startRunner, type Runner } from './render/runner';
import { signer } from './render/sign';
import { adoptLegacyVoices } from './routes/voices';
import { buildServer } from './server';
import { smtpMailer } from './mail';

const config = loadConfig();

// `--mail-test you@example.org`: send one message with the SMTP settings, say how it went, stop
const mailTest = process.argv.indexOf('--mail-test');
if (mailTest >= 0) {
  const to = process.argv[mailTest + 1];
  if (!config.mail) { console.error('SMTP_URL, MAIL_FROM and APP_URL are not set: e-mail is off'); process.exit(2); }
  if (!to || !to.includes('@')) { console.error('usage: --mail-test you@example.org'); process.exit(2); }
  try {
    const { smtpMailer, testMail } = await import('./mail');
    await (await smtpMailer(config.mail.smtpUrl, config.mail.from)).send(testMail(to, config.mail.appUrl));
    console.log(`test message sent to ${to} (from ${config.mail.from}); check the inbox, and the spam folder`);
    process.exit(0);
  } catch (e) {
    // the server's answer (e.g. 535 authentication failed), never the address with its password
    console.error(`not sent: ${(e as Error).message}`);
    process.exit(1);
  }
}
if (config.role === 'worker' && !config.databaseUrl) throw new Error('ROLE=worker needs DATABASE_URL: the embedded database cannot be shared between processes');
const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir });
const applied = await migrate(db);
// recordings from before workspaces existed move into the first workspace (the one that took over the old data)
const first = (await db.query<{ id: string }>('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')).rows[0];
if (first) { const moved = adoptLegacyVoices(config.voicesDir, first.id); if (moved) console.log(`${moved} recording(s) moved into workspace ${first.id}`); }

let runner: Runner | null = null;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg, ...extra }));
if (config.role !== 'api') {
  runner = startRunner({ db, rendersDir: config.rendersDir, voicesDir: config.voicesDir, fontsDir: config.fontsDir ?? undefined, threads: config.renderThreads, log });
  log(`render worker ${runner.id} · ${config.renderThreads} thread(s) · videos in ${config.rendersDir}${config.fontsDir ? '' : ' · no fonts found (FONTS_DIR)'}`);
}

let close = async () => { await runner?.stop(); await db.close(); };
if (config.role !== 'worker') {
  const mail = config.mail ? { mailer: await smtpMailer(config.mail.smtpUrl, config.mail.from), appUrl: config.mail.appUrl } : null;
  const app = await buildServer({ db, box: secretBox(config.encryptionKey), signer: signer(config.encryptionKey), signup: config.signup, webDist: config.webDist, voicesDir: config.voicesDir, logger: true, mail, trustProxy: config.trustProxy });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`animation-flow on http://${config.host}:${config.port} · database: ${config.databaseUrl ? 'postgres' : 'embedded (PGlite)'} · role: ${config.role}${applied ? ` · ${applied} migration(s) applied` : ''}${config.signup === 'open' ? ' · open sign-up' : ' · sign-up by invitation'}${config.webDist ? '' : ' · web app not built (pnpm build)'}${config.mail ? ` · e-mail via SMTP, links to ${config.mail.appUrl}` : ' · no e-mail (SMTP_URL)'}`);
  const base = close; close = async () => { await app.close(); await base(); };
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void close().then(() => process.exit(0)); });
