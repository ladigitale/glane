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
- `apps/mcp` — Claude connector: MCP relay to the open Glane tab (ADR-0024)
- `packages/*` — audio-io, audio-dsp, audio-engine, waveform, gestures, core-model, composer, agent (score format for agents)

## Claude connector

Claude can compose a full arrangement from your library and play it in the app.

1. Run the relay: `yarn mcp:dev` locally (port 8787), or the `mcp` service in `compose.prod.yaml` (Caddy routes `/mcp/*` and `/agent/*` on the API host).
2. The web app reaches it through `VITE_AGENT_RELAY_URL` (default: `VITE_API_BASE_URL`).
3. In Glane: **Compte › Connecteur Claude › Activer**, copy the URL (`https://<api-host>/mcp/<token>`).
4. In Claude: Settings › Connectors › Add custom connector, paste the URL.

Keep the Glane tab open: the relay stores nothing and forwards every tool call to it. Claude.ai cannot reach `localhost`, so test locally with an MCP client or a tunnel.
