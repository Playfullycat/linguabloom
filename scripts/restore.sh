#!/usr/bin/env bash
# Restore LinguaBloom from a backup made by scripts/backup.sh.
#
#   bash scripts/restore.sh backups/linguabloom-<timestamp> [--yes]
#
# 1. Verifies the backup (checksums, readable dump) BEFORE touching anything.
# 2. Stops the app, replaces the database and /app/data with the backup.
# 3. Starts the app; it applies any newer migrations on start.
#
# This REPLACES current data. Make a fresh backup first if unsure.

source "$(dirname "$0")/ops-common.sh"

dir="${1:-}"
assume_yes="${2:-}"
[ -n "$dir" ] || die "Usage: bash scripts/restore.sh <backup-dir> [--yes]"
[ -d "$dir" ] || die "Backup directory '$dir' not found."
for f in manifest.txt database.dump appdata.tar.gz; do
  [ -s "$dir/$f" ] || die "Backup is incomplete: $dir/$f is missing or empty."
done

log "verifying checksums"
while read -r kind name expected; do
  [ "$kind" = "sha256" ] || continue
  actual="$(sha256_file "$dir/$name")"
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $name — the backup is damaged."
done <"$dir/manifest.txt"
grep -E '^(created_at|app_version|git_commit|migrations_applied):' "$dir/manifest.txt" | sed 's/^/  /'

log "starting database (if needed)"
compose up -d --wait db >/dev/null

log "checking that the dump is readable"
compose exec -T db pg_restore --list <"$dir/database.dump" >/dev/null || die "database.dump cannot be read by pg_restore."

if [ "$assume_yes" != "--yes" ]; then
  printf 'This will REPLACE the current database and user files with the backup. Continue? [y/N] '
  read -r answer
  case "$answer" in y | Y | yes | YES) ;; *) die "Restore cancelled. Nothing was changed." ;; esac
fi

log "stopping the app"
compose stop app >/dev/null 2>&1 || true

log "restoring database"
compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "set client_min_messages = warning; drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;"'
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' <"$dir/database.dump"

log "restoring user files"
compose run --rm --no-deps -T --entrypoint sh app -c 'find /app/data -mindepth 1 -delete && tar -xzf - -C /app/data' <"$dir/appdata.tar.gz"

log "starting the app (pending migrations run automatically)"
compose up -d app >/dev/null
if wait_for_health 180; then
  log "restore complete — the app is healthy"
else
  die "The app did not become healthy. Check: docker compose logs app"
fi
