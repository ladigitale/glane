import type { Sample, SampleClass, Session } from "@glane/core-model";
import { db } from "../db.js";
import { projectWorkspace } from "../project-workspace.js";

export type SampleListQuery = {
  projectId?: string;
  sessionId?: string;
  classFilter?: string;
  tagFilter?: string[];
  q?: string;
  /** When set, restrict + order by this id list (CLAP / sieve pool). */
  orderIds?: string[] | null;
};

export type SamplesListResponse = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  data: Sample[];
  meta: { total: number };
};

export type SampleFacets = {
  sessions: { id: string; label: string; count: number }[];
  tags: { value: string; label: string }[];
};

/** Optional ordered id list for semantic rank (kept out of the query string). */
let listOrderIds: string[] | null = null;

export function setSampleListOrder(ids: string[] | null): void {
  listOrderIds = ids && ids.length > 0 ? ids : null;
}

export function getSampleListOrder(): string[] | null {
  return listOrderIds;
}

function parseTags(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function sampleListQueryFromSearch(
  params: URLSearchParams,
): SampleListQuery {
  const semantic = params.get("semantic");
  return {
    projectId: params.get("projectId") || undefined,
    sessionId:
      params.get("sessionId") || params.get("sessionFilter") || undefined,
    classFilter: params.get("classFilter") || undefined,
    tagFilter: parseTags(params.get("tagFilter")),
    q: params.get("q") || undefined,
    orderIds: semantic === "1" ? listOrderIds : null,
  };
}

function matchesClassicQ(s: Sample, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    (s.captureName ?? "").toLowerCase().includes(needle) ||
    s.name.toLowerCase().includes(needle) ||
    (s.userName ?? "").toLowerCase().includes(needle) ||
    (s.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
  );
}

function applyFilters(list: Sample[], query: SampleListQuery): Sample[] {
  let out = list;
  if (query.sessionId) {
    out = out.filter((s) => s.sessionId === query.sessionId);
  }
  if (query.classFilter && query.classFilter !== "all") {
    out = out.filter((s) => s.class === (query.classFilter as SampleClass));
  }
  if (query.tagFilter && query.tagFilter.length > 0) {
    const tags = query.tagFilter;
    out = out.filter((s) => tags.some((tag) => (s.tags ?? []).includes(tag)));
  }
  const q = query.q?.trim() ?? "";
  if (q && !query.orderIds) {
    out = out.filter((s) => matchesClassicQ(s, q));
  }
  if (query.orderIds && query.orderIds.length > 0) {
    const byId = new Map(out.map((s) => [s.id, s]));
    const ordered: Sample[] = [];
    for (const id of query.orderIds) {
      const row = byId.get(id);
      if (row) ordered.push(row);
    }
    if (q) {
      const classic = new Set(
        out.filter((s) => matchesClassicQ(s, q)).map((s) => s.id),
      );
      const seen = new Set(ordered.map((s) => s.id));
      for (const s of out) {
        if (classic.has(s.id) && !seen.has(s.id)) ordered.push(s);
      }
    }
    out = ordered;
  }
  return out;
}

async function loadProjectSamples(projectId: string): Promise<Sample[]> {
  return db.samples
    .where("projectId")
    .equals(projectId)
    .filter((s) => !s.deletedAt)
    .reverse()
    .sortBy("createdAt");
}

export async function resolveProjectId(
  explicit?: string,
): Promise<string | null> {
  if (explicit) return explicit;
  return projectWorkspace.currentId();
}

export async function filteredSamples(
  query: SampleListQuery,
): Promise<Sample[]> {
  const projectId = await resolveProjectId(query.projectId);
  if (!projectId) return [];
  const all = await loadProjectSamples(projectId);
  return applyFilters(all, { ...query, projectId });
}

export async function paginateSamples(
  query: SampleListQuery,
  offset: number,
  limit: number,
): Promise<SamplesListResponse> {
  const pool = await filteredSamples(query);
  const total = pool.length;
  const start = Math.max(0, offset);
  const perPage = Math.max(1, limit);
  const data = pool.slice(start, start + perPage);
  const page = Math.floor(start / perPage) + 1;
  return {
    page,
    per_page: perPage,
    total,
    total_pages: Math.max(1, Math.ceil(total / perPage) || 1),
    data,
    meta: { total },
  };
}

export async function listSampleIds(query: SampleListQuery): Promise<string[]> {
  const pool = await filteredSamples(query);
  return pool.map((s) => s.id);
}

export async function sampleFacets(projectId: string): Promise<SampleFacets> {
  const [samples, sessions] = await Promise.all([
    loadProjectSamples(projectId),
    db.sessions.where("projectId").equals(projectId).sortBy("startedAt"),
  ]);
  const aliveSessions = (sessions as Session[])
    .filter((s) => !s.deletedAt)
    .reverse();
  const byId = new Map(aliveSessions.map((s) => [s.id, s]));

  const sessionCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const s of samples) {
    sessionCounts.set(s.sessionId, (sessionCounts.get(s.sessionId) ?? 0) + 1);
    for (const tag of s.tags ?? []) {
      if (!tag || tag.startsWith("processing:")) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const sessionOpts: SampleFacets["sessions"] = [];
  for (const [id, count] of sessionCounts) {
    const sess = byId.get(id);
    const label =
      sess?.title?.trim() ||
      samples.find((s) => s.sessionId === id)?.captureName ||
      id.slice(0, 8);
    sessionOpts.push({ id, label, count });
  }
  sessionOpts.sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const tags = [...tagCounts.entries()]
    .map(([value, count]) => ({ value, label: `${value} (${count})` }))
    .sort((a, b) => a.value.localeCompare(b.value, "fr"));

  return { sessions: sessionOpts, tags };
}
