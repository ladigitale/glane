/** Auto-tune attack sensitivity toward a target capture density (events / min). */

export const CAPTURE_RATE = {
  minPerMin: 2,
  maxPerMin: 60,
  /** Default field density: one event every ~5 s. */
  defaultPerMin: 12,
  windowMs: 60_000,
  warmupMs: 12_000,
  adjustEveryMs: 2_500,
  deadbandPerMin: 0.8,
  /** Sensitivity points (0–100) per (events/min) of error. */
  gain: 1.6,
  maxStep: 6,
} as const;

export function clampTargetPerMin(n: number): number {
  if (!Number.isFinite(n)) return CAPTURE_RATE.defaultPerMin;
  return Math.min(
    CAPTURE_RATE.maxPerMin,
    Math.max(CAPTURE_RATE.minPerMin, Math.round(n)),
  );
}

export function pruneCaptureTimes(
  timestamps: number[],
  nowMs: number,
): number[] {
  const cutoff = nowMs - CAPTURE_RATE.windowMs;
  return timestamps.filter((t) => t >= cutoff);
}

/** Observed capture rate over the rolling window (or session so far if shorter). */
export function observedRatePerMin(
  timestamps: number[],
  nowMs: number,
  startedAtMs: number,
): number {
  const elapsed = Math.max(1, nowMs - startedAtMs);
  const windowMs = Math.min(CAPTURE_RATE.windowMs, elapsed);
  const cutoff = nowMs - windowMs;
  let n = 0;
  for (const t of timestamps) {
    if (t >= cutoff) n += 1;
  }
  return (n * 60_000) / windowMs;
}

export type RateAdjustInput = {
  sensitivity: number;
  targetPerMin: number;
  timestamps: number[];
  nowMs: number;
  startedAtMs: number;
  lastAdjustMs: number;
};

export type RateAdjustResult = {
  sensitivity: number;
  ratePerMin: number;
  adjusted: boolean;
  lastAdjustMs: number;
};

/**
 * Proportional control: too few captures → raise sensitivity;
 * too many → lower it. Warm-up and deadband avoid thrashing.
 */
export function nextSensitivity(input: RateAdjustInput): RateAdjustResult {
  const ratePerMin = observedRatePerMin(
    input.timestamps,
    input.nowMs,
    input.startedAtMs,
  );
  const base = {
    sensitivity: input.sensitivity,
    ratePerMin,
    adjusted: false,
    lastAdjustMs: input.lastAdjustMs,
  };
  if (input.nowMs - input.startedAtMs < CAPTURE_RATE.warmupMs) return base;
  if (input.nowMs - input.lastAdjustMs < CAPTURE_RATE.adjustEveryMs) return base;

  const err = input.targetPerMin - ratePerMin;
  if (Math.abs(err) < CAPTURE_RATE.deadbandPerMin) {
    return { ...base, lastAdjustMs: input.nowMs };
  }

  const rawStep = err * CAPTURE_RATE.gain;
  const step = Math.max(
    -CAPTURE_RATE.maxStep,
    Math.min(CAPTURE_RATE.maxStep, rawStep),
  );
  const sensitivity = Math.max(0, Math.min(100, input.sensitivity + step));
  return {
    sensitivity,
    ratePerMin,
    adjusted: sensitivity !== input.sensitivity,
    lastAdjustMs: input.nowMs,
  };
}
