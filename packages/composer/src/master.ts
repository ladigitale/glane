import { DEFAULT_TRACK_FX, type TrackFx } from "@glane/core-model";
import type { MusicStyleId } from "./styles/ids.js";
import type { MasterPlan, Section, TrackMixPlan } from "./types.js";

function glueCompressor(estimatedPeakDb: number): TrackFx {
  return {
    ...DEFAULT_TRACK_FX,
    type: "compressor",
    thresholdDb: Math.min(-12, estimatedPeakDb - 6),
    ratio: 2.5,
    mix: 0.45,
    attackMs: 25,
    releaseMs: 180,
  };
}

function colourFx(style: MusicStyleId): TrackFx {
  if (style === "ambient" || style === "jazz" || style === "classical") {
    return {
      ...DEFAULT_TRACK_FX,
      type: "reverb",
      mix: 0.2,
      decay: 0.35,
      damping: 0.5,
    };
  }
  if (style === "rock" || style === "techno" || style === "metal") {
    return { ...DEFAULT_TRACK_FX, type: "none" };
  }
  return {
    ...DEFAULT_TRACK_FX,
    type: "eq",
    low: 0.95,
    mid: 1,
    high: 1.05,
    mix: 0.3,
  };
}

/**
 * Static headroom estimate: sum active track linear levels with partial
 * correlation → peak dBFS. Target ≥ 3 dB margin before limiter.
 */
export function estimateSectionPeakDb(
  tracks: readonly TrackMixPlan[],
  activeRoles: ReadonlySet<string>,
): number {
  let sumLin = 0;
  for (const t of tracks) {
    if (!activeRoles.has(t.role)) continue;
    sumLin += 10 ** (t.levelDb / 20);
  }
  // Partial correlation ~0.5 → less than incoherent sum
  const peakLin = Math.sqrt(sumLin) * 0.85 + sumLin * 0.15;
  if (peakLin <= 0) return -60;
  return 20 * Math.log10(peakLin);
}

export function planMaster(opts: {
  tracks: readonly TrackMixPlan[];
  sections: readonly Section[];
  layerMatrix: boolean[][];
  trackRoles: readonly string[];
  style: MusicStyleId;
  targetLufs: number;
  space?: number;
}): { master: MasterPlan; warnings: string[] } {
  const warnings: string[] = [];
  // Worst case: all mix tracks concurrent (conservative headroom).
  const allRoles = new Set(opts.tracks.map((t) => t.role));
  let worst = estimateSectionPeakDb(opts.tracks, allRoles);
  for (let s = 0; s < opts.sections.length; s++) {
    const active = new Set<string>();
    for (let t = 0; t < opts.trackRoles.length; t++) {
      if (opts.layerMatrix[t]?.[s]) active.add(opts.trackRoles[t]!);
    }
    for (const tr of opts.tracks) {
      if (tr.role === "kick" || tr.role === "bass") active.add(tr.role);
    }
    worst = Math.max(worst, estimateSectionPeakDb(opts.tracks, active));
  }

  // Normalize so worst peak ≤ -3 dBFS
  let masterGainDb = 0;
  const margin = -3 - worst;
  if (margin < 0) {
    masterGainDb = margin;
    warnings.push(
      `master: headroom trim ${masterGainDb.toFixed(1)} dB (est. peak ${worst.toFixed(1)} dBFS)`,
    );
  }

  const peakAfter = worst + masterGainDb;
  if (peakAfter > -3.01) {
    warnings.push(`master: headroom still tight (${peakAfter.toFixed(1)} dBFS)`);
  }

  const master: MasterPlan = {
    preampGainDb: 0,
    masterGainDb,
    fx: [glueCompressor(peakAfter), colourFx(opts.style)],
    targetLufs: opts.targetLufs,
    ceilingDbtp: -1,
  };
  return { master, warnings };
}

export function headroomOk(
  tracks: readonly TrackMixPlan[],
  master: MasterPlan,
  _sections?: readonly Section[],
  _layerMatrix?: boolean[][],
  _trackRoles?: readonly string[],
): boolean {
  const allRoles = new Set(tracks.map((t) => t.role));
  const peak =
    estimateSectionPeakDb(tracks, allRoles) + master.masterGainDb;
  return peak <= -3 + 1e-6;
}
