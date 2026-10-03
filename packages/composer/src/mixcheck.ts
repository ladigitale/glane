import { estimateSectionPeakDb } from "./master.js";
import type { Score } from "./types.js";

/**
 * Static mix hygiene on a Score (no PCM). Returns warning strings for UI / logs.
 */
export function mixcheckScore(score: Score): {
  ok: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const { mix, parts, sections, layerMatrix } = score;
  const roles = parts.map((p) => p.role);

  if (parts.length === 0) {
    warnings.push("mixcheck: no parts");
  }
  if (sections.length === 0) {
    warnings.push("mixcheck: no sections");
  }

  const kick = mix.tracks.find((t) => t.role === "kick");
  const bass = mix.tracks.find((t) => t.role === "bass");
  if (kick && bass && kick.levelDb > -6 && bass.levelDb > -6) {
    warnings.push(
      `mixcheck: kick+bass both hot (${kick.levelDb.toFixed(1)} / ${bass.levelDb.toFixed(1)} dB)`,
    );
  }

  for (const t of mix.tracks) {
    if (t.levelDb > 3) {
      warnings.push(
        `mixcheck: track ${t.role} level ${t.levelDb.toFixed(1)} dB (clip risk)`,
      );
    }
    if (t.sendA + t.sendB > 1.35) {
      warnings.push(
        `mixcheck: track ${t.role} sends wet (${(t.sendA + t.sendB).toFixed(2)})`,
      );
    }
  }

  const allRoles = new Set(mix.tracks.map((t) => t.role));
  const peak = estimateSectionPeakDb(mix.tracks, allRoles);
  const afterMaster = peak + mix.master.masterGainDb;
  if (afterMaster > mix.master.ceilingDbtp) {
    warnings.push(
      `mixcheck: est. peak ${afterMaster.toFixed(1)} dBTP > ceiling ${mix.master.ceilingDbtp}`,
    );
  }

  // Silent track row (all matrix cells false) while role has events planned.
  for (let ti = 0; ti < roles.length; ti++) {
    const row = layerMatrix[ti];
    if (!row || row.length === 0) continue;
    const everOn = row.some(Boolean);
    const part = parts[ti];
    if (!everOn && part && part.events.length > 0) {
      warnings.push(
        `mixcheck: ${part.role} has events but layer matrix always off`,
      );
    }
  }

  // Intro / outro with zero beds when a bed role exists.
  const bedRoles = new Set(["texture", "loop", "fx", "chord"]);
  const hasBedTrack = mix.tracks.some((t) => bedRoles.has(t.role));
  if (hasBedTrack) {
    for (const sec of sections) {
      if (sec.kind !== "intro" && sec.kind !== "outro") continue;
      const si = sections.indexOf(sec);
      let bedOn = false;
      for (let ti = 0; ti < roles.length; ti++) {
        if (!bedRoles.has(roles[ti]!)) continue;
        if (layerMatrix[ti]?.[si]) {
          bedOn = true;
          break;
        }
      }
      if (!bedOn) {
        warnings.push(`mixcheck: ${sec.kind} has no bed layer`);
      }
    }
  }

  return { ok: warnings.length === 0, warnings };
}
