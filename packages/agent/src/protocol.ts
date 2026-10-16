import type { LibraryQuery } from "./library.js";
import type { LibraryUpdate, SampleList, SynthConfig } from "./synth.js";
import type { FxPatch } from "./score.js";

/**
 * Relay ↔ browser bridge protocol (JSON over WebSocket).
 * The relay never stores app data: it forwards MCP tool calls to the open
 * Glane tab that holds the same agent token and returns its answer.
 */

export const AGENT_BRIDGE_PATH = "/agent/bridge";
export const AGENT_MCP_PATH_PREFIX = "/mcp";
export const AGENT_PROTOCOL_VERSION = 1;

export type BridgeSynthSample = {
  id: string;
  name: string;
  role?: string;
  durationMs: number;
};

export type BridgeMethodMap = {
  status: { params: Record<string, never>; result: BridgeStatus };
  "projects.list": { params: Record<string, never>; result: { projects: BridgeProject[] } };
  "projects.select": { params: { projectId: string }; result: { project: BridgeProject } };
  "library.list": {
    params: LibraryQuery & { format?: "table" | "json" };
    result: {
      projectId: string;
      total: number;
      returned: number;
      offset: number;
      summary?: Record<string, unknown>;
      table?: string;
      rows?: unknown[];
    };
  };
  "library.update": {
    params: LibraryUpdate;
    result: { ok: boolean; updated: number; errors?: string[]; note?: string };
  };
  "library.delete": {
    params: SampleList;
    result: { ok: boolean; deleted: number; errors?: string[] };
  };
  "library.duplicate": {
    params: SampleList;
    result: { ok: boolean; duplicated: number; ids?: string[]; errors?: string[] };
  };
  "library.crop": {
    params: SampleList;
    result: { ok: boolean; cropped: number; skipped: number; errors?: string[] };
  };
  "synth.generate": {
    params: SynthConfig;
    result: {
      ok: boolean;
      projectId?: string;
      seed?: number;
      saved?: number;
      samples?: BridgeSynthSample[];
      errors?: string[];
      note?: string;
    };
  };
  "sample.bake_fx": {
    params: { sample: string; fx: FxPatch; bpm?: number };
    result: {
      ok: boolean;
      sampleId?: string;
      durationMs?: number;
      errors?: string[];
      note?: string;
    };
  };
  "arrangement.get": { params: Record<string, never>; result: { projectId: string; score: unknown } };
  "arrangement.write": {
    params: { score: unknown; play?: boolean; open?: boolean };
    result: {
      ok: boolean;
      projectId?: string;
      errors?: string[];
      warnings?: string[];
      stats?: Record<string, unknown>;
      snapshotId?: string;
      playing?: boolean;
      note?: string;
    };
  };
  "arrangement.undo": { params: Record<string, never>; result: { ok: boolean; restoredAt?: string; note?: string } };
  transport: {
    params: { action: "play" | "stop"; bar?: number };
    result: { ok: boolean; playing: boolean; note?: string };
  };
};

export type BridgeMethod = keyof BridgeMethodMap;
export const BRIDGE_METHODS: readonly BridgeMethod[] = [
  "status",
  "projects.list",
  "projects.select",
  "library.list",
  "library.update",
  "library.delete",
  "library.duplicate",
  "library.crop",
  "synth.generate",
  "sample.bake_fx",
  "arrangement.get",
  "arrangement.write",
  "arrangement.undo",
  "transport",
];

export type BridgeProject = {
  id: string;
  title: string;
  current: boolean;
  bpm: number;
  bars: number;
  timeSignature: [number, number];
  samples: number;
  clips: number;
};

export type BridgeStatus = {
  app: string;
  protocol: number;
  route: string;
  visible: boolean;
  /** AudioContext state of the sequencer engine, or "none" when not mounted. */
  audio: string;
  project: BridgeProject | null;
};

/** relay → browser */
export type BridgeCall = {
  type: "call";
  id: string;
  method: BridgeMethod;
  params: unknown;
};

/** browser → relay */
export type BridgeReply =
  | { type: "result"; id: string; ok: true; result: unknown }
  | { type: "result"; id: string; ok: false; error: string };

export type BridgeHello = {
  type: "hello";
  protocol: number;
  app: string;
  visible: boolean;
};

export type BridgePresence = { type: "presence"; visible: boolean };

export type BridgeToRelay = BridgeReply | BridgeHello | BridgePresence | { type: "pong" };
export type RelayToBridge = BridgeCall | { type: "ping" } | { type: "welcome"; peers: number };

/** 32 random bytes, base64url — the shared secret in the connector URL. */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const AGENT_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
