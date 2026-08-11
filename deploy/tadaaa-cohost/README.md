# Tadaaa cohost snippets (Glane)

Used when Glane shares a VPS with Tadaaa (Tadaaa owns :80/:443).

| File | Role |
|------|------|
| `glane.caddy` | Site blocks for front + API (env hostnames) |
| `compose.prod.glane-cohost.yaml` | Mount dist + snippet; join network `web` |

See [../../.ops/deploy.md](../../.ops/deploy.md) § Co-hosting / VPS runbook.
