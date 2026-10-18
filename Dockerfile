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

# Bundle the migration runner into a single self-contained file so the
# runtime stage needs no devDependencies (drizzle-kit) at all.
RUN npx esbuild scripts/migrate.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=esm \
      --outfile=migrate.mjs

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
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh \
 && mkdir -p /app/uploads \
 && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

# entrypoint applies pending migrations, then execs CMD.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
