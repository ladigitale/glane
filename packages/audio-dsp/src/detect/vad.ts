import { DSP_THRESHOLDS } from "../config/thresholds.js";

/**
 * Lightweight heuristic VAD (T1) — Silero ONNX comes in T2 enrichment.
 */
export function estimateVadPositive(agg: {
  meanZcr?: number;
  meanFlatness: number;
  harmonicity: number;
  meanFlux: number;
  meanRms: number;
  durationMs: number;
  noiseFloorRms?: number;
}): boolean {
  const zcr = agg.meanZcr ?? 0.1;
  const aboveFloor =
    agg.noiseFloorRms == null || agg.meanRms > agg.noiseFloorRms * 2.5;
  if (!aboveFloor) return false;
  if (agg.durationMs < 120 || agg.durationMs > 12_000) return false;
  if (agg.meanFlux > 0.12) return false;
  if (agg.meanFlatness > 0.75) return false;

  const zcrOk = zcr > 0.02 && zcr < 0.25;
  const harmOk = agg.harmonicity > 0.25 && agg.harmonicity < 0.85;
  const flatOk = agg.meanFlatness > 0.15 && agg.meanFlatness < 0.65;
  const score =
    (zcrOk ? 1 : 0) + (harmOk ? 1 : 0) + (flatOk ? 1 : 0) + (aboveFloor ? 1 : 0);
  return score >= DSP_THRESHOLDS.vad.minScore;
}
