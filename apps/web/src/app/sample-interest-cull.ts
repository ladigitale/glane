import type { Sample, Session } from "@glane/core-model";
import {
  DEFAULT_TARGET_CAPTURES_PER_MIN,
  db,
  ensurePrefs,
} from "./db.js";
import { deleteSample } from "./sample-actions.js";

export const SAMPLES_CULLED_EVENT = "glane:samples-culled";

/** Matches import-for-hunt session notes — no density cull for these. */
const CULL_EXEMPT_NOTES = new Set(["glane:file-song", "glane:file-whole"]);
export const INTEREST_CULL = {
  /** Keep about target×minutes; slight slack before deleting. */
  headroom: 1.15,
  minKeep: 4,
  /** Floor elapsed so a short burst does not cull everything. */
  minElapsedMs: 20_000,
} as const;

export type CullResult = {
  culledIds: string[];
  kept: number;
  target: number;
};

/** Soft-cap for processed samples in a hunt, toward target captures/min. */
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

function isProcessedKeepCandidate(s: Sample): boolean {
  if (s.deletedAt) return false;
  if (s.favorite) return false;
  if (s.interestScore == null || !Number.isFinite(s.interestScore)) return false;
  const tags = s.tags ?? [];
  return tags.includes("processing:done");
}

/**
 * Soft-delete least interesting processed samples in a session until count ≈ target.
 * Favorites and unprocessed clips are never removed. Detection rate stats are untouched.
 */
export async function cullExcessProcessedSamples(
  sessionId: string,
): Promise<CullResult> {
  const session = await db.sessions.get(sessionId);
  if (!session) return { culledIds: [], kept: 0, target: 0 };
  if (CULL_EXEMPT_NOTES.has(session.notes ?? "")) {
    return { culledIds: [], kept: 0, target: 0 };
  }

  const prefs = await ensurePrefs();
  const targetPerMin =
    prefs.targetCapturesPerMin ?? DEFAULT_TARGET_CAPTURES_PER_MIN;
  const elapsedMs = sessionElapsedMs(session);
  const target = targetKeepCount(elapsedMs, targetPerMin);

  const rows = await db.samples.where("sessionId").equals(sessionId).toArray();
  const alive = rows.filter((s) => !s.deletedAt);
  const protectedCount = alive.filter(
    (s) => s.favorite || !isProcessedKeepCandidate(s),
  ).length;
  const candidates = alive
    .filter(isProcessedKeepCandidate)
    .sort(
      (a, b) =>
        (a.interestScore ?? 0) - (b.interestScore ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    );

  const excess = alive.length - target;
  if (excess <= 0) {
    return { culledIds: [], kept: alive.length, target };
  }

  // Never cull below minKeep, and never remove protected rows.
  const maxDelete = Math.min(
    excess,
    Math.max(0, alive.length - INTEREST_CULL.minKeep),
    Math.max(0, alive.length - protectedCount),
  );
  const toDelete = candidates.slice(0, maxDelete);
  const culledIds: string[] = [];
  for (const s of toDelete) {
    await deleteSample(s.id);
    culledIds.push(s.id);
  }

  if (culledIds.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SAMPLES_CULLED_EVENT, {
        detail: { sessionId, culledIds },
      }),
    );
  }

  return {
    culledIds,
    kept: alive.length - culledIds.length,
    target,
  };
}

function sessionElapsedMs(session: Session): number {
  if (session.durationMs > 0) return session.durationMs;
  const start = Date.parse(session.startedAt);
  if (!Number.isFinite(start)) return INTEREST_CULL.minElapsedMs;
  return Math.max(0, Date.now() - start);
}
