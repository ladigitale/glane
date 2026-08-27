/** Pure density cap for hunt cull — no DB. */

export const INTEREST_CULL = {
  /** Keep about target×minutes; slight slack before deleting. */
  headroom: 1.15,
  minKeep: 4,
  /** Floor elapsed so a short burst does not cull everything. */
  minElapsedMs: 20_000,
} as const;

/** Soft-cap for samples in a hunt, toward target captures/min. */
export function targetKeepCount(
  sessionDurationMs: number,
  targetPerMin: number,
): number {
  const minutes =
    Math.max(INTEREST_CULL.minElapsedMs, sessionDurationMs) / 60_000;
  return Math.max(
    INTEREST_CULL.minKeep,
    Math.ceil(minutes * targetPerMin * INTEREST_CULL.headroom),
  );
}
