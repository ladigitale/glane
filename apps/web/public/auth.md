# Authentication for agents

Glane is local-first: your library, analyses and arrangements live in the browser (IndexedDB / OPFS), not on a server. An agent therefore works **through the Glane tab the user has open**, via the Glane MCP connector.

## Glane MCP connector

| | |
|---|---|
| Endpoint | `https://glane-api.tadaaa.space/mcp/<token>` |
| Transport | MCP Streamable HTTP, stateless, `POST` only (JSON responses, no session) |
| Credential | `<token>`: a per-user secret embedded in the URL (capability URL) |
| OAuth | **None** — no authorization server, no scopes, no `Authorization` header |
| Server card | <https://glane.tadaaa.space/.well-known/mcp/server-card.json> |

### Getting the connector URL (done by the user, not the agent)

1. Open Glane in a browser: <https://glane.tadaaa.space/connector> (also under **Account › Claude connector**).
2. Click **Enable connector**. The tab generates a 32-byte random token (base64url), stored only in that browser.
3. Copy the connector URL `https://glane-api.tadaaa.space/mcp/<token>`.
4. In Claude: **Settings › Connectors › Add custom connector**, paste the URL. Any MCP client that speaks Streamable HTTP works the same way.

The URL grants access to the app while the tab is open: treat it as a secret. **New URL** (rotation) in the same screen invalidates the previous one; **Disable** stops the bridge.

### How a call is served

`apps/mcp` is a stateless relay. It receives the MCP call, finds the browser tab connected with the same token over a WebSocket (`wss://glane-api.tadaaa.space/agent/bridge`, origin restricted to `https://glane.tadaaa.space`), forwards the call, and returns the tab's answer. Nothing is persisted on the relay.

### Errors

- Malformed token → HTTP `401` with JSON `{"error":"invalid connector token"}`.
- Valid token but no Glane tab connected → the tool returns an MCP error telling the user to open Glane and enable the connector.
- Methods other than `POST` → `405`.

## Relationship with Tadaaa

Glane is hosted next to Tadaaa (`tadaaa.space`) but **does not use Tadaaa's OAuth** today. The OAuth authorization server at `https://api.tadaaa.space` and the MCP server at `https://api.tadaaa.space/mcp` belong to Tadaaa, not Glane; a Tadaaa access token gives no access to Glane. Replacing the URL token with OAuth via the Tadaaa SSO is planned (ADR-0024) but not implemented.

## Glane HTTP API (optional, for accounts)

The REST API at `https://glane-api.tadaaa.space/api` (OpenAPI: <https://glane-api.tadaaa.space/api/docs.jsonopenapi>) only handles accounts and unlisted listen links. It uses a JWT bearer token obtained with `POST /api/auth/login` (`username`, `password`). Agents do not need it to compose: the MCP connector covers library and arrangement work.

## In-page tools (WebMCP)

When Glane is open in a browser that implements WebMCP (`navigator.modelContext` / `document.modelContext`), the page registers read-only tools (`glane_status`, `glane_guide`, `glane_list_projects`, `glane_library`, `glane_get_arrangement`). They run in the user's own session and need no credential.
