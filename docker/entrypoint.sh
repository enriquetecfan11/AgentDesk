#!/bin/sh
# Applies pending database migrations, then hands over to CMD.
# Safe to run on every boot: drizzle's migrator is idempotent.
set -e

echo "[entrypoint] applying database migrations..."
node migrate.mjs

echo "[entrypoint] starting application..."
exec "$@"
