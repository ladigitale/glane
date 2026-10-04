import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  AGENT_BRIDGE_PATH,
  compileScore,
  generateAgentToken,
  type BridgeCall,
} from "@glane/agent";
import { createGlaneRelayServer } from "./server.js";

const SAMPLES = [
  { id: "aaaaaaaa-1111-4111-8111-000000000001", durationMs: 400 },
  { id: "cccccccc-3333-4333-8333-000000000004", durationMs: 6000, loopStartMs: 500, loopEndMs: 4500 },
];

async function withServer(fn: (base: string) => Promise<void>) {
  const { http } = createGlaneRelayServer();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const { port } = http.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  }
}

/** Minimal stand-in for the Glane tab: answers bridge calls from memory. */
async function fakeTab(base: string, token: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}${AGENT_BRIDGE_PATH}?token=${token}`);
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify({ type: "hello", protocol: 1, app: "Glane", visible: true }));
  const written: unknown[] = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as BridgeCall | { type: string };
    if (msg.type !== "call") return;
    const call = msg as BridgeCall;
    let result: unknown;
    if (call.method === "status") {
      result = { app: "Glane", protocol: 1, route: "/project", visible: true, audio: "running", project: null };
    } else if (call.method === "arrangement.write") {
      const { score } = call.params as { score: unknown };
      const r = compileScore(score, { samples: SAMPLES });
      written.push(score);
      result = r.ok
        ? { ok: true, projectId: "p", warnings: r.value.warnings, stats: r.value.stats }
        : { ok: false, errors: r.errors, warnings: r.warnings };
    } else {
      ws.send(JSON.stringify({ type: "result", id: call.id, ok: false, error: "not in fake" }));
      return;
    }
    ws.send(JSON.stringify({ type: "result", id: call.id, ok: true, result }));
  });
  return { ws, written };
}

async function mcpClient(base: string, token: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return client;
}

const text = (r: unknown) =>
  ((r as { content: { type: string; text: string }[] }).content ?? [])
    .map((c) => c.text)
    .join("\n");

test("tools are listed and calls fail clearly without an open tab", async () => {
  await withServer(async (base) => {
    const client = await mcpClient(base, generateAgentToken());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("glane_write_arrangement"));
    assert.ok(names.includes("glane_library"));
    const write = tools.find((t) => t.name === "glane_write_arrangement")!;
    assert.ok(JSON.stringify(write.inputSchema).includes("patterns"));

    const guide = await client.callTool({ name: "glane_guide", arguments: {} });
    assert.match(text(guide), /Pattern/);

    const status = await client.callTool({ name: "glane_status", arguments: {} });
    assert.equal(status.isError, true);
    assert.match(text(status), /ouvert sur aucun appareil/);
    await client.close();
  });
});

test("tool calls are relayed to the tab with the same token only", async () => {
  await withServer(async (base) => {
    const token = generateAgentToken();
    const tab = await fakeTab(base, token);
    const client = await mcpClient(base, token);

    const status = await client.callTool({ name: "glane_status", arguments: {} });
    assert.equal(status.isError, undefined);
    assert.match(text(status), /"route": "\/project"/);

    const res = await client.callTool({
      name: "glane_write_arrangement",
      arguments: {
        score: {
          bpm: 100,
          bars: 4,
          tracks: [
            { name: "Lit", clips: [{ sample: "cccccccc", bar: 1, beats: 16, loop: true }] },
            { name: "Kick", patterns: [{ sample: "aaaaaaaa", fromBar: 1, toBar: 4, steps: "X..." }] },
          ],
        },
        play: true,
      },
    });
    assert.equal(res.isError, undefined, text(res));
    assert.match(text(res), /"clips": 17/);
    assert.equal(tab.written.length, 1);

    const bad = await client.callTool({
      name: "glane_write_arrangement",
      arguments: { score: { bpm: 100, bars: 4, tracks: [{ clips: [{ sample: "zzzzzzzz", bar: 1 }] }] } },
    });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /son inconnu/);

    const other = await mcpClient(base, generateAgentToken());
    const none = await other.callTool({ name: "glane_status", arguments: {} });
    assert.equal(none.isError, true);

    await client.close();
    await other.close();
    tab.ws.close();
  });
});

test("bridge sockets need a well-formed token", async () => {
  await withServer(async (base) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}${AGENT_BRIDGE_PATH}?token=short`);
    const err = await new Promise<Error>((r) => ws.once("error", r));
    assert.match(err.message, /401/);
  });
});
