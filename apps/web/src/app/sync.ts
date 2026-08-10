import type { EditOperation, SyncPolicy } from "@glane/core-model";
import { nowIso } from "@glane/core-model";
import { auth } from "./auth.js";
import { db, ensurePrefs } from "./db.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type SyncStatus = {
  policy: SyncPolicy;
  wifiOnly: boolean;
  online: boolean;
  apiConfigured: boolean;
  pending: number;
  lastError: string | null;
  lastFlushAt: string | null;
  lastSent: number;
};

let lastError: string | null = null;
let lastFlushAt: string | null = null;
let lastSent = 0;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export async function pendingOps(): Promise<EditOperation[]> {
  return db.ops.filter((o) => !o.syncedAt).sortBy("clientSeq");
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const prefs = await ensurePrefs();
  const pending = await pendingOps();
  return {
    policy: prefs.syncPolicy,
    wifiOnly: prefs.wifiOnly !== false,
    online: navigator.onLine,
    apiConfigured: Boolean(API_BASE),
    pending: pending.length,
    lastError,
    lastFlushAt,
    lastSent,
  };
}

export function networkAllowsSync(wifiOnly: boolean): boolean {
  if (!navigator.onLine) return false;
  if (!wifiOnly) return true;
  return shouldSyncOnWifiOnly();
}

/**
 * Opportunistic sync (P5): flush unsynced op-log when policy allows and online.
 */
export async function flushOpLog(): Promise<{ sent: number }> {
  const prefs = await ensurePrefs();
  if (prefs.syncPolicy === "local_only") return { sent: 0 };
  if (!API_BASE) {
    lastError = "VITE_API_BASE_URL non configuré";
    return { sent: 0 };
  }
  if (!networkAllowsSync(prefs.wifiOnly !== false)) {
    return { sent: 0 };
  }

  const ops = await pendingOps();
  if (ops.length === 0) return { sent: 0 };

  // metadata_only: strip heavy payloads that look like audio blobs
  const bodyOps =
    prefs.syncPolicy === "metadata_only"
      ? ops.map((o) => ({
          ...o,
          payload: sanitizeMetadataPayload(o.payload),
        }))
      : ops;

  const token = auth.getJwt();
  try {
    const res = await fetch(`${API_BASE}/api/sync/ops`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ops: bodyOps }),
    });
    if (!res.ok) {
      lastError = `sync failed: ${res.status}`;
      throw new Error(lastError);
    }
    const ackAt = nowIso();
    await db.transaction("rw", db.ops, async () => {
      for (const op of ops) {
        await db.ops.update(op.id, { syncedAt: ackAt });
      }
    });
    lastError = null;
    lastFlushAt = ackAt;
    lastSent = ops.length;
    return { sent: ops.length };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

function sanitizeMetadataPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (
      k === "pcm" ||
      k === "peaks" ||
      k === "audio" ||
      k === "buffer" ||
      (typeof v === "string" && v.length > 8_000)
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export async function requestPresignedUpload(
  sampleId: string,
  kind: "master" | "preview" | "peaks",
): Promise<{ url: string; headers?: Record<string, string> } | null> {
  const prefs = await ensurePrefs();
  if (prefs.syncPolicy !== "full") return null;
  if (!API_BASE) return null;
  if (!networkAllowsSync(prefs.wifiOnly !== false)) return null;
  const token = auth.getJwt();
  const res = await fetch(`${API_BASE}/api/assets/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sampleId, kind }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ url: string; headers?: Record<string, string> }>;
}

export function shouldSyncOnWifiOnly(): boolean {
  const conn = (
    navigator as Navigator & {
      connection?: { type?: string; effectiveType?: string };
    }
  ).connection;
  if (!conn) return true; // unknown → allow (desktop)
  if (conn.type === "wifi" || conn.type === "ethernet") return true;
  if (conn.type === "cellular" || conn.type === "wimax") return false;
  // Chromium often omits type; treat 4g/3g as cellular-ish
  if (conn.effectiveType === "4g" || conn.effectiveType === "3g") {
    return conn.type === undefined; // ambiguous: allow
  }
  return true;
}

/** Boot hook: flush on online / focus / periodic tick. */
export function startSyncScheduler(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => {
    void flushOpLog().catch(() => {
      /* lastError already set */
    });
  };
  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
  timer = setInterval(tick, 60_000);
  // deferred first attempt
  setTimeout(tick, 2_500);
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export type { EditOperation, SyncPolicy };
