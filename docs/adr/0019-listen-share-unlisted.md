# ADR-0019 — Unlisted listen shares + prod co-host with Tadaaa

## Context

Artists need to share an arrangement for listening without a marketplace (ADR-0012) and without full project sync (ADR-0002). Glane will run on the same VPS family as Tadaaa.

## Decision

1. **Listen share** — client bounce to MP3, upload via `POST /api/listens` (JWT). Opaque URL token. Visibility `unlisted` (anyone with link) or `private` (owner only / 404). Files under `APP_LISTEN_DIR` (default `var/listens`); prod volume `listen_data`.
2. **Auth** — `POST /api/auth/register` + Lexik `POST /api/auth/login`. No Tadaaa SSO in this milestone (ADR-0007 later).
3. **No marketplace listing** — no public feed of listens.
4. **Prod** — mirror Tadaaa: `compose.prod.yaml` + edge Caddy + `install-prod.sh` / `update-prod.sh`. Separate DB `glane`. `supersoniks` network remains local-devops only.

## Consequences

- Guest player at `/listen/:token` streams `/api/listens/{token}/audio`.
- Disk growth must be monitored; no object storage yet.
- Co-host: avoid double-binding 80/443 with Tadaaa edge.
