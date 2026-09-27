// The test database: an in-memory PGlite by default, or a real PostgreSQL when TEST_DATABASE_URL is set. That
// database is WIPED (its public schema is recreated), so point it at a throwaway one, and run the files one at a
// time (vitest --no-file-parallelism).
import { migrate, openDb, type Db } from '../src/db';

export async function openTestDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL ?? null, db = await openDb({ url, memory: true });
  if (url) { await db.query('DROP SCHEMA public CASCADE'); await db.query('CREATE SCHEMA public'); }
  await migrate(db);
  return db;
}
