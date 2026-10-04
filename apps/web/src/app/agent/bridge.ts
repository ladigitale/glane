import {
  AGENT_BRIDGE_PATH,
  AGENT_MCP_PATH_PREFIX,
  AGENT_PROTOCOL_VERSION,
  AGENT_TOKEN_RE,
  BRIDGE_METHODS,
  generateAgentToken,
  type BridgeCall,
  type BridgeToRelay,
  type RelayToBridge,
} from "@glane/agent";
import { APP_NAME } from "@glane/core-model";
import { db, ensurePrefs } from "../db.js";
import { agentHandlers } from "./handlers.js";

/**
 * Browser end of the Claude connector: a WebSocket to the MCP relay.
 * Tool calls arrive as `call` messages and run against local IndexedDB.
 */

export type AgentBridgeState = "off" | "unconfigured" | "connecting" | "online" | "offline";

export function agentRelayBase(): string | null {
  const raw =
    import.meta.env.VITE_AGENT_RELAY_URL || import.meta.env.VITE_API_BASE_URL || "";
  if (!raw) return null;
  try {
    return new URL(raw, location.origin).href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function connectorUrl(token: string): string | null {
  const base = agentRelayBase();
  return base ? `${base}${AGENT_MCP_PATH_PREFIX}/${token}` : null;
}

type Listener = (s: AgentBridgeState) => void;

class AgentBridge {
  #ws: WebSocket | null = null;
  #state: AgentBridgeState = "off";
  #listeners = new Set<Listener>();
  #retry = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  /** Serialize writes: two tool calls never touch the DB at the same time. */
  #queue: Promise<unknown> = Promise.resolve();

  get state(): AgentBridgeState {
    return this.#state;
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    fn(this.#state);
    return () => this.#listeners.delete(fn);
  }

  #set(s: AgentBridgeState) {
    this.#state = s;
    for (const l of this.#listeners) l(s);
  }

  async start(): Promise<void> {
    const prefs = await ensurePrefs();
    if (!prefs.agentEnabled || !prefs.agentToken) {
      this.stop();
      return;
    }
    if (!agentRelayBase()) {
      this.stop("unconfigured");
      return;
    }
    if (this.#ws && this.#token === prefs.agentToken) return;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const old = this.#ws;
    this.#ws = null;
    old?.close(1000, "token changed");
    this.#token = prefs.agentToken;
    this.#connect();
  }

  stop(state: AgentBridgeState = "off"): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const ws = this.#ws;
    this.#ws = null;
    this.#token = null;
    ws?.close(1000, "disabled");
    this.#set(state);
  }

  #connect(): void {
    const base = agentRelayBase();
    if (!base || !this.#token) return;
    const url = new URL(`${base}${AGENT_BRIDGE_PATH}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", this.#token);
    this.#set("connecting");
    const ws = new WebSocket(url.href);
    this.#ws = ws;
    ws.onopen = () => {
      this.#retry = 0;
      this.#set("online");
      this.#send({
        type: "hello",
        protocol: AGENT_PROTOCOL_VERSION,
        app: APP_NAME,
        visible: document.visibilityState === "visible",
      });
    };
    ws.onmessage = (ev) => {
      let msg: RelayToBridge;
      try {
        msg = JSON.parse(String(ev.data)) as RelayToBridge;
      } catch {
        return;
      }
      if (msg.type === "ping") this.#send({ type: "pong" });
      else if (msg.type === "call") this.#enqueue(msg);
    };
    ws.onclose = (ev) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      if (ev.code === 4401) {
        this.stop("offline");
        return;
      }
      this.#set("offline");
      const delay = Math.min(30_000, 1_000 * 2 ** this.#retry++);
      this.#retryTimer = setTimeout(() => this.#connect(), delay);
    };
  }

  #send(msg: BridgeToRelay): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg));
  }

  #enqueue(call: BridgeCall): void {
    this.#queue = this.#queue.then(() => this.#run(call));
  }

  async #run(call: BridgeCall): Promise<void> {
    if (!BRIDGE_METHODS.includes(call.method)) {
      this.#send({ type: "result", id: call.id, ok: false, error: `méthode inconnue ${call.method}` });
      return;
    }
    try {
      const handler = agentHandlers[call.method] as (p: unknown) => Promise<unknown>;
      const result = await handler(call.params ?? {});
      this.#send({ type: "result", id: call.id, ok: true, result });
    } catch (e) {
      console.warn("[glane] agent call failed", call.method, e);
      this.#send({
        type: "result",
        id: call.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  presence(): void {
    this.#send({ type: "presence", visible: document.visibilityState === "visible" });
  }
}

export const agentBridge = new AgentBridge();

/** Enable or disable the connector; creates a token on first enable. */
export async function setAgentEnabled(enabled: boolean): Promise<string | null> {
  const prefs = await ensurePrefs();
  const token =
    prefs.agentToken && AGENT_TOKEN_RE.test(prefs.agentToken)
      ? prefs.agentToken
      : generateAgentToken();
  await db.prefs.put({ ...prefs, agentEnabled: enabled, agentToken: token });
  await agentBridge.start();
  return enabled ? token : null;
}

/** New secret: the previous connector URL stops working. */
export async function rotateAgentToken(): Promise<string> {
  const prefs = await ensurePrefs();
  const token = generateAgentToken();
  await db.prefs.put({ ...prefs, agentToken: token });
  agentBridge.stop();
  await agentBridge.start();
  return token;
}

export function startAgentBridge(): void {
  void agentBridge.start();
  document.addEventListener("visibilitychange", () => agentBridge.presence());
}
