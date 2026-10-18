import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // Domain logic and API helpers are pure Node: no jsdom needed.
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'drizzle'],
  },
});
