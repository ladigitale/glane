import { mixcheckScore } from "@glane/composer";
import type { SequencePlanResult } from "./generative.js";

/**
 * Post-plan mix hygiene: Score rules + clip/track coverage.
 * Pure — no PCM decode.
 */
export function mixcheckPlan(result: SequencePlanResult): string[] {
  const warnings: string[] = [];

  if (result.clips.length === 0) {
    warnings.push("mixcheck: empty clip list");
    return warnings;
  }

  const byTrack = new Map<string, number>();
  for (const c of result.clips) {
    byTrack.set(c.trackId, (byTrack.get(c.trackId) ?? 0) + 1);
    if (c.gainDb > 6) {
      warnings.push(
        `mixcheck: clip gain ${c.gainDb.toFixed(1)} dB on ${c.trackId}`,
      );
    }
  }

  for (const t of result.tracks) {
    if ((byTrack.get(t.trackId) ?? 0) === 0) {
      warnings.push(`mixcheck: track ${t.trackId} has no clips`);
    }
    if (t.gainDb > 6) {
      warnings.push(
        `mixcheck: track ${t.trackId} gain ${t.gainDb.toFixed(1)} dB`,
      );
    }
  }

  if (result.score) {
    const scoreCheck = mixcheckScore(result.score);
    warnings.push(...scoreCheck.warnings);
  }

  return warnings;
}
