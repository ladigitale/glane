#!/usr/bin/env bash
# Glane — env / status / install helpers
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
ko() { printf '  ✗ %s\n' "$*"; }
info() { printf '  · %s\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

ensure_network() {
  if ! docker network inspect supersoniks >/dev/null 2>&1; then
    info "Création réseau Docker supersoniks…"
    docker network create supersoniks >/dev/null
  fi
}

cmd_status() {
  bold "Glane — status"
  info "root: $ROOT"
  echo

  bold "Git"
  if [[ -d .git ]]; then
    local branch head dirty
    branch="$(git branch --show-current 2>/dev/null || true)"
    [[ -n "$branch" ]] || branch="(detached)"
    head="$(git log -1 --oneline 2>/dev/null || true)"
    [[ -n "$head" ]] || head="(no commits)"
    info "branch: $branch"
    info "head:   $head"
    dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "$dirty" == "0" ]]; then
      ok "working tree clean"
    else
      ko "$dirty fichier(s) modifié(s) / non suivis"
    fi
  else
    ko "pas de dépôt git"
  fi
  echo

  bold "Node / Yarn"
  if have node; then
    ok "node $(node -v)"
  else
    ko "node introuvable (utiliser ssks yarn …)"
  fi
  if have yarn; then
    ok "yarn $(yarn -v 2>/dev/null || echo '?')"
  else
    ko "yarn introuvable"
  fi
  if [[ -d node_modules ]]; then
    ok "node_modules présent"
  else
    ko "node_modules absent — lancer: yarn setup"
  fi
  if [[ -f yarn.lock ]]; then
    ok "yarn.lock"
  else
    ko "yarn.lock manquant"
  fi
  echo

  bold "API (Docker Compose)"
  if have docker; then
    if docker info >/dev/null 2>&1; then
      ok "docker daemon OK"
    else
      ko "docker daemon inaccessible"
      return 0
    fi
    if docker network inspect supersoniks >/dev/null 2>&1; then
      ok "réseau supersoniks"
    else
      info "réseau supersoniks absent (créé au yarn env:up)"
    fi
    echo
    compose ps 2>/dev/null || ko "compose ps échoué"
    echo
    local http_port https_port
    http_port="${HTTP_PORT:-8081}"
    https_port="${HTTPS_PORT:-8444}"
    info "HTTP  http://localhost:${http_port}"
    info "HTTPS https://localhost:${https_port}"
    info "Vite  http://localhost:5173  (yarn dev)"
    if curl -sf "http://localhost:${http_port}/api/health" >/dev/null 2>&1; then
      ok "GET /api/health"
    else
      info "/api/health pas joignable (api down ou pas encore installée)"
    fi
  else
    ko "docker introuvable"
  fi
  echo

  bold "JWT"
  if [[ -f apps/api/config/jwt/private.pem && -f apps/api/config/jwt/public.pem ]]; then
    ok "clés JWT présentes"
  else
    info "clés JWT absentes — yarn jwt:generate"
  fi
  echo

  bold "Commandes utiles"
  info "yarn setup      # deps + JWT + docker"
  info "yarn update     # refresh deps front + rebuild api"
  info "yarn env:up     # docker compose up"
  info "yarn env:down   # docker compose down"
  info "yarn status     # ce rapport"
  info "yarn dev        # front Vite"
}

cmd_jwt() {
  mkdir -p apps/api/config/jwt
  if [[ -f apps/api/config/jwt/private.pem ]]; then
    ok "JWT déjà présentes"
    return 0
  fi
  if ! have openssl; then
    ko "openssl requis"
    exit 1
  fi
  bold "Génération clés JWT…"
  openssl genpkey -algorithm RSA -out apps/api/config/jwt/private.pem -pkeyopt rsa_keygen_bits:4096
  openssl rsa -pubout -in apps/api/config/jwt/private.pem -out apps/api/config/jwt/public.pem
  chmod 640 apps/api/config/jwt/private.pem
  chmod 644 apps/api/config/jwt/public.pem
  ok "JWT OK (apps/api/config/jwt/)"
}

cmd_env_up() {
  bold "Glane — env:up"
  ensure_network
  compose up --build -d
  ok "stack API démarrée"
  info "logs: yarn api:logs"
  cmd_status
}

cmd_env_down() {
  bold "Glane — env:down"
  compose down
  ok "stack arrêtée"
}

cmd_env_restart() {
  bold "Glane — env:restart"
  compose restart
  ok "services redémarrés"
}

cmd_setup() {
  bold "Glane — setup"
  local with_docker=1
  for arg in "$@"; do
    case "$arg" in
      --no-docker) with_docker=0 ;;
    esac
  done

  info "yarn install…"
  if ! yarn install --ignore-scripts; then
    if [[ -d node_modules ]]; then
      ko "yarn install a échoué (EBUSY/lock fréquent) — node_modules déjà là, on continue"
    else
      ko "yarn install a échoué et node_modules absent"
      exit 1
    fi
  fi

  cmd_jwt

  if [[ "$with_docker" == "1" ]]; then
    if have docker && docker info >/dev/null 2>&1; then
      ensure_network
      compose up --build -d
      if compose exec -T php test -f /app/composer.json 2>/dev/null; then
        info "composer install (conteneur php)…"
        compose exec -T php composer install --no-interaction || {
          ko "composer install a échoué (image / vendor à corriger plus tard)"
        }
      fi
      if compose exec -T php test -f /app/bin/console 2>/dev/null; then
        info "migrations…"
        compose exec -T php bin/console doctrine:migrations:migrate --no-interaction 2>/dev/null || \
          info "pas de migrations (normal tant que vendor/API incomplets)"
      fi
    else
      ko "Docker indisponible — deps front OK, skip API"
      info "relancer plus tard: yarn env:up"
    fi
  else
    info "skip docker (--no-docker)"
  fi

  echo
  ok "setup terminé"
  cmd_status
}

cmd_update() {
  bold "Glane — update"
  info "yarn install (lockfile)…"
  if ! yarn install --ignore-scripts; then
    if [[ -d node_modules ]]; then
      ko "yarn install a échoué — node_modules présent, on continue"
    else
      exit 1
    fi
  fi

  if have docker && docker info >/dev/null 2>&1; then
    if compose ps --status running -q 2>/dev/null | grep -q .; then
      info "composer update (conteneur)…"
      compose exec -T php composer update --no-interaction 2>/dev/null || \
        info "composer update skip (API pas prête)"
      info "rebuild images…"
      compose up --build -d
      compose exec -T php bin/console doctrine:migrations:migrate --no-interaction 2>/dev/null || true
      compose exec -T php bin/console cache:clear 2>/dev/null || true
    else
      info "stack down — yarn env:up pour rebuild"
    fi
  fi

  ok "update terminé"
  cmd_status
}

usage() {
  cat <<EOF
Usage: scripts/glane.sh <command>

  status         État git / yarn / docker / health / JWT
  setup [--no-docker]
                 Install deps, JWT, démarre Compose (+ composer si possible)
  update         Refresh yarn (+ composer/rebuild si stack up)
  env:up         docker compose up --build -d
  env:down       docker compose down
  env:restart    docker compose restart
  jwt            Génère les clés Lexik JWT si absentes
EOF
}

main() {
  local cmd="${1:-status}"
  shift || true
  case "$cmd" in
    status) cmd_status "$@" ;;
    setup) cmd_setup "$@" ;;
    update) cmd_update "$@" ;;
    env:up|up) cmd_env_up "$@" ;;
    env:down|down) cmd_env_down "$@" ;;
    env:restart|restart) cmd_env_restart "$@" ;;
    jwt|jwt:generate) cmd_jwt "$@" ;;
    -h|--help|help) usage ;;
    *)
      echo "Commande inconnue: $cmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
