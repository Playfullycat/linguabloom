# syntax=docker/dockerfile:1
#
# LinguaBloom production image (multi-stage).
#   deps    → install all npm dependencies (Linux binaries, e.g. Argon2 for musl)
#   builder → next build (standalone output) + bundle the database CLIs
#   runner  → minimal runtime, non-root user, migrations on start
#
# Build:  docker compose build app

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------- builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets are needed at build time: env, database and auth are created on
# first request (see src/lib/config/env.ts).
RUN npm run build && npm run build:ops

# -------------------------------------------------------------- runner ----
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_ROOT=/app/data \
    MIGRATIONS_DIR=/app/migrations

# Application code is owned by root (read-only for the app). Only .next (runtime
# cache / prerender output) and /app/data are writable by the `node` user.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/dist/ops ./ops
COPY --from=builder /app/src/db/migrations ./migrations
COPY docker/entrypoint.sh /usr/local/bin/linguabloom-entrypoint

RUN chmod 0755 /usr/local/bin/linguabloom-entrypoint \
 && mkdir -p /app/data \
 && chown -R node:node /app/data /app/.next

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["linguabloom-entrypoint"]
CMD ["node", "server.js"]
