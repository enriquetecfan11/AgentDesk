# syntax=docker/dockerfile:1
#
# Multi-stage build for AgentDesk.
# No platform-specific steps: the same Dockerfile builds natively on the
# Mac mini (linux/arm64) and on Proxmox (linux/amd64). Each machine runs
# `docker compose build`, so no cross-compilation or registry is required.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install node_modules from the lockfile only (best layer caching)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build: compile Next.js and bundle the migration runner
# ---------------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Bundle the migration runner and the password-reset tool into self-contained
# files so the runtime stage needs no devDependencies (drizzle-kit, tsx) at all.
# `@node-rs/argon2` is left external: it is a native .node binary that must not
# be inlined, and it is copied into the runner image explicitly below.
RUN npx esbuild scripts/migrate.ts \
      --bundle --platform=node --target=node22 --format=esm \
      --outfile=migrate.mjs \
 && npx esbuild scripts/reset-password.ts \
      --bundle --platform=node --target=node22 --format=esm \
      --external:@node-rs/argon2 \
      --outfile=reset-password.mjs

RUN npm run build

# ---------------------------------------------------------------------------
# runner: minimal runtime image
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/app/uploads

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/migrate.mjs ./migrate.mjs
COPY --from=build --chown=nextjs:nodejs /app/reset-password.mjs ./reset-password.mjs
COPY --from=build --chown=nextjs:nodejs /app/mcp ./mcp
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh

# @node-rs/argon2 loads its prebuilt .node binary through a dynamic require,
# which Next's output tracer cannot follow. Copy the platform packages
# explicitly (npm only installs the one matching the build architecture).
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@node-rs ./node_modules/@node-rs

RUN chmod +x ./entrypoint.sh \
 && mkdir -p /app/uploads \
 && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

# entrypoint applies pending migrations, then execs CMD.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
