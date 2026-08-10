import {
  getAppLocale,
  normalizeAppLocale,
} from "./locale.js";
import { resolveWordings } from "./messages.js";

/** Same prefix as Tadaaa — Concorde wording hits `{serviceURL}/wordings`. */
export const WORDINGS_API_PATH_PREFIX = "/mock-api";

export function getWordingsServiceUrl(origin = location.origin): string {
  return new URL(WORDINGS_API_PATH_PREFIX, origin).href.replace(/\/$/, "");
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Glane-Api", "wordings");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function isWordingsApiRequest(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(url, location.origin).pathname.startsWith(
      WORDINGS_API_PATH_PREFIX,
    );
  } catch {
    return false;
  }
}

async function handleWordingsRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const subPath = url.pathname.slice(WORDINGS_API_PATH_PREFIX.length) || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && subPath === "/wordings") {
    const labels = [
      ...url.searchParams.getAll("labels[]"),
      ...url.searchParams.getAll("labels"),
    ].filter(Boolean);
    const fromHeader = request.headers.get("Accept-Language");
    const locale = normalizeAppLocale(fromHeader || getAppLocale());
    return json(resolveWordings(labels, locale));
  }

  if (method === "GET" && subPath === "/health") {
    return json({ ok: true, service: "glane-wordings" });
  }

  return null;
}

let installed = false;

/**
 * Intercept `/mock-api/wordings` in-page (no SW). Required for Concorde `t()`.
 */
export function installWordingsFetch(): boolean {
  if (installed || typeof window === "undefined") return installed;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    if (!isWordingsApiRequest(input)) {
      return nativeFetch(input, init);
    }
    const request = new Request(input, init);
    const response = await handleWordingsRequest(request);
    if (response) return response;
    return nativeFetch(input, init);
  };

  return true;
}
