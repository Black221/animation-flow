// The test database: an in-memory PGlite by default, or a real PostgreSQL when TEST_DATABASE_URL is set. There, each
// call gets a schema of its own (dropped when it is closed), so a test that opens a second database does not wipe the
// first one; still point it at a throwaway database, and run the files one at a time (vitest --no-file-parallelism).
import { randomBytes } from 'node:crypto';
import { migrate, openDb, type Db } from '../src/db';

export async function openTestDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL ?? null;
  if (!url) { const db = await openDb({ url: null, memory: true }); await migrate(db); return db; }
  const schema = `test_${randomBytes(6).toString('hex')}`, admin = await openDb({ url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  // every connection of this database (the pool and the LISTEN one) works in that schema
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const db = await openDb({ url: u.toString() });
  await migrate(db);
  return {
    ...db,
    async close() { await db.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); },
  };
}
