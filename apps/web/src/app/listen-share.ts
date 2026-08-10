/**
 * Glane listen-link publish (bounce MP3 → API).
 */
import { auth } from "./auth.js";

export type ListenMeta = {
  token: string;
  title: string;
  visibility: "unlisted" | "private";
  url: string;
  audioUrl?: string;
  durationMs?: number | null;
  revoked?: boolean;
};

async function publishListen(opts: {
  mp3: Blob;
  title: string;
  visibility: "unlisted" | "private";
  localProjectId?: string;
  durationMs?: number;
}): Promise<{ ok: true; meta: ListenMeta } | { ok: false; error: string }> {
  const base = auth.apiBase();
  if (!base) return { ok: false, error: "api_not_configured" };
  if (!auth.getJwt()) return { ok: false, error: "authentication_required" };

  const body = new FormData();
  body.append("audio", opts.mp3, "listen.mp3");
  body.append("title", opts.title);
  body.append("visibility", opts.visibility);
  if (opts.localProjectId) body.append("localProjectId", opts.localProjectId);
  if (opts.durationMs != null) body.append("durationMs", String(opts.durationMs));

  try {
    const res = await fetch(`${base}/api/listens`, {
      method: "POST",
      headers: auth.authHeaders(),
      body,
    });
    if (res.status === 401) return { ok: false, error: "authentication_required" };
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: err.error ?? "publish_failed" };
    }
    const meta = (await res.json()) as ListenMeta;
    return { ok: true, meta };
  } catch {
    return { ok: false, error: "publish_failed" };
  }
}

async function updateListen(
  token: string,
  patch: { visibility?: "unlisted" | "private"; title?: string; revoke?: boolean },
): Promise<{ ok: true; meta: ListenMeta } | { ok: false; error: string }> {
  const base = auth.apiBase();
  if (!base || !auth.getJwt()) return { ok: false, error: "authentication_required" };
  try {
    const res = await fetch(`${base}/api/listens/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: {
        ...auth.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return { ok: false, error: "update_failed" };
    return { ok: true, meta: (await res.json()) as ListenMeta };
  } catch {
    return { ok: false, error: "update_failed" };
  }
}

async function fetchMeta(token: string): Promise<ListenMeta | null> {
  const base = auth.apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/listens/${encodeURIComponent(token)}`, {
      headers: auth.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as ListenMeta;
  } catch {
    return null;
  }
}

function audioUrl(token: string): string {
  const base = auth.apiBase();
  return `${base}/api/listens/${encodeURIComponent(token)}/audio`;
}

function frontListenUrl(token: string): string {
  return `${location.origin}/listen/${token}`;
}

export const listenShare = {
  publishListen,
  updateListen,
  fetchMeta,
  audioUrl,
  frontListenUrl,
} as const;
