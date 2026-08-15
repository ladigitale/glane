import {
  clampNorm,
  hzToCutoffNorm,
  hzToFundNorm,
  msToDurationNorm,
  waveToNorm,
} from "./map.js";
import { DEFAULT_SUBTRACTIVE_NORM, type SubtractiveNorm } from "./types.js";

export type AnalysisAnchorIn = {
  durationMs: number;
  pitchHz?: number;
  centroidHz?: number;
  transientDensity?: number;
  harmonicity?: number;
};

/**
 * Heuristic subtractive pivot from library sample analysis (ADR-0021).
 * Missing fields fall back to DEFAULT_SUBTRACTIVE_NORM.
 */
export function anchorFromAnalysis(a: AnalysisAnchorIn): SubtractiveNorm {
  const base = { ...DEFAULT_SUBTRACTIVE_NORM };

  if (a.pitchHz && a.pitchHz > 20 && a.pitchHz < 4000) {
    base.fund = hzToFundNorm(a.pitchHz);
  }

  if (a.centroidHz && a.centroidHz > 40) {
    base.cutoff = hzToCutoffNorm(a.centroidHz);
  }

  if (a.durationMs > 0) {
    base.duration = msToDurationNorm(a.durationMs);
  }

  const harm = a.harmonicity;
  if (harm != null && Number.isFinite(harm)) {
    // High harmonicity → sine/triangle; low → saw/square
    if (harm > 0.7) base.wave = waveToNorm("sine");
    else if (harm > 0.45) base.wave = waveToNorm("triangle");
    else if (harm > 0.25) base.wave = waveToNorm("sawtooth");
    else base.wave = waveToNorm("square");
  }

  const td = a.transientDensity;
  if (td != null && Number.isFinite(td)) {
    // Dense transients → short attack / lower sustain (oneshot-ish)
    const t = Math.min(1, Math.max(0, td));
    base.ampAttack = 0.02 + (1 - t) * 0.35;
    base.ampDecay = 0.15 + (1 - t) * 0.4;
    base.ampSustain = 0.15 + (1 - t) * 0.6;
    base.ampRelease = 0.2 + (1 - t) * 0.45;
    base.filterAttack = base.ampAttack;
    base.filterDecay = base.ampDecay;
    base.filterSustain = Math.min(1, base.ampSustain + 0.1);
    base.filterRelease = base.ampRelease;
  }

  return clampNorm(base);
}
