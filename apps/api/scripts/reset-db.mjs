// Empties a test database (all tables of the public schema): used by the two-process browser test. Never point it at real data.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await c.end();
