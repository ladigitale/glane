# Glane

Instrument web de captation / segmentation / arrangement de sons d'ambiance.

## Quick start

```bash
yarn setup           # deps + JWT + Docker API
yarn status          # état de l’env
yarn dev             # Vite → http://localhost:5173
```

Sans Docker (front only) :

```bash
yarn setup -- --no-docker
# ou : ssks yarn setup -- --no-docker
ssks yarn dev
```

| Script | Rôle |
|--------|------|
| `yarn status` | Git, node_modules, compose ps, `/api/health`, JWT |
| `yarn setup` | Install + JWT + `env:up` (pas `yarn install` — lifecycle Yarn) |
| `yarn update` | Refresh yarn (+ composer/rebuild si stack up) |
| `yarn env:up` / `env:down` | Stack FrankenPHP + Postgres |
| `yarn api:logs` / `api:migrate` | Ops API |
| `yarn prod:install` / `prod:update` | VPS install / update (voir `.ops/deploy.md`) |

See [AGENTS.md](AGENTS.md), [docs/adr/](docs/adr/), and [.ops/deploy.md](.ops/deploy.md) for production install/update.


## Workspaces

- `apps/web` — Lit PWA
- `apps/api` — Symfony + API Platform
- `packages/*` — audio-io, audio-dsp, audio-engine, waveform, gestures, core-model
