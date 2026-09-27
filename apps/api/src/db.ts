// One tiny interface over PostgreSQL (pg, in production) and PGlite (embedded Postgres in WebAssembly, for local use
// and tests): plain SQL, numbered migrations applied at start-up.
import { mkdirSync } from 'node:fs';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  /** run `fn` in one transaction on one connection (a pool would otherwise spread BEGIN and COMMIT over several) */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDb(opts: { url: string | null; dataDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    return {
      query: (sql, params) => pool.query(sql, params as unknown[]) as never,
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn({ query: (sql, params) => c.query(sql, params as unknown[]) as never });
          await c.query('COMMIT');
          return r;
        } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
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
];

export async function migrate(db: Db): Promise<number> {
  await db.query('CREATE TABLE IF NOT EXISTS _migrations (n integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await db.query<{ n: number }>('SELECT n FROM _migrations');
  const done = new Set(rows.map((r) => Number(r.n)));
  let applied = 0;
  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (done.has(i + 1)) continue;
    await db.tx(async (q) => {
      for (const stmt of MIGRATIONS[i]!.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO _migrations (n) VALUES ($1)', [i + 1]);
    });
    applied++;
  }
  return applied;
}
