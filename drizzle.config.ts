import { defineConfig } from 'drizzle-kit';

// drizzle-kit is only used from the host, never inside the container.
// For local development point DATABASE_URL at the published db port, e.g.
//   postgresql://agentdesk:...@127.0.0.1:5432/agentdesk
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
