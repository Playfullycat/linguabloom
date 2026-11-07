#!/usr/bin/env bash
# Update LinguaBloom: pull, back up, rebuild, migrate, restart, verify.
#
#   bash scripts/update.sh            # git pull (fast-forward only) + update
#   bash scripts/update.sh --no-pull  # rebuild what is checked out now
#
# Migrations run automatically when the new container starts. If anything
# fails, follow the rollback steps printed at the end.

source "$(dirname "$0")/ops-common.sh"

previous_commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [ "${1:-}" != "--no-pull" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    log "pulling latest code (fast-forward only)"
    git pull --ff-only
  else
    warn "no upstream branch configured — skipping git pull"
  fi
fi

log "backing up before the update"
backup_output="$(bash scripts/backup.sh | tee /dev/stderr)"
backup_dir="$(printf '%s\n' "$backup_output" | sed -n 's/.*restore with: bash scripts\/restore.sh //p' | tail -n 1)"

log "building the new image"
compose build app

log "restarting (migrations run on start)"
compose up -d

if wait_for_health 180 && bash scripts/healthcheck.sh; then
  log "update complete ($previous_commit → $(git rev-parse --short HEAD 2>/dev/null || echo unknown))"
else
  warn "the updated app is not healthy. Logs: docker compose logs app"
  cat >&2 <<EOF

Rollback:
  1. git checkout $previous_commit
  2. docker compose --env-file $ENV_FILE up -d --build
  3. If the database was migrated and the old version cannot use it:
       bash scripts/restore.sh ${backup_dir:-<backup-dir>}
EOF
  exit 1
fi
