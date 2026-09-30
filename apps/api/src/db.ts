// One tiny interface over PostgreSQL (pg, in production) and PGlite (embedded Postgres in WebAssembly, for local use
// and tests): plain SQL, numbered migrations applied at start-up.
import { mkdirSync } from 'node:fs';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  /** run `fn` in one transaction on one connection (a pool would otherwise spread BEGIN and COMMIT over several) */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** receive NOTIFY messages on a channel (from every process using the database); returns a function to stop.
   *  With PostgreSQL this holds one dedicated connection, reopened if it drops. */
  listen(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** errors that came out of a query of this module: only those can say the database is down (the same network codes
 *  from a provider or the mail server say nothing about it) */
const fromDatabase = new WeakSet<object>();
const mark = (e: unknown) => { if (e && typeof e === 'object') fromDatabase.add(e); return e; };
const marked = <T>(p: Promise<T>): Promise<T> => p.catch((e: unknown) => { throw mark(e); });

/** the database cannot be reached (refused, closed, restarting): a request should get 503, not 500 */
export function databaseUnavailable(e: unknown): boolean {
  if (!e || typeof e !== 'object' || !fromDatabase.has(e)) return false;
  const { code, message } = e as { code?: string; message?: string };
  if (code && (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P02', '57P03', '53300'].includes(code) || code.startsWith('08'))) return true;
  return /^(Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error)/.test(message ?? '');
}

export async function openDb(opts: { url: string | null; dataDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    // an idle connection the server closes (restart, failover, administrator) is an event, not a crash: the pool drops
    // it and the next query opens another; until the database is back, queries fail and /api/ready says so
    pool.on('error', (e: Error & { code?: string }) => console.error(JSON.stringify({ level: 50, time: Date.now(), msg: 'database connection lost', code: e.code ?? null })));
    return {
      query: (sql, params) => marked(pool.query(sql, params as unknown[])) as never,
      async tx(fn) {
        const c = await marked(pool.connect());
        // out of the pool, the connection has no listener: one that the server closes meanwhile must not crash the
        // process. Its queries fail (the transaction with them), and a broken connection is destroyed, not reused
        let broken: Error | undefined;
        const onError = (e: Error) => { broken = e; };
        c.on('error', onError);
        try {
          await marked(c.query('BEGIN'));
          const r = await fn({ query: (sql, params) => marked(c.query(sql, params as unknown[])) as never });
          await marked(c.query('COMMIT'));
          return r;
        } catch (e) { if (!broken) await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.off('error', onError); c.release(broken); }
      },
      async listen(channel, onMessage) {
        if (!/^[a-z_]+$/.test(channel)) throw new Error('channel name: a-z and _ only');
        // a pooled connection would be handed to someone else between queries: LISTEN needs its own
        let client: InstanceType<typeof pg.Client> | null = null, stopped = false, retry: NodeJS.Timeout | undefined;
        const connect = async () => {
          const c = new pg.Client({ connectionString: opts.url! });
          c.on('notification', (n) => { if (n.channel === channel && n.payload != null) onMessage(n.payload); });
          c.on('error', () => undefined);
          c.on('end', () => { if (client === c) client = null; if (!stopped) retry = setTimeout(() => void connect().catch(() => undefined), 1000); });
          await c.connect();
          await c.query(`LISTEN ${channel}`);
          client = c;
        };
        await connect();
        return async () => { stopped = true; clearTimeout(retry); await client?.end().catch(() => undefined); };
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  let dir: string | undefined;
  if (!opts.memory) { dir = `${opts.dataDir ?? '.data'}/pglite`; mkdirSync(dir, { recursive: true }); }
  const db = dir ? new PGlite(dir) : new PGlite();
  return {
    query: (sql, params) => db.query(sql, params) as never,
    tx: (fn) => db.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
    async listen(channel, onMessage) { const stop = await db.listen(channel, onMessage); return async () => { await stop(); }; },
    close: () => db.close(),
  };
}

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id uuid PRIMARY KEY,
     title text NOT NULL,
     data jsonb NOT NULL,
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE project_versions (
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     version integer NOT NULL,
     data jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (project_id, version)
   );
   CREATE TABLE credentials (
     id uuid PRIMARY KEY,
     provider text NOT NULL,
     label text NOT NULL,
     secret text,
     hint text NOT NULL DEFAULT '',
     base_url text,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_tested_at timestamptz,
     last_test_ok boolean
   );
   CREATE TABLE model_assignments (
     task text PRIMARY KEY,
     credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
     model text NOT NULL DEFAULT '',
     updated_at timestamptz NOT NULL DEFAULT now()
   );`,
  // render jobs: a queue in PostgreSQL (claimed with FOR UPDATE SKIP LOCKED), progress and the resulting file
  `CREATE TABLE renders (
     id uuid PRIMARY KEY,
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     project_version integer NOT NULL,
     status text NOT NULL DEFAULT 'queued',
     options jsonb NOT NULL DEFAULT '{}',
     frames_done integer NOT NULL DEFAULT 0,
     frames_total integer NOT NULL DEFAULT 0,
     fps real,
     attempts integer NOT NULL DEFAULT 0,
     error text,
     file text,
     bytes bigint,
     worker text,
     created_at timestamptz NOT NULL DEFAULT now(),
     started_at timestamptz,
     heartbeat_at timestamptz,
     finished_at timestamptz
   );
   CREATE INDEX renders_queue ON renders (status, created_at);
   CREATE INDEX renders_project ON renders (project_id, created_at);`,
  // narration: the voice chosen for a task; what a render could not include (lines without a recording…)
  `ALTER TABLE model_assignments ADD COLUMN voice text NOT NULL DEFAULT '';
   ALTER TABLE renders ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]'`,
  // AI generation: text → storyboard (reviewed) → scenes → a new project
  `CREATE TABLE generations (
     id uuid PRIMARY KEY,
     status text NOT NULL,
     input jsonb NOT NULL,
     storyboard jsonb,
     project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
     scenes_done integer NOT NULL DEFAULT 0,
     scenes_total integer NOT NULL DEFAULT 0,
     steps jsonb NOT NULL DEFAULT '[]',
     fallbacks jsonb NOT NULL DEFAULT '[]',
     models jsonb NOT NULL DEFAULT '{}',
     input_tokens integer NOT NULL DEFAULT 0,
     output_tokens integer NOT NULL DEFAULT 0,
     error text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX generations_recent ON generations (created_at)`,
  // several users: accounts, sessions, workspaces with roles, invitations. Everything that existed so far moves
  // into one default workspace, which the first account to sign up takes over.
  `CREATE TABLE users (
     id uuid PRIMARY KEY,
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     password_changed_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE workspaces (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE memberships (
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (workspace_id, user_id)
   );
   CREATE TABLE sessions (
     id text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     user_agent text NOT NULL DEFAULT ''
   );
   CREATE INDEX sessions_user ON sessions (user_id);
   CREATE TABLE invitations (
     id uuid PRIMARY KEY,
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     token_hash text NOT NULL UNIQUE,
     role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
     email text,
     created_by uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
     accepted_at timestamptz,
     revoked_at timestamptz
   );
   INSERT INTO workspaces (id, name) VALUES (gen_random_uuid(), 'Mon espace');
   ALTER TABLE projects ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
   UPDATE projects SET workspace_id = (SELECT id FROM workspaces LIMIT 1);
   ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL;
   ALTER TABLE projects ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE projects ADD COLUMN updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
   CREATE INDEX projects_workspace ON projects (workspace_id, updated_at);
   ALTER TABLE project_versions ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE credentials ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
   UPDATE credentials SET workspace_id = (SELECT id FROM workspaces LIMIT 1);
   ALTER TABLE credentials ALTER COLUMN workspace_id SET NOT NULL;
   ALTER TABLE model_assignments ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
   UPDATE model_assignments SET workspace_id = (SELECT id FROM workspaces LIMIT 1);
   ALTER TABLE model_assignments ALTER COLUMN workspace_id SET NOT NULL;
   ALTER TABLE model_assignments DROP CONSTRAINT model_assignments_pkey;
   ALTER TABLE model_assignments ADD PRIMARY KEY (workspace_id, task);
   ALTER TABLE generations ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
   UPDATE generations SET workspace_id = (SELECT id FROM workspaces LIMIT 1);
   ALTER TABLE generations ALTER COLUMN workspace_id SET NOT NULL;
   ALTER TABLE generations ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE renders ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL`,
  // comments on scenes: threads (a comment and its replies) pinned to a scene, optionally to an element and a
  // moment of the scene; a thread is resolved as a whole
  `CREATE TABLE comments (
     id uuid PRIMARY KEY,
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
     scene_id text NOT NULL,
     element_id text,
     t double precision,
     body text NOT NULL,
     author_id uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     edited_at timestamptz,
     resolved_at timestamptz,
     resolved_by uuid REFERENCES users(id) ON DELETE SET NULL
   );
   CREATE INDEX comments_project ON comments (project_id, created_at)`,
  // forgotten passwords: single-use links sent by e-mail (only the hash of the token is kept)
  `CREATE TABLE password_resets (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash text NOT NULL UNIQUE,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     used_at timestamptz
   );
   CREATE INDEX password_resets_user ON password_resets (user_id)`,
  // live editing across several API processes: every accepted change goes into a log, numbered per project under a
  // row lock, so all processes apply the same changes in the same order; `data` holds the project up to saved_seq
  `ALTER TABLE projects ADD COLUMN live_seq bigint NOT NULL DEFAULT 0;
   ALTER TABLE projects ADD COLUMN saved_seq bigint NOT NULL DEFAULT 0;
   CREATE TABLE live_ops (
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     seq bigint NOT NULL,
     kind text NOT NULL CHECK (kind IN ('ops', 'reset')),
     ops jsonb NOT NULL,
     version integer,
     reason text,
     author_id uuid REFERENCES users(id) ON DELETE SET NULL,
     author_name text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (project_id, seq)
   )`,
  // generation draws everything the storyboard needs before writing the scenes: the drawings are kept on the job
  `ALTER TABLE generations ADD COLUMN assets jsonb;
   ALTER TABLE generations ADD COLUMN assets_done integer NOT NULL DEFAULT 0;
   ALTER TABLE generations ADD COLUMN assets_total integer NOT NULL DEFAULT 0`,
  // and composes its music and sounds: kept on the job too
  `ALTER TABLE generations ADD COLUMN audio jsonb`,
  // the community: a project published as a frozen copy (its media copied beside it), liked, remixed into other
  // workspaces; a remix remembers what it came from
  `CREATE TABLE publications (
     id uuid PRIMARY KEY,
     project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     author_id uuid REFERENCES users(id) ON DELETE SET NULL,
     title text NOT NULL,
     description text NOT NULL DEFAULT '',
     tags jsonb NOT NULL DEFAULT '[]',
     license text NOT NULL DEFAULT 'cc-by',
     data jsonb NOT NULL,
     project_version integer NOT NULL,
     duration real NOT NULL DEFAULT 0,
     remix_of uuid REFERENCES publications(id) ON DELETE SET NULL,
     remixes integer NOT NULL DEFAULT 0,
     likes integer NOT NULL DEFAULT 0,
     views integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX publications_created ON publications (created_at DESC);
   CREATE UNIQUE INDEX publications_project ON publications (project_id) WHERE project_id IS NOT NULL;
   CREATE TABLE publication_likes (
     publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (publication_id, user_id)
   );
   ALTER TABLE projects ADD COLUMN remix_of uuid REFERENCES publications(id) ON DELETE SET NULL`,
  // a publication keeps the length of each of its scenes: its card shows the film's timeline
  `ALTER TABLE publications ADD COLUMN scenes jsonb NOT NULL DEFAULT '[]'`,
  // plans and quotas: a plan per workspace (the platform admin may override its limits), monthly usage as events
  // (a failed job gives its share back), payments through Stripe; platform admins, suspended accounts; reports on
  // published films, and films hidden by moderation. Workspaces from before plans keep working: they get Pro.
  `ALTER TABLE workspaces ADD COLUMN plan text NOT NULL DEFAULT 'free';
   UPDATE workspaces SET plan = 'pro';
   ALTER TABLE workspaces ADD COLUMN quotas jsonb NOT NULL DEFAULT '{}';
   ALTER TABLE workspaces ADD COLUMN stripe_customer_id text;
   ALTER TABLE workspaces ADD COLUMN stripe_subscription_id text;
   ALTER TABLE workspaces ADD COLUMN billing_status text;
   ALTER TABLE workspaces ADD COLUMN plan_renews_at timestamptz;
   CREATE UNIQUE INDEX workspaces_stripe_customer ON workspaces (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
   ALTER TABLE users ADD COLUMN platform_admin boolean NOT NULL DEFAULT false;
   ALTER TABLE users ADD COLUMN suspended_at timestamptz;
   UPDATE users SET platform_admin = true WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);
   CREATE TABLE usage_events (
     id uuid PRIMARY KEY,
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     kind text NOT NULL,
     amount double precision NOT NULL,
     ref text,
     user_id uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX usage_events_ws ON usage_events (workspace_id, created_at);
   CREATE INDEX usage_events_ref ON usage_events (ref);
   CREATE TABLE billing_events (
     id text PRIMARY KEY,
     type text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   ALTER TABLE renders ADD COLUMN priority integer NOT NULL DEFAULT 0;
   ALTER TABLE publications ADD COLUMN hidden_at timestamptz;
   CREATE TABLE reports (
     id uuid PRIMARY KEY,
     publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
     reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
     reason text NOT NULL,
     message text NOT NULL DEFAULT '',
     status text NOT NULL DEFAULT 'open',
     resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
     resolved_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX reports_open ON reports (status, created_at);
   CREATE UNIQUE INDEX reports_once ON reports (publication_id, reporter_id) WHERE status = 'open'`,
  // the back office, a server of its own: its sessions apart from the app's (scope), and a log of what admins do
  `ALTER TABLE sessions ADD COLUMN scope text NOT NULL DEFAULT 'app';
   CREATE TABLE admin_audit (
     id uuid PRIMARY KEY,
     admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
     admin_name text NOT NULL,
     action text NOT NULL,
     target_type text NOT NULL,
     target_id text,
     summary text NOT NULL,
     ip text,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX admin_audit_time ON admin_audit (created_at DESC)`,
  // three plans, not four: Basique joins Premium. And the back office's accounts apart from the platform's users:
  // managers (the platform's staff) with their own sessions and invitations; the users who were platform admins become
  // managers (same id, e-mail, name and password), users keep no platform rights; reports are settled by managers.
  // The empty workspace the migrations make for the first account is on the free plan (only real data got Pro)
  `UPDATE workspaces SET plan = 'premium' WHERE plan = 'basic';
   CREATE TABLE staff (
     id uuid PRIMARY KEY,
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     password_hash text NOT NULL,
     disabled_at timestamptz,
     created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_login_at timestamptz
   );
   CREATE TABLE staff_sessions (
     id text PRIMARY KEY,
     staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL,
     user_agent text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE staff_invitations (
     id uuid PRIMARY KEY,
     token_hash text NOT NULL UNIQUE,
     email text NOT NULL,
     created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
     expires_at timestamptz NOT NULL,
     accepted_at timestamptz,
     revoked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   INSERT INTO staff (id, email, name, password_hash, created_at) SELECT id, email, name, password_hash, created_at FROM users WHERE platform_admin;
   DELETE FROM sessions WHERE scope = 'admin';
   ALTER TABLE sessions DROP COLUMN scope;
   ALTER TABLE users DROP COLUMN platform_admin;
   ALTER TABLE admin_audit DROP CONSTRAINT IF EXISTS admin_audit_admin_id_fkey;
   UPDATE admin_audit SET admin_id = NULL WHERE admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.id = admin_audit.admin_id);
   ALTER TABLE admin_audit ADD CONSTRAINT admin_audit_staff_fkey FOREIGN KEY (admin_id) REFERENCES staff(id) ON DELETE SET NULL;
   ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_resolved_by_fkey;
   UPDATE reports SET resolved_by = NULL WHERE resolved_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.id = reports.resolved_by);
   ALTER TABLE reports ADD CONSTRAINT reports_resolved_by_staff_fkey FOREIGN KEY (resolved_by) REFERENCES staff(id) ON DELETE SET NULL;
   UPDATE workspaces w SET plan = 'free' WHERE plan = 'pro' AND billing_status IS NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id) AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id)`,
];

/** apply the migrations not applied yet (`upTo` stops after that one: tests of the upgrade path) */
export async function migrate(db: Db, upTo = Infinity): Promise<number> {
  // several processes may start at once (API replicas, workers): one migrates at a time, the others then see it done
  const LOCK = 'SELECT pg_advisory_xact_lock(7720233)';
  await db.tx(async (q) => { await q.query(LOCK); await q.query('CREATE TABLE IF NOT EXISTS _migrations (n integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'); });
  let applied = 0;
  for (let i = 0; i < Math.min(MIGRATIONS.length, upTo); i++) {
    const did = await db.tx(async (q) => {
      await q.query(LOCK);
      if ((await q.query('SELECT 1 FROM _migrations WHERE n = $1', [i + 1])).rows.length) return false;
      for (const stmt of MIGRATIONS[i]!.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO _migrations (n) VALUES ($1)', [i + 1]);
      return true;
    });
    if (did) applied++;
  }
  return applied;
}
