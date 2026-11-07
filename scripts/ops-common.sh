# Shared helpers for the LinguaBloom ops scripts. Sourced, not executed.
#
# Environment:
#   ENV_FILE              env file passed to docker compose (default: .env)
#   COMPOSE_PROJECT_NAME  compose project (default: from docker-compose.yml)

set -euo pipefail

# Git Bash on Windows rewrites arguments like /app/data into Windows paths
# before they reach docker. Container paths must pass through unchanged.
export MSYS_NO_PATHCONV=1

# Always run from the repository root.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="${ENV_FILE:-.env}"

log() { printf '\033[1;35m[linguabloom]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warning]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "Env file '$ENV_FILE' not found. Copy .env.example to .env first."
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# Read KEY from the env file without executing it as shell code.
env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

app_version() {
  grep -m1 '"version"' package.json | sed -E 's/.*"version": *"([^"]+)".*/\1/'
}

# Local URL of the app's health endpoint (APP_PORT may be "127.0.0.1:3000").
health_url() {
  local port
  port="$(env_get APP_PORT)"
  port="${port:-3000}"
  printf 'http://127.0.0.1:%s/api/health' "${port##*:}"
}

http_get() {
  if command -v curl >/dev/null 2>&1; then curl -fsS --max-time 10 "$1"
  else wget -q -T 10 -O - "$1"
  fi
}

# Wait until the app reports healthy (default 120 s).
wait_for_health() {
  local timeout="${1:-120}" url waited=0
  url="$(health_url)"
  until http_get "$url" >/dev/null 2>&1; do
    waited=$((waited + 3))
    [ "$waited" -ge "$timeout" ] && return 1
    sleep 3
  done
}
