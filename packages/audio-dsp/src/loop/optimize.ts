import { DSP_THRESHOLDS } from "../config/thresholds.js";
import { snapToRisingZeroCrossing } from "../detect/descriptors.js";

export type LoopPoints = {
  loopStartSample: number;
  loopEndSample: number;
  xfadeMs: number;
  loopScore: number;
};

/**
 * Normalized autocorrelation loop search + spectral edge similarity (spec §6.5).
 * Bounds snap to rising zero-crossings (start inclusive / end exclusive).
 * Non-destructive: returns points only.
 */
export function optimizeLoop(
  samples: Float32Array,
  sampleRate: number,
): LoopPoints | null {
  const n = samples.length;
  if (n < sampleRate * 0.5) return null;

  const attackSkip = Math.floor(n * 0.1);
  const endSkip = Math.floor(n * 0.1);
  const stable = samples.subarray(attackSkip, n - endSkip);
  if (stable.length < sampleRate * 0.25) return null;

  const minPeriod = Math.floor(
    (DSP_THRESHOLDS.loop.minPeriodMs / 1000) * sampleRate,
  );
  const maxPeriod = Math.floor(stable.length / 2);
  let bestPeriod = minPeriod;
  let bestCorr = -1;

  for (let p = minPeriod; p < maxPeriod; p += Math.max(1, (p / 64) | 0)) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const len = stable.length - p;
    for (let i = 0; i < len; i++) {
      const a = stable[i] ?? 0;
      const b = stable[i + p] ?? 0;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const corr = num / (Math.sqrt(denA * denB) + 1e-12);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestPeriod = p;
    }
  }

  // Start: prev < 0, sample > 0. End exclusive: same rising edge (last included < 0).
  const start = snapToRisingZeroCrossing(samples, attackSkip, 256);
  let end = snapToRisingZeroCrossing(samples, start + bestPeriod, 256);
  if (end <= start) end = Math.min(n - 1, start + bestPeriod);

  const xfadeMs = Math.min(
    DSP_THRESHOLDS.loop.xfadeMaxMs,
    Math.max(
      DSP_THRESHOLDS.loop.xfadeMinMs,
      (bestPeriod / sampleRate) * 1000 * 0.1,
    ),
  );
  const loopScore = Math.max(0, Math.min(1, (bestCorr + 1) / 2));

  return {
    loopStartSample: start,
    loopEndSample: end,
    xfadeMs,
    loopScore,
  };
}
