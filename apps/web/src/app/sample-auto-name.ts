/**
 * Automatic sample display names — useful metadata first so lists stay scannable.
 * `Sample.name` is always the auto name; `userName` is the manual override.
 */

export type AutoSampleNameParts = {
  captureName?: string | null;
  class?: string | null;
  subclass?: string | null;
  noteName?: string | null;
  bpm?: number | null;
  durationMs: number;
  /** e.g. `slice 3/16`, `whole` */
  extra?: string | null;
  loopProposed?: boolean | null;
  tags?: readonly string[] | null;
};

const SEP = " · ";

export function formatNameDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 1000) {
    const s = ms / 1000;
    const rounded = s >= 10 ? s.toFixed(0) : s.toFixed(1);
    return `${rounded.replace(/\.0$/, "")}s`;
  }
  return `${Math.round(ms)}ms`;
}

export function bpmFromTags(tags: readonly string[] | undefined | null): number | null {
  if (!tags?.length) return null;
  for (const raw of tags) {
    const m = /^bpm:(\d+(?:\.\d+)?)$/i.exec(raw.trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** `slice:3/16` → `slice 3/16`; `whole` → `whole`. */
export function extraFromTags(
  tags: readonly string[] | undefined | null,
): string | undefined {
  if (!tags?.length) return undefined;
  for (const raw of tags) {
    const t = raw.trim();
    const slice = /^slice:(\d+)\/(\d+)$/i.exec(t);
    if (slice) return `slice ${slice[1]}/${slice[2]}`;
    if (t === "whole") return "whole";
  }
  return undefined;
}

function humanizeSubclass(slug: string): string {
  return slug.trim().replace(/[-_]+/g, " ");
}

/**
 * Compose a scannable auto name:
 * session · slice/whole · identity (subclass|class) · note · bpm · duration · boucle
 */
export function buildAutoSampleName(parts: AutoSampleNameParts): string {
  const out: string[] = [];
  const capture = (parts.captureName ?? "").trim();
  if (capture) out.push(capture);

  const extra =
    (parts.extra ?? "").trim() || extraFromTags(parts.tags) || "";
  if (extra) out.push(extra);

  const subclass = (parts.subclass ?? "").trim();
  const cls = (parts.class ?? "").trim();
  if (subclass) out.push(humanizeSubclass(subclass));
  else if (cls) out.push(cls);

  const note = (parts.noteName ?? "").trim();
  if (note) out.push(note);

  const bpm =
    parts.bpm != null && Number.isFinite(parts.bpm) && parts.bpm > 0
      ? parts.bpm
      : bpmFromTags(parts.tags);
  if (bpm != null) out.push(`${Math.round(bpm)}bpm`);

  out.push(formatNameDuration(parts.durationMs));

  if (parts.loopProposed) out.push("boucle");

  return out.join(SEP) || "son";
}
