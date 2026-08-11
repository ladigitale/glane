# Glane

Web instrument for capturing, segmenting, and arranging ambient sounds.

## Quick start

```bash
yarn setup           # deps + JWT + Docker API
yarn status          # environment status
yarn dev             # Vite → http://localhost:5173
```

Without Docker (front only):

```bash
yarn setup -- --no-docker
yarn dev
```

| Script | Role |
|--------|------|
| `yarn status` | Git, node_modules, compose ps, `/api/health`, JWT |
| `yarn setup` | Install + JWT + `env:up` (not `yarn install` — Yarn lifecycle) |
| `yarn update` | Refresh yarn (+ composer/rebuild if stack is up) |
| `yarn env:up` / `env:down` | FrankenPHP + Postgres stack |
| `yarn api:logs` / `api:migrate` | API ops |
| `yarn prod:install` / `prod:update` | VPS install / update (see `.ops/deploy.md`) |

See [AGENTS.md](AGENTS.md), [docs/adr/](docs/adr/), and [.ops/deploy.md](.ops/deploy.md) for production install/update.


## Workspaces

- `apps/web` — Lit PWA
- `apps/api` — Symfony + API Platform
- `packages/*` — audio-io, audio-dsp, audio-engine, waveform, gestures, core-model
