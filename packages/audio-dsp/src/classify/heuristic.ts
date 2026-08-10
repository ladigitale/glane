import type { ClassScores, SampleClass } from "@glane/core-model";
import type { FrameDescriptors } from "../detect/descriptors.js";
import { DSP_THRESHOLDS } from "../config/thresholds.js";

export type ClassificationResult = {
  dominant: SampleClass;
  confidence: number;
  scores: ClassScores;
};

/**
 * Heuristic scores from aggregated descriptors (ADR-0006).
 */
export function classifyFromDescriptors(
  agg: {
    meanFlux: number;
    meanFlatness: number;
    meanRms: number;
    attackMs: number;
    harmonicity: number;
    periodicity: number;
    vadPositive: boolean;
    durationMs: number;
  },
): ClassificationResult {
  const scores: ClassScores = {
    percussive: 0,
    tonal: 0,
    texture: 0,
    noise: 0,
    rhythmic: 0,
    voice: 0,
    unclassified: 0.1,
  };

  if (agg.vadPositive) scores.voice = 0.9;

  if (
    agg.meanFlux > 0.05 &&
    agg.attackMs < DSP_THRESHOLDS.percussive.attackMaxMs &&
    agg.harmonicity < 0.4
  ) {
    scores.percussive = 0.7 + Math.min(0.25, agg.meanFlux);
  }
  if (agg.harmonicity > 0.55 && agg.meanFlatness < 0.4) {
    scores.tonal = 0.65 + Math.min(0.3, agg.harmonicity - 0.55);
  }
  if (agg.meanFlux < 0.02 && agg.durationMs > 2500) {
    scores.texture = 0.6;
  }
  if (agg.meanFlatness > 0.6 && agg.durationMs > 1500) {
    scores.noise = 0.65;
  }
  if (agg.periodicity > 0.5 && agg.durationMs > 1500) {
    scores.rhythmic = 0.7;
  }

  let dominant: SampleClass = "unclassified";
  let best = -1;
  for (const [k, v] of Object.entries(scores) as [SampleClass, number][]) {
    if (v > best) {
      best = v;
      dominant = k;
    }
  }
  const confidence = Math.min(1, Math.max(0, best));
  return { dominant, confidence, scores };
}

export function durationAllowed(
  cls: SampleClass,
  durationMs: number,
): boolean {
  const range = DSP_THRESHOLDS.durationMs[cls];
  return durationMs >= range.min && durationMs <= range.max;
}
