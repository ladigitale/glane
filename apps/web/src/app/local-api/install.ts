import {
  paginateSamples,
  sampleFacets,
  listSampleIds,
  sampleListQueryFromSearch,
  type SamplesListResponse,
} from "./samples-query.js";
import {
  getAppLocale,
  normalizeAppLocale,
} from "../i18n/locale.js";
import { resolveWordings } from "../i18n/messages.js";

/** Same prefix as Tadaaa / Concorde wording — also serves local sample lists. */
export const LOCAL_API_PATH_PREFIX = "/mock-api";

export function getLocalApiServiceUrl(origin = location.origin): string {
  return new URL(LOCAL_API_PATH_PREFIX, origin).href.replace(/\/$/, "");
}

/** @deprecated Prefer getLocalApiServiceUrl — alias for wordings callers. */
export const WORDINGS_API_PATH_PREFIX = LOCAL_API_PATH_PREFIX;
export const getWordingsServiceUrl = getLocalApiServiceUrl;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Glane-Api", "local");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function isLocalApiRequest(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(url, location.origin).pathname.startsWith(
      LOCAL_API_PATH_PREFIX,
    );
  } catch {
    return false;
  }
}

function pageParams(url: URL): { offset: number; limit: number } {
  const limit = Math.max(
    1,
    parseInt(
      url.searchParams.get("per_page") ||
        url.searchParams.get("limit") ||
        "15",
      10,
    ),
  );
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10),
  );
  return { offset, limit };
}

async function handleSamplesRequest(
  request: Request,
  subPath: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== "GET") return null;

  const query = sampleListQueryFromSearch(url.searchParams);

  if (subPath === "/samples" || subPath === "/samples/") {
    const { offset, limit } = pageParams(url);
    const body: SamplesListResponse = await paginateSamples(
      query,
      offset,
      limit,
    );
    return json(body);
  }

  if (subPath === "/samples/ids") {
    const ids = await listSampleIds(query);
    return json({ data: ids, total: ids.length, meta: { total: ids.length } });
  }

  if (subPath === "/samples/facets") {
    const projectId = query.projectId;
    if (!projectId) {
      return json({ sessions: [], tags: [] });
    }
    return json(await sampleFacets(projectId));
  }

  if (subPath === "/samples/meta" || subPath === "/samples/count") {
    const { offset, limit } = pageParams(url);
    const page = await paginateSamples(query, offset, Math.max(1, limit));
    return json({ total: page.total, meta: { total: page.total } });
  }

  return null;
}

async function handleWordingsRequest(
  request: Request,
  subPath: string,
): Promise<Response | null> {
  const url = new URL(request.url);
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
    return json({ ok: true, service: "glane-local-api" });
  }

  return null;
}

async function handleLocalApiRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const subPath = url.pathname.slice(LOCAL_API_PATH_PREFIX.length) || "/";

  return (
    (await handleSamplesRequest(request, subPath)) ??
    (await handleWordingsRequest(request, subPath))
  );
}

let installed = false;

/**
 * Intercept `/mock-api/*` in-page (no SW): wordings + local sample list for sonic-queue.
 */
export function installLocalApiFetch(): boolean {
  if (installed || typeof window === "undefined") return installed;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    if (!isLocalApiRequest(input)) {
      return nativeFetch(input, init);
    }
    const request = new Request(input, init);
    const response = await handleLocalApiRequest(request);
    if (response) return response;
    return nativeFetch(input, init);
  };

  return true;
}

/** @deprecated Prefer installLocalApiFetch. */
export const installWordingsFetch = installLocalApiFetch;
