import type { ExprRole } from "@glane/core-model";
import type { Section, TrackPart } from "./types.js";

/** Default energy thresholds for layer entry (phrase boundaries only). */
export const DEFAULT_ENTER_AT: Partial<Record<ExprRole, number>> = {
  texture: 0.05,
  loop: 0.1,
  chord: 0.2,
  hat: 0.25,
  perc: 0.3,
  kick: 0.2,
  snare: 0.35,
  bass: 0.35,
  arp: 0.45,
  lead: 0.5,
  fx: 0.4,
};

/**
 * Build [track][section] activity from energy thresholds.
 * drumsVsTexture shifts kit vs texture enterAt.
 */
export function buildLayerMatrix(opts: {
  trackRoles: ExprRole[];
  sections: readonly Section[];
  drumsVsTexture: number;
  enterAt?: Partial<Record<ExprRole, number>>;
}): boolean[][] {
  const base = { ...DEFAULT_ENTER_AT, ...opts.enterAt };
  const dvt = opts.drumsVsTexture;
  const kit: ExprRole[] = ["kick", "snare", "hat", "perc"];
  const texture: ExprRole[] = ["texture", "loop", "fx", "chord"];

  const matrix: boolean[][] = opts.trackRoles.map(() =>
    opts.sections.map(() => false),
  );

  for (let t = 0; t < opts.trackRoles.length; t++) {
    const role = opts.trackRoles[t]!;
    let thr = base[role] ?? 0.4;
    if (kit.includes(role)) thr -= (dvt - 0.5) * 0.25;
    if (texture.includes(role)) thr += (dvt - 0.5) * 0.25;
    thr = Math.min(0.9, Math.max(0.02, thr));

    for (let s = 0; s < opts.sections.length; s++) {
      const sec = opts.sections[s]!;
      let on = sec.energy >= thr;
      // Intro staircase: beds first
      if (sec.kind === "intro") {
        const phraseIdx = Math.floor(s); // section index as phrase proxy
        if (kit.includes(role) && phraseIdx === 0 && sec.occurrence === 0) {
          on = role === "hat" ? sec.energy >= thr : false;
        }
        if (role === "bass" && sec.occurrence === 0) on = false;
        if (role === "lead") on = false;
      }
      if (sec.kind === "outro") {
        if (role === "lead") on = false;
        if (kit.includes(role) && sec.energy < 0.35) on = role === "kick";
      }
      if (sec.kind === "break" && kit.includes(role)) {
        on = false;
      }
      matrix[t]![s] = on;
    }
  }
  return matrix;
}

/** Zero events on inactive track×section cells (phrase boundaries). */
export function applyLayerMatrix(
  parts: TrackPart[],
  sections: readonly Section[],
  matrix: boolean[][],
  ppq: number,
): TrackPart[] {
  const tpb = ppq * 4;
  return parts.map((part) => {
    const row = matrix[part.trackIndex];
    if (!row) return part;
    const events = part.events.filter((e) => {
      for (let s = 0; s < sections.length; s++) {
        const sec = sections[s]!;
        const start = sec.startBar * tpb;
        const end = (sec.startBar + sec.bars) * tpb;
        if (e.tick >= start && e.tick < end) {
          return row[s] === true;
        }
      }
      return true;
    });
    return { ...part, events };
  });
}

/** Assign stable track indices for roles present in the arrangement. */
export function defaultTrackRoles(
  includeMelody = false,
): ExprRole[] {
  const roles: ExprRole[] = ["kick", "snare", "hat", "perc", "bass"];
  if (includeMelody) roles.push("chord", "lead");
  return roles;
}

export function trackIndexByRole(
  roles: readonly ExprRole[],
): Partial<Record<ExprRole, number>> {
  const out: Partial<Record<ExprRole, number>> = {};
  roles.forEach((r, i) => {
    out[r] = i;
  });
  return out;
}
