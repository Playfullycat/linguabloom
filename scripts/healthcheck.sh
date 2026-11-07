#!/usr/bin/env bash
# Check a running LinguaBloom installation.
#
#   bash scripts/healthcheck.sh
#
# Checks containers, the app health endpoint, the database, free disk space
# and whether AI is configured (never prints secret values).
# Exit code 0 = all good, 1 = something needs attention.

source "$(dirname "$0")/ops-common.sh"

status=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; status=1; }
note() { printf '  \033[33m•\033[0m %s\n' "$*"; }

log "containers"
for service in db app; do
  if compose ps --status running --services | grep -qx "$service"; then ok "$service is running"
  else bad "$service is not running (docker compose up -d)"; fi
done

log "application"
if body="$(http_get "$(health_url)" 2>/dev/null)"; then
  ok "health endpoint: $body"
else
  bad "health endpoint not reachable at $(health_url)"
fi

log "database"
if compose exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>/dev/null; then
  ok "PostgreSQL accepts connections"
else
  bad "PostgreSQL is not ready"
fi

log "disk"
free_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
if [ "${free_kb:-0}" -lt 1048576 ]; then bad "less than 1 GB free on this disk ($(df -Ph . | awk 'NR==2 {print $4}'))"
else ok "free space: $(df -Ph . | awk 'NR==2 {print $4}')"; fi

log "AI provider"
if [ "$(env_get AI_ENABLED)" = "true" ]; then
  if [ -n "$(env_get AI_API_KEY)" ]; then ok "AI enabled, API key is set"
  else bad "AI_ENABLED=true but AI_API_KEY is empty"; fi
else
  note "AI disabled (non-AI features work normally)"
fi

exit "$status"
