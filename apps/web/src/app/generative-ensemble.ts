/**
 * Ensemble voice relations for sequence generation (skill: glane-arranger).
 * One primary melodic voice; followers lock, respond, or share rhythm.
 */

import type { ExprRole } from "@glane/core-model";
import {
  pickCallResponsePair,
  pickMelodyCell,
  type MelodyEvent,
} from "./generative-refs";

export type VoiceRelation = "independent" | "lock" | "respond" | "kinship";

export type EnsembleHit = {
  tickInBar: number;
  gainDb: number;
  accent: boolean;
  melodyDegree?: number;
};

export type EnsemblePlan = {
  /** track index → relation to primary melodic voice */
  relationByTrack: VoiceRelation[];
  primaryLeadTrack: number | null;
  /** Shared onset skeleton in sixteenths-of-bar (from primary accents). */
  sharedOnsets: readonly number[];
  leadCell: readonly MelodyEvent[] | null;
  leadCellAlt: readonly MelodyEvent[] | null;
  responseCell: readonly MelodyEvent[] | null;
};

const MELODIC_ROLES: readonly ExprRole[] = [
  "lead",
  "arp",
  "chord",
  "bass",
];

function isMelodicRole(role: ExprRole): boolean {
  return (MELODIC_ROLES as readonly string[]).includes(role);
}

/** Sixteenth positions of accents (+ first note) within a melody cell. */
export function extractSharedOnsets(
  cell: readonly MelodyEvent[],
): readonly number[] {
  let t = 0;
  const out: number[] = [];
  for (const ev of cell) {
    if (ev.accent || out.length === 0) out.push(t);
    t += ev.sixteenths;
  }
  return out;
}

function pickPrimaryTrack(roles: readonly ExprRole[]): number | null {
  for (const role of ["lead", "arp", "chord"] as const) {
    const i = roles.indexOf(role);
    if (i >= 0) return i;
  }
  return null;
}

function assignFollowerRelation(
  role: ExprRole,
  rnd: () => number,
  energy: number,
  preferRespond: boolean,
): VoiceRelation {
  if (preferRespond && (role === "arp" || role === "lead")) {
    return "respond";
  }
  if (preferRespond && (role === "chord" || role === "bass") && rnd() < 0.35) {
    return "respond";
  }
  const lockBias = energy > 0.6 ? 0.55 : 0.35;
  if (role === "bass" || role === "chord") {
    return rnd() < 0.65 ? "kinship" : "lock";
  }
  return rnd() < lockBias ? "lock" : "kinship";
}

export function planEnsemble(opts: {
  roles: readonly ExprRole[];
  rnd: () => number;
  callResponseMode: "auto" | "on" | "off";
  energy: number;
  sparse: boolean;
}): EnsemblePlan {
  const { roles, rnd, callResponseMode, energy, sparse } = opts;
  const relationByTrack: VoiceRelation[] = roles.map(() => "independent");
  const primaryLeadTrack = pickPrimaryTrack(roles);

  if (primaryLeadTrack == null) {
    return {
      relationByTrack,
      primaryLeadTrack: null,
      sharedOnsets: [],
      leadCell: null,
      leadCellAlt: null,
      responseCell: null,
    };
  }

  const wantRespond =
    callResponseMode === "on" ||
    (callResponseMode === "auto" && rnd() < 0.55);

  let leadCell: readonly MelodyEvent[];
  let leadCellAlt: readonly MelodyEvent[];
  let responseCell: readonly MelodyEvent[];

  if (wantRespond) {
    const pair = pickCallResponsePair(rnd);
    leadCell = pair.call;
    responseCell = pair.response;
    const pairAlt = pickCallResponsePair(rnd);
    leadCellAlt = pairAlt.call;
  } else {
    leadCell = pickMelodyCell(rnd, sparse);
    leadCellAlt = pickMelodyCell(rnd, sparse);
    responseCell = pickCallResponsePair(rnd).response;
  }

  const sharedOnsets = extractSharedOnsets(leadCell);

  const followers = roles
    .map((role, i) => ({ role, i }))
    .filter(
      ({ role, i }) => i !== primaryLeadTrack && isMelodicRole(role),
    );

  // Prefer arp (then lead, then chord/bass) as respond partner.
  const respondOrder = [...followers].sort((a, b) => {
    const rank = (r: ExprRole) =>
      r === "arp" ? 0 : r === "lead" ? 1 : r === "chord" ? 2 : 3;
    return rank(a.role) - rank(b.role);
  });

  let hasRespond = false;
  for (const { role, i } of respondOrder) {
    const preferRespond =
      wantRespond &&
      !hasRespond &&
      (role === "arp" ||
        role === "lead" ||
        (callResponseMode === "on" && !hasRespond));
    const rel = assignFollowerRelation(role, rnd, energy, preferRespond);
    relationByTrack[i] = rel;
    if (rel === "respond") hasRespond = true;
  }

  if (callResponseMode === "on" && !hasRespond && respondOrder.length > 0) {
    const forced = respondOrder[0]!;
    relationByTrack[forced.i] = "respond";
  }

  relationByTrack[primaryLeadTrack] = "independent";

  return {
    relationByTrack,
    primaryLeadTrack,
    sharedOnsets,
    leadCell,
    leadCellAlt,
    responseCell,
  };
}

function skeletonTicks(
  sharedOnsets: readonly number[],
  beatsPerBar: number,
  ppq: number,
): number[] {
  const ticksPer16 = ppq / 4;
  const tpb = beatsPerBar * ppq;
  return sharedOnsets.map((s) => Math.round(s * ticksPer16) % tpb);
}

function nearSkeleton(
  tickInBar: number,
  skeleton: readonly number[],
  tol: number,
  tpb: number,
): boolean {
  return skeleton.some((t) => {
    const d = Math.abs(tickInBar - t);
    return d <= tol || Math.abs(d - tpb) <= tol;
  });
}

/** Align / filter hits onto the shared onset skeleton; optional 3rd offset. */
export function applyLock(
  hits: readonly EnsembleHit[],
  sharedOnsets: readonly number[],
  beatsPerBar: number,
  ppq: number,
  degreeOffset = 2,
): EnsembleHit[] {
  const tpb = beatsPerBar * ppq;
  const skeleton = skeletonTicks(sharedOnsets, beatsPerBar, ppq);
  if (skeleton.length === 0) {
    return hits.map((h) => shiftDegree(h, degreeOffset));
  }
  const tol = Math.max(2, Math.floor(ppq / 8));
  const locked = hits
    .filter((h) => nearSkeleton(h.tickInBar, skeleton, tol, tpb))
    .map((h) => shiftDegree(h, degreeOffset));
  if (locked.length > 0) return locked;

  return skeleton.map((t, i) => {
    const src = hits[i % Math.max(1, hits.length)];
    return shiftDegree(
      {
        tickInBar: t,
        gainDb: i === 0 ? 0.5 : -1,
        accent: i === 0,
        melodyDegree: src?.melodyDegree ?? 0,
      },
      degreeOffset,
    );
  });
}

function shiftDegree(h: EnsembleHit, offset: number): EnsembleHit {
  if (h.melodyDegree == null || offset === 0) return { ...h };
  return { ...h, melodyDegree: h.melodyDegree + offset };
}

/** Place response cell on the second half-bar (call–response). */
export function applyRespond(
  responseCell: readonly MelodyEvent[],
  beatsPerBar: number,
  ppq: number,
): EnsembleHit[] {
  const tpb = beatsPerBar * ppq;
  const half = Math.floor(tpb / 2);
  const ticksPer16 = ppq / 4;
  let t = 0;
  const hits: EnsembleHit[] = [];
  for (const ev of responseCell) {
    const tick = half + Math.round(t);
    if (tick >= tpb) break;
    hits.push({
      tickInBar: tick,
      gainDb: ev.accent ? 0.5 : -1,
      accent: !!ev.accent,
      melodyDegree: ev.degree,
    });
    t += ev.sixteenths * ticksPer16;
  }
  return hits.length > 0
    ? hits
    : [
        {
          tickInBar: half,
          gainDb: 0,
          accent: true,
          melodyDegree: 0,
        },
      ];
}

/** Keep shared accents; allow some ornamentation off-skeleton. */
export function applyKinship(
  hits: readonly EnsembleHit[],
  sharedOnsets: readonly number[],
  beatsPerBar: number,
  ppq: number,
  rnd: () => number,
): EnsembleHit[] {
  const tpb = beatsPerBar * ppq;
  const skeleton = skeletonTicks(sharedOnsets, beatsPerBar, ppq);
  if (skeleton.length === 0) return hits.map((h) => ({ ...h }));
  const tol = Math.max(2, Math.floor(ppq / 8));
  return hits.filter((h) => {
    if (nearSkeleton(h.tickInBar, skeleton, tol, tpb) || h.accent) return true;
    return rnd() < 0.4;
  });
}

/**
 * When a respond partner exists, thin the primary's second half so the
 * dialogue reads as call then answer.
 */
export function thinCallHalf(
  hits: readonly EnsembleHit[],
  beatsPerBar: number,
  ppq: number,
  rnd: () => number,
): EnsembleHit[] {
  const half = Math.floor((beatsPerBar * ppq) / 2);
  return hits.filter((h) => {
    if (h.tickInBar < half) return true;
    if (h.accent) return rnd() < 0.35;
    return rnd() < 0.15;
  });
}

export const ensemble = {
  plan: planEnsemble,
  applyLock,
  applyRespond,
  applyKinship,
  thinCallHalf,
  extractSharedOnsets,
} as const;
