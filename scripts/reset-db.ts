/**
 * DESTRUCTIVE dev helper: drops and recreates the public schema, then applies
 * all migrations from scratch.
 *
 *   npm run db:reset
 *
 * Refuses to run against NODE_ENV=production.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

if (process.env.NODE_ENV === 'production') {
  console.error('[reset] refusing to run with NODE_ENV=production');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('[reset] DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  console.log('[reset] dropping schema public...');
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;

  console.log('[reset] applying migrations...');
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });

  console.log('[reset] done — database is empty and up to date');
} finally {
  await sql.end();
}
