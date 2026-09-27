// One tiny interface over PostgreSQL (pg, in production) and PGlite (embedded Postgres in WebAssembly, for local use
// and tests): plain SQL, numbered migrations applied at start-up.
import { mkdirSync } from 'node:fs';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export async function openDb(opts: { url: string | null; dataDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    return { query: (sql, params) => pool.query(sql, params as unknown[]) as never, close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  let dir: string | undefined;
  if (!opts.memory) { dir = `${opts.dataDir ?? '.data'}/pglite`; mkdirSync(dir, { recursive: true }); }
  const db = dir ? new PGlite(dir) : new PGlite();
  return { query: (sql, params) => db.query(sql, params) as never, close: () => db.close() };
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
];

export async function migrate(db: Db): Promise<number> {
  await db.query('CREATE TABLE IF NOT EXISTS _migrations (n integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await db.query<{ n: number }>('SELECT n FROM _migrations');
  const done = new Set(rows.map((r) => Number(r.n)));
  let applied = 0;
  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (done.has(i + 1)) continue;
    await db.query('BEGIN');
    try {
      for (const stmt of MIGRATIONS[i]!.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      await db.query('INSERT INTO _migrations (n) VALUES ($1)', [i + 1]);
      await db.query('COMMIT');
      applied++;
    } catch (e) { await db.query('ROLLBACK'); throw e; }
  }
  return applied;
}
