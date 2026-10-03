import type { ExprRole } from "@glane/core-model";
import type { Section, TrackPart } from "./types.js";

/** Default energy thresholds for layer entry (phrase boundaries only). */
export const DEFAULT_ENTER_AT: Partial<Record<ExprRole, number>> = {
  texture: 0,
  loop: 0,
  chord: 0.08,
  hat: 0.12,
  perc: 0.2,
  kick: 0.1,
  snare: 0.24,
  bass: 0.18,
  arp: 0.28,
  lead: 0.32,
  fx: 0.05,
};

const KIT: ExprRole[] = ["kick", "snare", "hat", "perc"];
const BEDS: ExprRole[] = ["texture", "loop", "fx", "chord"];

function isBed(role: ExprRole): boolean {
  return BEDS.includes(role);
}

/**
 * Build [track][section] activity from energy thresholds.
 * Intro/outro always keep beds + light kit (never fully empty).
 */
export function buildLayerMatrix(opts: {
  trackRoles: ExprRole[];
  sections: readonly Section[];
  drumsVsTexture: number;
  enterAt?: Partial<Record<ExprRole, number>>;
}): boolean[][] {
  const base = { ...DEFAULT_ENTER_AT, ...opts.enterAt };
  const dvt = opts.drumsVsTexture;

  const matrix: boolean[][] = opts.trackRoles.map(() =>
    opts.sections.map(() => false),
  );

  for (let t = 0; t < opts.trackRoles.length; t++) {
    const role = opts.trackRoles[t]!;
    let thr = base[role] ?? 0.4;
    if (KIT.includes(role)) thr -= (dvt - 0.5) * 0.25;
    if (isBed(role)) thr += (dvt - 0.5) * 0.15;
    thr = Math.min(0.85, Math.max(0, thr));

    for (let s = 0; s < opts.sections.length; s++) {
      const sec = opts.sections[s]!;
      let on = sec.energy >= thr;

      if (sec.kind === "intro") {
        // Staircase: beds + hat always; kick/bass/perc earlier; snare/lead stay out
        if (isBed(role)) on = true;
        else if (role === "hat") on = true;
        else if (role === "kick" || role === "perc") on = sec.bars >= 2;
        else if (role === "bass") on = sec.bars >= 4;
        else if (role === "arp") on = sec.bars >= 8 && sec.energy >= 0.35;
        else if (role === "snare" || role === "lead") {
          on = false;
        }
      } else if (sec.kind === "outro") {
        // Beds + kick/hat/bass; light arp OK; drop snare/lead
        if (isBed(role) || role === "bass") on = true;
        else if (role === "kick" || role === "hat") on = true;
        else if (role === "perc") on = sec.energy >= 0.25;
        else if (role === "arp") on = sec.energy >= 0.35;
        else if (role === "snare" || role === "lead") {
          on = false;
        }
      } else if (sec.kind === "break") {
        // Keep hats (+ beds/bass via thr); mute kick/snare/perc only
        if (role === "hat") on = true;
        else if (role === "kick" || role === "snare" || role === "perc") {
          on = false;
        }
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
