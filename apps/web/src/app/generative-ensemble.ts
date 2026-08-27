/**
 * Ensemble voice relations for sequence generation (skill: glane-arranger).
 * One primary melodic voice; followers lock, respond, or share rhythm.
 */

import type { ExprRole } from "@glane/core-model";
import type { MusicStyleId } from "./generative-styles";
import {
  pickCallResponsePair,
  pickMelodyCell,
  type ArpEvent,
  type MelodyEvent,
} from "./generative-refs";

export type VoiceRelation = "independent" | "lock" | "respond" | "kinship";

/** User preference for how melodic followers relate to the lead. */
export type GenEnsembleRelation = "auto" | "lock" | "respond" | "kinship";

export type EnsembleSectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro";

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
  styleProfile: StyleEnsembleProfile;
};

export type StyleEnsembleFamily =
  | "popRock"
  | "groove"
  | "jazz"
  | "electronic"
  | "ambient"
  | "hiphop"
  | "reggae"
  | "folk";

export type StyleEnsembleProfile = {
  family: StyleEnsembleFamily;
  /** P(call–response) when callResponse is auto. */
  respondAutoChance: number;
  followerLockBias: number;
  followerKinshipBias: number;
  chorusLockBoost: number;
  verseRespondBoost: number;
  /** Alternate-bar dialogue in verse only, or also chorus. */
  alternateBarsSections: "verse" | "verseAndChorus";
  /** Derive arp cell from lead when follower is kinship (not only lock). */
  coupleArpOnKinship: boolean;
};

const STYLE_FAMILY: Record<MusicStyleId, StyleEnsembleFamily> = {
  rock: "popRock",
  pop: "popRock",
  punk: "popRock",
  garage: "popRock",
  metal: "popRock",
  disco: "popRock",
  funk: "groove",
  latin: "groove",
  afrobeat: "groove",
  blues: "groove",
  jazz: "jazz",
  techno: "electronic",
  house: "electronic",
  dnb: "electronic",
  breakbeat: "electronic",
  triphop: "ambient",
  ambient: "ambient",
  dub: "ambient",
  classical: "ambient",
  hiphop: "hiphop",
  reggae: "reggae",
  folk: "folk",
};

const FAMILY_PROFILES: Record<StyleEnsembleFamily, StyleEnsembleProfile> = {
  popRock: {
    family: "popRock",
    respondAutoChance: 0.55,
    followerLockBias: 0.4,
    followerKinshipBias: 0.55,
    chorusLockBoost: 0.6,
    verseRespondBoost: 0.3,
    alternateBarsSections: "verse",
    coupleArpOnKinship: true,
  },
  groove: {
    family: "groove",
    respondAutoChance: 0.72,
    followerLockBias: 0.28,
    followerKinshipBias: 0.62,
    chorusLockBoost: 0.45,
    verseRespondBoost: 0.52,
    alternateBarsSections: "verse",
    coupleArpOnKinship: true,
  },
  jazz: {
    family: "jazz",
    respondAutoChance: 0.78,
    followerLockBias: 0.18,
    followerKinshipBias: 0.68,
    chorusLockBoost: 0.22,
    verseRespondBoost: 0.58,
    alternateBarsSections: "verseAndChorus",
    coupleArpOnKinship: false,
  },
  electronic: {
    family: "electronic",
    respondAutoChance: 0.22,
    followerLockBias: 0.68,
    followerKinshipBias: 0.28,
    chorusLockBoost: 0.78,
    verseRespondBoost: 0.12,
    alternateBarsSections: "verse",
    coupleArpOnKinship: true,
  },
  ambient: {
    family: "ambient",
    respondAutoChance: 0.18,
    followerLockBias: 0.14,
    followerKinshipBias: 0.78,
    chorusLockBoost: 0.18,
    verseRespondBoost: 0.12,
    alternateBarsSections: "verse",
    coupleArpOnKinship: true,
  },
  hiphop: {
    family: "hiphop",
    respondAutoChance: 0.38,
    followerLockBias: 0.32,
    followerKinshipBias: 0.58,
    chorusLockBoost: 0.32,
    verseRespondBoost: 0.28,
    alternateBarsSections: "verse",
    coupleArpOnKinship: false,
  },
  reggae: {
    family: "reggae",
    respondAutoChance: 0.52,
    followerLockBias: 0.3,
    followerKinshipBias: 0.6,
    chorusLockBoost: 0.38,
    verseRespondBoost: 0.42,
    alternateBarsSections: "verse",
    coupleArpOnKinship: true,
  },
  folk: {
    family: "folk",
    respondAutoChance: 0.68,
    followerLockBias: 0.22,
    followerKinshipBias: 0.58,
    chorusLockBoost: 0.32,
    verseRespondBoost: 0.55,
    alternateBarsSections: "verseAndChorus",
    coupleArpOnKinship: true,
  },
};

export function ensembleProfileForStyle(
  style: MusicStyleId,
): StyleEnsembleProfile {
  const family = STYLE_FAMILY[style];
  return FAMILY_PROFILES[family];
}

/** True when arp should inherit the primary melody cell rhythm/degrees. */
export function shouldCoupleArp(
  voiceRel: VoiceRelation,
  profile: StyleEnsembleProfile,
): boolean {
  if (voiceRel === "lock") return true;
  if (voiceRel === "kinship" && profile.coupleArpOnKinship) return true;
  return false;
}

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

/** Snap a scale degree to the nearest chord tone (root / 3rd / 5th / 7th / 8ve). */
function snapMelodyDegreeToChordTone(degree: number): number {
  const tones = [0, 2, 4, 6, 7, 9, 11];
  let best = 0;
  let bestDist = Infinity;
  for (const t of tones) {
    const d = Math.abs(degree - t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** Derive an arp ostinato from the primary melody cell (same rhythm, chord tones). */
export function melodyCellToArpCell(
  cell: readonly MelodyEvent[],
): readonly ArpEvent[] {
  return cell.map((ev) => ({
    degree: snapMelodyDegreeToChordTone(ev.degree),
    sixteenths: ev.sixteenths,
    accent: ev.accent,
  }));
}

/** Degree offset when locking a follower onto the primary skeleton. */
export function lockDegreeOffset(
  role: ExprRole,
  rnd: () => number,
  family: StyleEnsembleFamily = "popRock",
): number {
  switch (role) {
    case "bass":
      return 0;
    case "chord":
      if (family === "jazz") return rnd() < 0.45 ? 4 : 6;
      if (family === "groove") return rnd() < 0.4 ? 2 : 4;
      return rnd() < 0.55 ? 2 : 4;
    case "arp":
      return 0;
    case "lead":
      return rnd() < 0.45 ? 0 : 2;
    default:
      return 2;
  }
}

/** Chorus locks; verse dialogues; bridge/intro stay lighter — style-weighted. */
export function resolveSectionRelation(
  base: VoiceRelation,
  section: EnsembleSectionKind,
  role: ExprRole,
  rnd: () => number,
  profile: StyleEnsembleProfile,
): VoiceRelation {
  if (base === "independent") return "independent";

  switch (section) {
    case "chorus":
    case "prechorus":
      if (base === "kinship" && rnd() < profile.chorusLockBoost) return "lock";
      if (
        base === "respond" &&
        role !== "arp" &&
        rnd() < profile.chorusLockBoost * 0.65
      ) {
        return "lock";
      }
      return base;
    case "verse":
      if (base === "lock" && rnd() < profile.verseRespondBoost) {
        return role === "arp" || role === "lead" ? "respond" : "kinship";
      }
      if (base === "lock" && rnd() < profile.verseRespondBoost + 0.2) {
        return "kinship";
      }
      return base;
    case "bridge":
    case "intro":
    case "outro":
      if (profile.family === "ambient" || profile.family === "jazz") {
        if (base === "lock" || base === "respond") return "kinship";
        return base;
      }
      if (base === "lock") return "kinship";
      if (base === "respond" && rnd() < 0.45) return "kinship";
      return base;
    default:
      return base;
  }
}

/** Verse (or chorus for jazz/folk) = alternate bars; else half-bar antiphony. */
export function respondPlacementMode(
  section: EnsembleSectionKind,
  profile: StyleEnsembleProfile,
): "halfBar" | "alternateBars" {
  if (profile.alternateBarsSections === "verseAndChorus") {
    if (section === "verse" || section === "chorus") return "alternateBars";
    return "halfBar";
  }
  return section === "verse" ? "alternateBars" : "halfBar";
}

export function isCallBar(absBar: number): boolean {
  return absBar % 2 === 0;
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
  profile: StyleEnsembleProfile,
): VoiceRelation {
  if (preferRespond && (role === "arp" || role === "lead")) {
    return "respond";
  }
  if (preferRespond && (role === "chord" || role === "bass") && rnd() < 0.35) {
    return "respond";
  }
  const lockBias =
    profile.followerLockBias + (energy > 0.6 ? 0.12 : 0);
  const kinBias = profile.followerKinshipBias;
  if (role === "bass" || role === "chord") {
    return rnd() < kinBias ? "kinship" : "lock";
  }
  if (rnd() < lockBias) return "lock";
  if (rnd() < kinBias) return "kinship";
  return preferRespond ? "respond" : "kinship";
}

export function planEnsemble(opts: {
  roles: readonly ExprRole[];
  rnd: () => number;
  callResponseMode: "auto" | "on" | "off";
  energy: number;
  sparse: boolean;
  musicStyle: MusicStyleId;
  /** Force follower relation; `"auto"` keeps style + call–response logic. */
  relationMode?: GenEnsembleRelation;
}): EnsemblePlan {
  const { roles, rnd, callResponseMode, energy, sparse, musicStyle } = opts;
  const relationMode: GenEnsembleRelation = opts.relationMode ?? "auto";
  const styleProfile = ensembleProfileForStyle(musicStyle);
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
      styleProfile,
    };
  }

  const wantRespond =
    relationMode === "respond" ||
    (relationMode === "auto" &&
      (callResponseMode === "on" ||
        (callResponseMode === "auto" &&
          rnd() < styleProfile.respondAutoChance)));

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
    leadCell = pickMelodyCell(rnd, sparse ? "sparse" : "dense");
    leadCellAlt = pickMelodyCell(rnd, "sparse");
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
    if (relationMode === "lock") {
      relationByTrack[i] = "lock";
      continue;
    }
    if (relationMode === "kinship") {
      relationByTrack[i] = "kinship";
      continue;
    }
    if (relationMode === "respond") {
      if (!hasRespond) {
        relationByTrack[i] = "respond";
        hasRespond = true;
      } else {
        // Other followers support the dialogue rather than a second lead.
        relationByTrack[i] =
          role === "bass" || role === "chord" ? "lock" : "kinship";
      }
      continue;
    }
    const preferRespond =
      wantRespond &&
      !hasRespond &&
      (role === "arp" ||
        role === "lead" ||
        (callResponseMode === "on" && !hasRespond));
    const rel = assignFollowerRelation(
      role,
      rnd,
      energy,
      preferRespond,
      styleProfile,
    );
    relationByTrack[i] = rel;
    if (rel === "respond") hasRespond = true;
  }

  const forceRespond =
    relationMode === "respond" ||
    (relationMode === "auto" && callResponseMode === "on");
  if (forceRespond && !hasRespond && respondOrder.length > 0) {
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
    styleProfile,
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
  // Bass/chord motifs often omit melodyDegree — inject 0 so lock offsets apply.
  const base = h.melodyDegree ?? 0;
  if (offset === 0) {
    return h.melodyDegree == null ? { ...h, melodyDegree: 0 } : { ...h };
  }
  return { ...h, melodyDegree: base + offset };
}

/** Chord-tone support line on the shared onset skeleton (bass / chord). */
export function supportHitsFromSkeleton(opts: {
  sharedOnsets: readonly number[];
  role: "bass" | "chord";
  beatsPerBar: number;
  ppq: number;
  sectionKind: EnsembleSectionKind;
  family: StyleEnsembleFamily;
  rnd: () => number;
}): EnsembleHit[] {
  if (opts.role === "bass") {
    return bassHitsForBar(opts);
  }
  return chordHitsForBar(opts);
}

/**
 * Bass line with motion — not a root drone on lead accents only.
 * Patterns stay chord-relative (0 / 2 / 4 / 7); rhythm follows style + section.
 */
export function bassHitsForBar(opts: {
  sharedOnsets: readonly number[];
  beatsPerBar: number;
  ppq: number;
  sectionKind: EnsembleSectionKind;
  family: StyleEnsembleFamily;
  rnd: () => number;
}): EnsembleHit[] {
  const { beatsPerBar, ppq, sectionKind, family, rnd, sharedOnsets } = opts;
  const tpb = beatsPerBar * ppq;
  const skeleton = skeletonTicks(sharedOnsets, beatsPerBar, ppq);

  type Step = { beat: number; degree: number; accent?: boolean };
  const pickPattern = (): Step[] => {
    const sparse =
      sectionKind === "intro" ||
      sectionKind === "outro" ||
      sectionKind === "bridge";
    const chorus =
      sectionKind === "chorus" || sectionKind === "prechorus";

    if (family === "electronic" || family === "hiphop") {
      if (sparse) {
        return [
          { beat: 0, degree: 0, accent: true },
          { beat: 2, degree: 0 },
        ];
      }
      // Four-on-floor root with 5th / octave answers
      const steps: Step[] = [
        { beat: 0, degree: 0, accent: true },
        { beat: 1, degree: chorus && rnd() < 0.5 ? 4 : 0 },
        { beat: 2, degree: chorus ? 7 : 0, accent: true },
        { beat: 3, degree: rnd() < 0.55 ? 4 : 0 },
      ];
      if (chorus && rnd() < 0.4) {
        steps.push({ beat: 3.5, degree: 0 });
      }
      return steps;
    }

    if (family === "jazz" || family === "folk") {
      // Walking quarters
      const walk: Step[] = [
        { beat: 0, degree: 0, accent: true },
        { beat: 1, degree: rnd() < 0.5 ? 2 : 4 },
        { beat: 2, degree: rnd() < 0.5 ? 4 : 7, accent: true },
        { beat: 3, degree: rnd() < 0.45 ? 5 : 2 },
      ];
      if (sparse) return walk.filter((s) => s.beat === 0 || s.beat === 2);
      return walk;
    }

    if (family === "reggae" || family === "groove") {
      // Offbeat lean + root anchors
      return sparse
        ? [
            { beat: 0, degree: 0, accent: true },
            { beat: 2.5, degree: 4 },
          ]
        : [
            { beat: 0, degree: 0, accent: true },
            { beat: 1.5, degree: 4 },
            { beat: 2, degree: 0, accent: true },
            { beat: 3.5, degree: chorus ? 7 : 4 },
          ];
    }

    // popRock / ambient default: root–5th–root–octave with syncopation
    if (sparse) {
      return [
        { beat: 0, degree: 0, accent: true },
        { beat: 2, degree: rnd() < 0.5 ? 4 : 0 },
      ];
    }
    const steps: Step[] = [
      { beat: 0, degree: 0, accent: true },
      { beat: 1, degree: rnd() < 0.4 ? 2 : 4 },
      { beat: 2, degree: 0, accent: true },
      { beat: 3, degree: chorus ? 7 : 4 },
    ];
    if (chorus && rnd() < 0.45) {
      steps.splice(1, 0, { beat: 0.5, degree: 0 });
    }
    if (rnd() < 0.35) {
      steps.push({ beat: 3.5, degree: 0 });
    }
    return steps;
  };

  const steps = pickPattern();
  const hits: EnsembleHit[] = steps.map((s) => {
    let tick = Math.round(s.beat * ppq) % tpb;
    // Nudge toward nearest lead accent when close (ensemble glue)
    if (skeleton.length > 0) {
      let best = tick;
      let bestD = Infinity;
      for (const sk of skeleton) {
        const d = Math.min(
          Math.abs(sk - tick),
          tpb - Math.abs(sk - tick),
        );
        if (d < bestD && d <= ppq * 0.35) {
          bestD = d;
          best = sk;
        }
      }
      if (s.accent && bestD < Infinity) tick = best;
    }
    return {
      tickInBar: tick,
      gainDb: s.accent ? 0.5 : -1.2,
      accent: !!s.accent,
      melodyDegree: s.degree,
    };
  });

  hits.sort((a, b) => a.tickInBar - b.tickInBar);
  return hits.length > 0
    ? hits
    : [{ tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 }];
}

function chordHitsForBar(opts: {
  sharedOnsets: readonly number[];
  beatsPerBar: number;
  ppq: number;
  sectionKind: EnsembleSectionKind;
  family: StyleEnsembleFamily;
  rnd: () => number;
}): EnsembleHit[] {
  const {
    sharedOnsets,
    beatsPerBar,
    ppq,
    sectionKind,
    family,
    rnd,
  } = opts;
  const skeleton = skeletonTicks(sharedOnsets, beatsPerBar, ppq);
  if (skeleton.length === 0) {
    return [
      {
        tickInBar: 0,
        gainDb: 0,
        accent: true,
        melodyDegree: 2,
      },
    ];
  }

  const dense =
    sectionKind === "chorus" || sectionKind === "prechorus";
  const sparse =
    sectionKind === "intro" ||
    sectionKind === "outro" ||
    sectionKind === "bridge";

  let ticks = [...skeleton];
  if (sparse) {
    ticks = skeleton.filter(
      (_, i) => i === 0 || i === skeleton.length - 1,
    );
  } else if (!dense) {
    ticks = skeleton.filter((t, i) => i === 0 || i % 2 === 0 || t === 0);
  }

  return ticks.map((t, i) => ({
    tickInBar: t,
    gainDb: i === 0 ? 0.4 : -1.4,
    accent: i === 0 || (dense && i % 2 === 0),
    melodyDegree: lockDegreeOffset("chord", rnd, family),
  }));
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

/** Full-bar response (alternate-bar dialogue in verse). */
export function applyRespondFullBar(
  responseCell: readonly MelodyEvent[],
  beatsPerBar: number,
  ppq: number,
): EnsembleHit[] {
  const tpb = beatsPerBar * ppq;
  const ticksPer16 = ppq / 4;
  let t = 0;
  const hits: EnsembleHit[] = [];
  for (const ev of responseCell) {
    const tick = Math.round(t);
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
    : [{ tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 }];
}

/** Thin primary on answer bars (alternate-bar dialogue). */
export function thinAnswerBar(
  hits: readonly EnsembleHit[],
  rnd: () => number,
): EnsembleHit[] {
  return hits.filter((h) => h.accent && rnd() < 0.4);
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
  applyRespondFullBar,
  applyKinship,
  thinCallHalf,
  thinAnswerBar,
  extractSharedOnsets,
  melodyCellToArpCell,
  lockDegreeOffset,
  supportHitsFromSkeleton,
  bassHitsForBar,
  resolveSectionRelation,
  respondPlacementMode,
  isCallBar,
  ensembleProfileForStyle,
  shouldCoupleArp,
} as const;
