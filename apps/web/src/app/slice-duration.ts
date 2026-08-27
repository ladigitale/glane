/** Optional slice length filter (ms) — empty / null = no length filter. */

export const SLICE_DURATION = {
  /** Absolute clamp for UI / prefs when a value is set. */
  absMinMs: 20,
  absMaxMs: 60_000,
} as const;

export type SliceDurationFilter = {
  minMs: number | null;
  maxMs: number | null;
};

/** Parse optional ms from prefs / form; null = no bound. */
export function parseOptionalDurationMs(
  value: unknown,
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(
    Math.min(SLICE_DURATION.absMaxMs, Math.max(SLICE_DURATION.absMinMs, n)),
  );
}

/** Resolve optional length filter (null bounds = do not filter that side). */
export function resolveSliceDurationFilter(opts: {
  minMs?: number | null;
  maxMs?: number | null;
}): SliceDurationFilter {
  let minMs = parseOptionalDurationMs(opts.minMs);
  let maxMs = parseOptionalDurationMs(opts.maxMs);
  if (minMs != null && maxMs != null && minMs > maxMs) {
    const t = minMs;
    minMs = maxMs;
    maxMs = t;
  }
  return { minMs, maxMs };
}

/** Keep sounds whose duration falls within the optional min/max (inclusive). */
export function durationPassesSliceFilter(
  durationMs: number,
  filter: SliceDurationFilter,
): boolean {
  if (filter.minMs != null && durationMs < filter.minMs) return false;
  if (filter.maxMs != null && durationMs > filter.maxMs) return false;
  return true;
}
