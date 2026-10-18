import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

type Pool = { sql: postgres.Sql; db: Database };

// The pool is created on first use, not at import time, so that `next build`
// does not require DATABASE_URL. It is cached on globalThis to survive the
// hot-reload cycle in development without leaking sockets.
const globalForDb = globalThis as unknown as { __agentdeskPool?: Pool };

function init(): Pool {
  if (globalForDb.__agentdeskPool) return globalForDb.__agentdeskPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and try again.');
  }

  const sql = postgres(connectionString, { max: 10, onnotice: () => {} });
  const pool: Pool = { sql, db: drizzle(sql, { schema }) };
  globalForDb.__agentdeskPool = pool;
  return pool;
}

/** Drizzle client. Safe to import anywhere on the server. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const value = Reflect.get(init().db, property, receiver);
    return typeof value === 'function' ? value.bind(init().db) : value;
  },
});

/** Raw postgres.js handle, for `sql` templates and LISTEN/NOTIFY. */
export function getSql(): postgres.Sql {
  return init().sql;
}

export { schema };
