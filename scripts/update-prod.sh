#!/usr/bin/env bash
# Production update for an existing Glane Compose deploy.
#   bash scripts/update-prod.sh
#   bash scripts/update-prod.sh --pull

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

# shellcheck source=lib/prod-env.sh
source "$ROOT/scripts/lib/prod-env.sh"

COMPOSE=(docker compose -f compose.prod.yaml)
DO_PULL=0

for arg in "$@"; do
  case "$arg" in
    --pull) DO_PULL=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/update-prod.sh [--pull]

  --pull   git pull --ff-only before building

Set GLANE_COHOST=1 in .env to skip Glane edge and join WEB_NETWORK (Tadaaa cohost).
EOF
      exit 0
      ;;
    *)
      die "Unknown option: $arg (try --help)"
      ;;
  esac
done

[[ -f "$ENV_FILE" ]] || die "Missing ${ENV_FILE}. Run scripts/install-prod.sh first."

say ""
say "${BLD}Glane — production update${RST}"
say "Repo root: $ROOT"
say ""

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

app_host="${APP_SERVER_NAME:-}"
api_host="${API_SERVER_NAME:-}"
[[ -n "$app_host" && -n "$api_host" ]] || die "APP_SERVER_NAME / API_SERVER_NAME missing in .env"

if [[ "$DO_PULL" -eq 1 ]]; then
  need_cmd git
  info "git pull --ff-only…"
  git pull --ff-only
  ok "Git up to date."
fi

info "Ensuring new .env defaults…"
ensure_prod_env_defaults "$app_host" "$api_host"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
compose_prod_cmd

need_cmd docker
need_cmd curl

if [[ "${GLANE_COHOST:-0}" == "1" ]]; then
  if ! docker network inspect "${WEB_NETWORK:-web}" >/dev/null 2>&1; then
    info "Creating Docker network ${WEB_NETWORK:-web}…"
    docker network create "${WEB_NETWORK:-web}"
    ok "Network ${WEB_NETWORK:-web} created."
  fi
fi

info "Building front (VITE_API_BASE_URL=https://${api_host})…"
rm -rf "$ROOT/node_modules" "$ROOT/apps/web/node_modules"
docker run --rm \
  -v "$ROOT:/repo" \
  -w /repo \
  -e VITE_API_BASE_URL="https://${api_host}" \
  node:22-bookworm \
  bash -lc 'corepack enable && yarn install --frozen-lockfile && yarn --cwd apps/web build'
[[ -f "$ROOT/apps/web/dist/index.html" ]] || die "Front build failed."
ok "Front build ready."

info "Recreating stack…"
"${COMPOSE[@]}" up -d --build
ok "Containers up."
if [[ "${GLANE_COHOST:-0}" == "1" ]]; then
  docker compose -f compose.prod.yaml stop edge >/dev/null 2>&1 || true
  docker compose -f compose.prod.yaml rm -f edge >/dev/null 2>&1 || true
fi

info "Migrations…"
"${COMPOSE[@]}" exec -T php bin/console doctrine:migrations:migrate --no-interaction
ok "Migrations done."

if curl -fsS --max-time 10 "https://${api_host}/api/health" >/dev/null 2>&1; then
  ok "API healthy: https://${api_host}/api/health"
else
  warn "API not reachable yet — check DNS / Tadaaa edge / logs: ${COMPOSE[*]} logs -f php"
fi

say ""
say "${BLD}Update complete.${RST}"
say "  Front: https://${app_host}"
say "  API:   https://${api_host}/api"
if [[ "${GLANE_COHOST:-0}" == "1" ]]; then
  say "  Cohost: wire Tadaaa edge — see .ops/deploy.md"
fi
say ""
