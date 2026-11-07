#!/usr/bin/env bash
# Back up LinguaBloom: database dump + user files + manifest.
#
#   bash scripts/backup.sh
#
# Creates backups/linguabloom-<UTC timestamp>/ containing
#   database.dump    PostgreSQL custom-format dump (pg_restore)
#   appdata.tar.gz   everything in /app/data (uploads, audio, cache)
#   env.template     variable NAMES from your env file (no values, no secrets)
#   manifest.txt     versions + SHA-256 checksums (checked by restore.sh)
#
# A backup needs BOTH the database and the files: the database without files
# loses your uploads and recordings; files without the database lose your
# progress and the index of what those files are.
#
# The backup contains personal learning data — store it somewhere safe.

source "$(dirname "$0")/ops-common.sh"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR:-backups}/linguabloom-$stamp"
mkdir -p "$out"
log "writing backup to $out"

compose ps --status running --services | grep -qx db || die "The db service is not running (docker compose up -d)."

log "dumping database"
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  >"$out/database.dump"

log "archiving user files (/app/data)"
compose run --rm --no-deps -T --entrypoint tar app -czf - -C /app/data . >"$out/appdata.tar.gz"

log "recording environment variable names (no values)"
grep -E '^[A-Z0-9_]+=' "$ENV_FILE" | sed -E 's/=.*$/=/' >"$out/env.template"

migrations="$(compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "select count(*) from drizzle.__drizzle_migrations"' 2>/dev/null | tr -d '[:space:]' || true)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

{
  echo "linguabloom-backup-format: 1"
  echo "created_at: $stamp"
  echo "app_version: $(app_version)"
  echo "git_commit: $commit"
  echo "migrations_applied: ${migrations:-unknown}"
  echo "sha256 database.dump $(sha256_file "$out/database.dump")"
  echo "sha256 appdata.tar.gz $(sha256_file "$out/appdata.tar.gz")"
} >"$out/manifest.txt"

[ -s "$out/database.dump" ] || die "Database dump is empty — backup failed."

log "done: $(du -sh "$out" | cut -f1) in $out"
log "restore with: bash scripts/restore.sh $out"
