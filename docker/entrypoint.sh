#!/bin/sh
# LinguaBloom container entrypoint.
# Applies pending migrations and idempotent seeds, then starts the server.
# The app only starts if migrations succeed (never on a half-migrated schema).
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  node /app/ops/db-migrate.mjs
fi

if [ "${RUN_SEEDS:-true}" = "true" ]; then
  echo "[entrypoint] loading seed content"
  node /app/ops/db-seed.mjs
fi

echo "[entrypoint] starting LinguaBloom on port ${PORT:-3000}"
exec "$@"
