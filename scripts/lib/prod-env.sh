#!/usr/bin/env bash
# Shared helpers for install-prod.sh / update-prod.sh (sourced, not executed).

: "${ROOT:?}"
: "${ENV_FILE:=$ROOT/.env}"

RED=${RED:-$'\033[0;31m'}
GRN=${GRN:-$'\033[0;32m'}
YLW=${YLW:-$'\033[1;33m'}
CYN=${CYN:-$'\033[0;36m'}
BLD=${BLD:-$'\033[1m'}
RST=${RST:-$'\033[0m'}

say() { printf '%s\n' "$*"; }
info() { printf '%s→%s %s\n' "$CYN" "$RST" "$*"; }
ok() { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
die() { printf '%s✗%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

ensure_env_key() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  ok "Added ${key} to .env"
}

ensure_prod_env_defaults() {
  local app_host="$1" api_host="$2"
  ensure_env_key "APP_PUBLIC_URL" "https://${app_host}"
  ensure_env_key "FRONT_URL" "https://${app_host}"
  ensure_env_key "APP_NAME" "Glane"
  ensure_env_key "MERCURE_ENABLED" "0"
  ensure_env_key "MERCURE_PUBLIC_URL" "https://${api_host}/.well-known/mercure"
  ensure_env_key "JWT_PASSPHRASE" "glane"
  ensure_env_key "HTTP_PORT" "80"
  ensure_env_key "HTTPS_PORT" "443"
  ensure_env_key "HTTP3_PORT" "443"
  ensure_env_key "GLANE_COHOST" "0"
  ensure_env_key "WEB_NETWORK" "web"
}

# Sets COMPOSE=(docker compose …) from GLANE_COHOST / .env.
compose_prod_cmd() {
  COMPOSE=(docker compose -f compose.prod.yaml)
  if [[ "${GLANE_COHOST:-0}" == "1" ]]; then
    COMPOSE+=(-f compose.prod.cohost.yaml)
    info "Cohost mode: no Glane edge (WEB_NETWORK=${WEB_NETWORK:-web})"
  fi
}
