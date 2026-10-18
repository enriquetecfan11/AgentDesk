/**
 * Applies pending migrations and exits.
 *
 * Bundled with esbuild into /app/migrate.mjs during the Docker build, so the
 * runtime image needs neither drizzle-kit nor any devDependency. The docker
 * entrypoint runs this before starting the server.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

// Resolves to /app/drizzle in the image (migrate.mjs sits next to it).
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? new URL('./drizzle', import.meta.url).pathname;

const sql = postgres(connectionString, { max: 1 });

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('[migrate] done');
} catch (error) {
  console.error('[migrate] failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
