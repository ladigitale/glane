/** Compact, agent-facing view of a library sample (built by the web app). */
export type AgentLibraryRow = {
  id: string;
  name: string;
  class: string;
  role: string;
  durationMs: number;
  loopStartMs?: number;
  loopEndMs?: number;
  loopScore?: number;
  bpm?: number;
  note?: string;
  pitchHz?: number;
  pitchConfidence?: number;
  harmonicity?: number;
  centroidHz?: number;
  transientDensity?: number;
  lufs?: number;
  peakDbtp?: number;
  rating?: number;
  favorite?: boolean;
  interest?: number;
  stem?: string;
  capture?: string;
  tags: string[];
};

export type LibraryQuery = {
  classes?: string[];
  roles?: string[];
  /** Any of these (substring, case-insensitive) in tags. */
  tags?: string[];
  /** Substring in name, capture name or tags. */
  text?: string;
  favorite?: boolean;
  minRating?: number;
  minMs?: number;
  maxMs?: number;
  loopable?: boolean;
  pitched?: boolean;
  sort?: "interest" | "duration" | "name";
  limit?: number;
  offset?: number;
};

export const LIBRARY_DEFAULT_LIMIT = 150;
export const LIBRARY_MAX_LIMIT = 500;

/** Shortest common prefix length (≥ min) that keeps every id unique. */
export function shortIdLength(ids: readonly string[], min = 8): number {
  for (let len = min; len < 36; len++) {
    const seen = new Set<string>();
    let clash = false;
    for (const id of ids) {
      const k = id.slice(0, len).toLowerCase();
      if (seen.has(k)) {
        clash = true;
        break;
      }
      seen.add(k);
    }
    if (!clash) return len;
  }
  return 36;
}

export const isLoopable = (r: AgentLibraryRow) =>
  (r.loopScore ?? 0) >= 0.5 ||
  (r.loopStartMs != null && r.loopEndMs != null && r.loopEndMs > r.loopStartMs);

export const isPitched = (r: AgentLibraryRow) =>
  (r.pitchConfidence ?? 0) >= 0.6 && r.note != null;

export function filterLibrary(
  rows: readonly AgentLibraryRow[],
  q: LibraryQuery = {},
): { total: number; rows: AgentLibraryRow[] } {
  const lc = (s: string) => s.toLowerCase();
  const classes = q.classes?.map(lc);
  const roles = q.roles?.map(lc);
  const tags = q.tags?.map(lc);
  const text = q.text ? lc(q.text) : null;
  const out = rows.filter((r) => {
    if (classes?.length && !classes.includes(lc(r.class))) return false;
    if (roles?.length && !roles.includes(lc(r.role))) return false;
    if (tags?.length && !r.tags.some((t) => tags.some((q) => lc(t).includes(q)))) {
      return false;
    }
    if (text) {
      const hay = [r.name, r.capture ?? "", ...r.tags].map(lc).join(" ");
      if (!hay.includes(text)) return false;
    }
    if (q.favorite && !r.favorite) return false;
    if (q.minRating != null && (r.rating ?? 0) < q.minRating) return false;
    if (q.minMs != null && r.durationMs < q.minMs) return false;
    if (q.maxMs != null && r.durationMs > q.maxMs) return false;
    if (q.loopable != null && isLoopable(r) !== q.loopable) return false;
    if (q.pitched != null && isPitched(r) !== q.pitched) return false;
    return true;
  });
  const sort = q.sort ?? "interest";
  if (sort === "interest") {
    out.sort(
      (a, b) =>
        Number(b.favorite ?? false) - Number(a.favorite ?? false) ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.interest ?? 0) - (a.interest ?? 0),
    );
  } else if (sort === "duration") out.sort((a, b) => a.durationMs - b.durationMs);
  else if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(LIBRARY_MAX_LIMIT, Math.max(1, q.limit ?? LIBRARY_DEFAULT_LIMIT));
  return { total: out.length, rows: out.slice(offset, offset + limit) };
}

const r0 = (n: number | undefined) => (n == null ? "" : String(Math.round(n)));
const r1 = (n: number | undefined) => (n == null ? "" : String(Math.round(n * 10) / 10));
const r2 = (n: number | undefined) => (n == null ? "" : String(Math.round(n * 100) / 100));

export const LIBRARY_TABLE_COLUMNS = [
  "id",
  "name",
  "class",
  "role",
  "ms",
  "loop",
  "bpm",
  "note",
  "pitchConf",
  "harm",
  "centroidHz",
  "transients",
  "lufs",
  "rating",
  "fav",
  "interest",
  "tags",
] as const;

/** Tab-separated table — about a third of the tokens of the JSON form. */
export function formatLibraryTable(
  rows: readonly AgentLibraryRow[],
  idLength = 8,
): string {
  const lines = [LIBRARY_TABLE_COLUMNS.join("\t")];
  for (const r of rows) {
    const loop =
      r.loopStartMs != null && r.loopEndMs != null && r.loopEndMs > r.loopStartMs
        ? `${Math.round(r.loopStartMs)}-${Math.round(r.loopEndMs)}`
        : (r.loopScore ?? 0) >= 0.5
          ? "yes"
          : "";
    lines.push(
      [
        r.id.slice(0, idLength),
        r.name.replace(/\s+/g, " "),
        r.class,
        r.role,
        r0(r.durationMs),
        loop,
        r1(r.bpm),
        isPitched(r) ? (r.note ?? "") : r.note ? `${r.note}?` : "",
        r2(r.pitchConfidence),
        r2(r.harmonicity),
        r0(r.centroidHz),
        r1(r.transientDensity),
        r1(r.lufs),
        r.rating ? String(r.rating) : "",
        r.favorite ? "★" : "",
        r2(r.interest),
        r.tags.join(","),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

/** Counts per class / role — a quick map of what the library offers. */
export function librarySummary(rows: readonly AgentLibraryRow[]) {
  const count = (key: (r: AgentLibraryRow) => string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
    return m;
  };
  return {
    total: rows.length,
    byClass: count((r) => r.class),
    byRole: count((r) => r.role),
    loopable: rows.filter(isLoopable).length,
    pitched: rows.filter(isPitched).length,
    favorites: rows.filter((r) => r.favorite).length,
  };
}
