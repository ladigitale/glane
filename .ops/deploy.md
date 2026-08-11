# Production deployment — Glane

Provider-agnostic (Hetzner, Infomaniak VPS, Compose over SSH…).  
Stack: FrankenPHP (API) + PostgreSQL + static SPA (`apps/web/dist`) + edge Caddy.

Same family as Tadaaa. **Separate** Compose project and DB (`glane`). Do not share Postgres with Tadaaa. The Docker network `supersoniks` is **local devops only** — prod compose does not use it.

## Guided install

```bash
git clone <your-glane-repo>
cd glane
bash scripts/install-prod.sh
```

Prompts for base domain → writes root `.env` (gitignored), builds SPA, `compose.prod.yaml up`, JWT keys, migrations.

### Updating

```bash
cd glane
bash scripts/update-prod.sh --pull
```

Merges missing `.env` keys, rebuilds SPA, recreates containers, migrates.

Aliases (optional):

```bash
yarn prod:install
yarn prod:update -- --pull
```

## Co-hosting with Tadaaa

| Concern | Rule |
|---------|------|
| Ports 80/443 | Only one edge per host. If Tadaaa owns them, reverse-proxy `glane.*` / `glane-api.*` to Glane `php:80` (or shift `HTTP_PORT`). |
| DB | `POSTGRES_DB=glane` in its own container (or dedicated DB on shared Postgres). |
| Volumes | Prefixed by compose project name (`glane_*` vs `tada_*`). Listen MP3s on volume `listen_data`. |
| DNS | Distinct `APP_SERVER_NAME` / `API_SERVER_NAME` (e.g. `glane.example.com` / `glane-api.example.com`). |

## Env files

| File | Role |
|------|------|
| `/.env` (gitignored) | Compose secrets — written by `install-prod.sh` |
| `apps/api/.env` (committed) | Symfony placeholders so `composer dump-env prod` works in the image; Compose env overrides at runtime |
| `apps/api/.env.local` | Local overrides only (gitignored) |

## Manual env sketch

```bash
APP_SERVER_NAME=glane.example.com
API_SERVER_NAME=glane-api.example.com
ACME_EMAIL=you@example.com
APP_SECRET=…
POSTGRES_DB=glane
POSTGRES_USER=app
POSTGRES_PASSWORD=…
CORS_ALLOW_ORIGIN=^https://glane\.example\.com$
APP_PUBLIC_URL=https://glane.example.com
FRONT_URL=https://glane.example.com
MERCURE_ENABLED=0
```

```bash
VITE_API_BASE_URL=https://glane-api.example.com yarn build
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml exec php bin/console doctrine:migrations:migrate --no-interaction
```

## Files

| Path | Role |
|------|------|
| `compose.prod.yaml` | edge + php + database + `jwt_keys` + `listen_data` |
| `deploy/Caddyfile.edge` | TLS SPA + API reverse proxy |
| `scripts/install-prod.sh` / `update-prod.sh` | One-shot install / update |
