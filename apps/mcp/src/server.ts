import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AGENT_BRIDGE_PATH, AGENT_MCP_PATH_PREFIX, AGENT_TOKEN_RE } from "@glane/agent";
import { Relay, type RelayOptions } from "./relay.js";
import { createGlaneMcpServer } from "./tools.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

export type GlaneRelayServer = { http: Server; relay: Relay };

/**
 * HTTP entry point:
 * - `POST /mcp/<token>`        MCP streamable HTTP (stateless) — the Claude connector URL
 * - `GET  /agent/bridge?token` WebSocket upgrade for the Glane tab
 * - `GET  /health`
 */
export function createGlaneRelayServer(opts: RelayOptions = {}): GlaneRelayServer {
  const relay = new Relay(opts);
  const log = opts.log ?? (() => {});

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const path = url.pathname.replace(/\/+$/, "");

    if (path === "/health" || path === "/agent/health") {
      send(res, 200, { ok: true, service: "glane-mcp" });
      return;
    }

    const m = new RegExp(`^${AGENT_MCP_PATH_PREFIX}/([^/]+)$`).exec(path);
    if (!m) {
      send(res, 404, { error: "not found" });
      return;
    }
    const token = m[1]!;
    if (!AGENT_TOKEN_RE.test(token)) {
      send(res, 401, { error: "invalid connector token" });
      return;
    }
    if (req.method !== "POST") {
      // Stateless server: no SSE stream to resume, no session to delete.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      return;
    }

    const server = createGlaneMcpServer(relay, token);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`mcp error: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) {
        send(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });

  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    if (path !== AGENT_BRIDGE_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    relay.handleUpgrade(req, socket, head);
  });

  http.on("close", () => relay.close());
  return { http, relay };
}
