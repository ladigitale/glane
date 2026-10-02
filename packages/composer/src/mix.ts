import { DEFAULT_TRACK_FX, type ExprRole, type TrackFx } from "@glane/core-model";
import type { MusicStyleId } from "./styles/ids.js";
import type {
  Section,
  SignatureFxKind,
  SpacePlan,
  TrackMixPlan,
  TrackPart,
} from "./types.js";

/** Relative levels — kick = 0 dB reference. */
export const ROLE_LEVEL_DB: Record<ExprRole, number> = {
  kick: 0,
  bass: -2,
  snare: -3,
  lead: -4,
  chord: -7,
  arp: -6,
  hat: -10,
  perc: -9,
  texture: -12,
  loop: -11,
  fx: -10,
};

function widthFor(role: ExprRole): TrackMixPlan["widthRole"] {
  if (role === "kick" || role === "bass" || role === "snare" || role === "lead") {
    return "center";
  }
  if (role === "hat" || role === "perc") return "pairL";
  if (role === "chord" || role === "arp") return "pairR";
  return "wide";
}

function panFor(
  role: ExprRole,
  width: TrackMixPlan["widthRole"],
  index: number,
): number {
  if (width === "center") return 0;
  if (width === "pairL") return -0.35 - (index % 2) * 0.1;
  if (width === "pairR") return 0.35 + (index % 2) * 0.1;
  return index % 2 === 0 ? -0.55 : 0.55;
}

function depthFor(role: ExprRole, sectionEnergy: number): number {
  let d = 0.35;
  if (role === "kick" || role === "bass") d = 0.05;
  if (role === "lead") d = 0.15 + (1 - sectionEnergy) * 0.25;
  if (role === "snare") d = 0.2;
  if (role === "chord" || role === "texture" || role === "loop") d = 0.55;
  if (role === "hat" || role === "perc") d = 0.4;
  return Math.min(1, Math.max(0, d));
}

function characterInsert(role: ExprRole, style: MusicStyleId): TrackFx {
  const base = { ...DEFAULT_TRACK_FX };
  if (role === "kick" || role === "bass") {
    return { ...base, type: "eq", low: 1.15, mid: 0.95, high: 0.85, mix: 0.4 };
  }
  if (role === "snare") {
    return { ...base, type: "eq", low: 0.85, mid: 1.1, high: 1.15, mix: 0.35 };
  }
  if (style === "dub" || style === "reggae") {
    return {
      ...base,
      type: "echo",
      delayBeats: 0.75,
      feedback: 0.35,
      mix: 0.2,
    };
  }
  if (role === "lead" || role === "chord") {
    return {
      ...base,
      type: style === "ambient" ? "chorus" : "eq",
      mix: 0.3,
      depth: 0.4,
      rateHz: 0.8,
    };
  }
  return { ...base, type: "none" };
}

function pickSignature(
  style: MusicStyleId,
  parts: readonly TrackPart[],
): SpacePlan["signature"] | undefined {
  let kind: SignatureFxKind | undefined;
  if (style === "dub" || style === "reggae") kind = "dubEcho";
  else if (style === "pop" || style === "funk" || style === "disco") {
    kind = "chorusWash";
  } else if (style === "ambient" || style === "folk") kind = "tremoloPulse";
  else if (style === "rock" || style === "metal") kind = "gatedVerb";
  if (!kind) return undefined;
  const tracks = parts
    .filter((p) => p.role === "snare" || p.role === "lead" || p.role === "perc")
    .slice(0, 2)
    .map((p) => p.trackIndex);
  if (!tracks.length) return undefined;
  return { kind, tracks };
}

export function planMix(opts: {
  parts: readonly TrackPart[];
  sections: readonly Section[];
  style: MusicStyleId;
  space: number;
  bpm?: number;
}): { tracks: TrackMixPlan[]; spaces: SpacePlan } {
  const space = Math.min(1, Math.max(0, opts.space));
  const meanEnergy =
    opts.sections.reduce((s, x) => s + x.energy, 0) /
    Math.max(1, opts.sections.length);

  const tracks: TrackMixPlan[] = opts.parts.map((p, i) => {
    const widthRole = widthFor(p.role);
    const depth = depthFor(p.role, meanEnergy);
    const sendA =
      p.role === "kick" || p.role === "bass"
        ? 0
        : Math.min(0.7, (0.15 + depth * 0.5) * space);
    const sendB =
      p.role === "kick" || p.role === "bass"
        ? 0
        : Math.min(0.55, (0.05 + depth * 0.35) * space);
    return {
      trackIndex: p.trackIndex,
      role: p.role,
      levelDb: ROLE_LEVEL_DB[p.role] ?? -6,
      pan: panFor(p.role, widthRole, i),
      widthRole,
      depth,
      insert: characterInsert(p.role, opts.style),
      sendA,
      sendB,
    };
  });

  const decayA = Math.min(0.9, 0.3 + space * 0.45 + (1 - meanEnergy) * 0.15);
  const spaces: SpacePlan = {
    A: {
      ...DEFAULT_TRACK_FX,
      type: "reverb",
      mix: 1,
      decay: decayA,
      damping: 0.4,
    },
    B: {
      ...DEFAULT_TRACK_FX,
      type: "echo",
      mix: 1,
      delayBeats: 0.75,
      feedback: 0.25 + space * 0.25,
    },
    signature: pickSignature(opts.style, opts.parts),
  };

  return { tracks, spaces };
}

/** Mix invariants used by tests. */
export function mixOk(tracks: readonly TrackMixPlan[]): boolean {
  for (const t of tracks) {
    const expected = ROLE_LEVEL_DB[t.role];
    if (expected != null && Math.abs(t.levelDb - expected) > 1.5) return false;
    if (
      (t.role === "kick" || t.role === "bass" || t.role === "lead") &&
      Math.abs(t.pan) > 0.1
    ) {
      return false;
    }
    if ((t.role === "kick" || t.role === "bass") && t.sendA > 0.05) return false;
  }
  return true;
}
