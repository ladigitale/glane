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
Answer **y** to “Cohost behind Tadaaa edge?” when Tadaaa already binds 80/443 (sets `GLANE_COHOST=1`).

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

One public edge only (Tadaaa). Glane runs `php` + `database` on shared Docker network `web`; Tadaaa Caddy terminates TLS and routes `glane.*` / `glane-api.*`.

| Concern | Rule |
|---------|------|
| Ports 80/443 | Tadaaa edge only. Glane edge is not started (`compose.prod.cohost.yaml`). |
| Network | External Docker network `web` (`WEB_NETWORK`). Alias `glane-php` for the API. |
| DB | `POSTGRES_DB=glane` in its own container. |
| SPA | Tadaaa edge mounts `glane/apps/web/dist` at `/srv-glane`. |
| DNS | `APP_SERVER_NAME` / `API_SERVER_NAME` (e.g. `glane.tadaaa.space` / `glane-api.tadaaa.space`). |

### Files

| Path | Role |
|------|------|
| [`compose.prod.cohost.yaml`](../compose.prod.cohost.yaml) | Disable Glane edge; attach `php` to `web` as `glane-php` |
| [`deploy/tadaaa-cohost/`](../deploy/tadaaa-cohost/) | Overlay + Caddy snippet for the Tadaaa project |
| Tadaaa `deploy/Caddyfile.edge` | `import /etc/caddy/cohost/*.caddy` |
| Tadaaa `deploy/cohost/` | Mount point for snippets (empty when solo) |

### VPS runbook (port 80 already taken)

Assumes clones at `/root/glane` and `/root/tadaaa`, hosts `glane.tadaaa.space` + `glane-api.tadaaa.space`.

```bash
# 0) Shared network (once)
docker network create web || true

# 1) Glane — cohost stack (no edge)
cd /root/glane
git pull --ff-only
# Ensure root .env has:
#   GLANE_COHOST=1
#   WEB_NETWORK=web
grep -q '^GLANE_COHOST=' .env && sed -i 's/^GLANE_COHOST=.*/GLANE_COHOST=1/' .env || echo 'GLANE_COHOST=1' >> .env
grep -q '^WEB_NETWORK=' .env || echo 'WEB_NETWORK=web' >> .env
bash scripts/update-prod.sh
# If edge still exists from a failed solo up:
docker compose -f compose.prod.yaml stop edge 2>/dev/null || true
docker compose -f compose.prod.yaml rm -f edge 2>/dev/null || true

# JWT + migrate if install never finished:
docker compose -f compose.prod.yaml -f compose.prod.cohost.yaml exec -T php sh -c '
  mkdir -p config/jwt var/listens
  if [ ! -f config/jwt/private.pem ]; then
    openssl genpkey -algorithm RSA -out config/jwt/private.pem -pkeyopt rsa_keygen_bits:4096
    openssl rsa -pubout -in config/jwt/private.pem -out config/jwt/public.pem
    chmod 640 config/jwt/private.pem
    chmod 644 config/jwt/public.pem
  fi
'
docker compose -f compose.prod.yaml -f compose.prod.cohost.yaml exec -T php \
  bin/console doctrine:migrations:migrate --no-interaction

# 2) Tadaaa — import line + cohost mount (need Caddyfile with import /etc/caddy/cohost/*.caddy)
cd /root/tadaaa
git pull --ff-only   # or patch Caddyfile.edge manually if not yet merged
# Optional in tadaaa .env:
#   GLANE_ROOT=/root/glane
#   GLANE_APP_SERVER_NAME=glane.tadaaa.space
#   GLANE_API_SERVER_NAME=glane-api.tadaaa.space
#   WEB_NETWORK=web
export GLANE_ROOT=/root/glane
export GLANE_APP_SERVER_NAME=glane.tadaaa.space
export GLANE_API_SERVER_NAME=glane-api.tadaaa.space
docker compose -f compose.prod.yaml \
  -f /root/glane/deploy/tadaaa-cohost/compose.prod.glane-cohost.yaml \
  up -d edge

# 3) Smoke
curl -fsS https://glane-api.tadaaa.space/api/health
curl -fsSI https://glane.tadaaa.space | head -5
```

If Tadaaa cannot pull yet, add this line at the end of `~/tadaaa/deploy/Caddyfile.edge`:

```caddy
import /etc/caddy/cohost/*.caddy
```

and ensure `compose.prod.yaml` mounts `./deploy/cohost:/etc/caddy/cohost:ro` (create an empty `deploy/cohost` dir).

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
GLANE_COHOST=0
WEB_NETWORK=web
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
| `compose.prod.cohost.yaml` | Cohost overlay (no Glane edge) |
| `deploy/Caddyfile.edge` | TLS SPA + API reverse proxy (solo) |
| `deploy/tadaaa-cohost/` | Tadaaa edge overlay + `glane.caddy` |
| `scripts/install-prod.sh` / `update-prod.sh` | One-shot install / update |
