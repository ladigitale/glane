import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  AGENT_TOKEN_RE,
  type BridgeMethod,
  type BridgeMethodMap,
  type BridgeToRelay,
  type RelayToBridge,
} from "@glane/agent";

/**
 * Pairs MCP tool calls with the browser tab holding the same agent token.
 * Nothing is persisted: tokens only live in memory while a tab is connected.
 */

type Peer = {
  ws: WebSocket;
  token: string;
  visible: boolean;
  connectedAt: number;
  alive: boolean;
};

type Pending = {
  peer: Peer;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class NoAppConnectedError extends Error {
  constructor() {
    super(
      "Glane n'est ouvert sur aucun appareil avec ce connecteur. Ouvre l'app (onglet actif) et vérifie que le connecteur Claude est activé dans Compte.",
    );
  }
}

export type RelayOptions = {
  maxPeersPerToken?: number;
  pingIntervalMs?: number;
  /** Optional Origin allow-list for browser sockets. */
  allowedOrigins?: string[];
  log?: (msg: string) => void;
};

export class Relay {
  readonly #peers = new Map<string, Set<Peer>>();
  readonly #pending = new Map<string, Pending>();
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  readonly #opts: Required<Omit<RelayOptions, "allowedOrigins">> & {
    allowedOrigins: string[];
  };
  readonly #pinger: ReturnType<typeof setInterval>;

  constructor(opts: RelayOptions = {}) {
    this.#opts = {
      maxPeersPerToken: opts.maxPeersPerToken ?? 4,
      pingIntervalMs: opts.pingIntervalMs ?? 25_000,
      allowedOrigins: opts.allowedOrigins ?? [],
      log: opts.log ?? (() => {}),
    };
    this.#pinger = setInterval(() => this.#heartbeat(), this.#opts.pingIntervalMs);
    this.#pinger.unref();
  }

  close(): void {
    clearInterval(this.#pinger);
    for (const set of this.#peers.values()) for (const p of set) p.ws.terminate();
    this.#wss.close();
  }

  peerCount(token: string): number {
    return this.#peers.get(token)?.size ?? 0;
  }

  /** HTTP upgrade handler for the browser bridge socket. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://relay");
    const token = url.searchParams.get("token") ?? "";
    const origin = req.headers.origin ?? "";
    if (!AGENT_TOKEN_RE.test(token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    if (this.#opts.allowedOrigins.length > 0 && !this.#opts.allowedOrigins.includes(origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#attach(ws, token));
  }

  #attach(ws: WebSocket, token: string): void {
    const set = this.#peers.get(token) ?? new Set<Peer>();
    if (set.size >= this.#opts.maxPeersPerToken) {
      // Drop the oldest tab rather than refusing the new one.
      const oldest = [...set].sort((a, b) => a.connectedAt - b.connectedAt)[0];
      oldest?.ws.close(4000, "replaced");
    }
    const peer: Peer = { ws, token, visible: true, connectedAt: Date.now(), alive: true };
    set.add(peer);
    this.#peers.set(token, set);
    this.#opts.log(`bridge connected (${set.size} peer(s) for token ${token.slice(0, 6)}…)`);
    this.#send(peer, { type: "welcome", peers: set.size });

    ws.on("message", (data) => {
      let msg: BridgeToRelay;
      try {
        msg = JSON.parse(String(data)) as BridgeToRelay;
      } catch {
        return;
      }
      peer.alive = true;
      if (msg.type === "hello" || msg.type === "presence") peer.visible = msg.visible;
      else if (msg.type === "result") {
        const p = this.#pending.get(msg.id);
        if (!p || p.peer !== peer) return;
        this.#pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    });
    ws.on("pong", () => (peer.alive = true));
    ws.on("close", () => {
      set.delete(peer);
      if (set.size === 0) this.#peers.delete(token);
      for (const [id, p] of this.#pending) {
        if (p.peer !== peer) continue;
        this.#pending.delete(id);
        clearTimeout(p.timer);
        p.reject(new Error("L'onglet Glane s'est déconnecté pendant l'appel."));
      }
    });
  }

  #heartbeat(): void {
    for (const set of this.#peers.values()) {
      for (const p of set) {
        if (!p.alive) {
          p.ws.terminate();
          continue;
        }
        p.alive = false;
        p.ws.ping();
        this.#send(p, { type: "ping" });
      }
    }
  }

  #send(peer: Peer, msg: RelayToBridge): void {
    peer.ws.send(JSON.stringify(msg));
  }

  /** Visible tabs first, then the most recently connected. */
  #pick(token: string): Peer | null {
    const set = this.#peers.get(token);
    if (!set || set.size === 0) return null;
    return [...set].sort(
      (a, b) => Number(b.visible) - Number(a.visible) || b.connectedAt - a.connectedAt,
    )[0]!;
  }

  call<M extends BridgeMethod>(
    token: string,
    method: M,
    params: BridgeMethodMap[M]["params"],
    timeoutMs = 20_000,
  ): Promise<BridgeMethodMap[M]["result"]> {
    const peer = this.#pick(token);
    if (!peer) return Promise.reject(new NoAppConnectedError());
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(
            `Glane n'a pas répondu à « ${method} » en ${Math.round(timeoutMs / 1000)} s (onglet en veille ?).`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        peer,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.#send(peer, { type: "call", id, method, params });
    });
  }
}
