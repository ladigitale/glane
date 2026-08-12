import { DSP_THRESHOLDS } from "../config/thresholds.js";
import { snapToRisingZeroCrossing } from "../detect/descriptors.js";

export type LoopPoints = {
  loopStartSample: number;
  loopEndSample: number;
  xfadeMs: number;
  loopScore: number;
  /** Detected fundamental period in samples (before N× fit). */
  periodSamples: number;
  /** How many periods were kept (1, 2, 4…). */
  periodCount: number;
};

/** Frame RMS envelope for silence trim + cheap periodicity. */
function rmsEnvelope(
  samples: Float32Array,
  hop: number,
): Float32Array {
  const n = Math.max(1, Math.floor(samples.length / hop));
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop;
    const b = Math.min(samples.length, a + hop);
    let s = 0;
    for (let i = a; i < b; i++) {
      const v = samples[i] ?? 0;
      s += v * v;
    }
    env[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  return env;
}

/** Last frame index still above silence (trailing quiet discarded). */
function activeEndFrame(env: Float32Array, floor: number): number {
  for (let i = env.length - 1; i >= 0; i--) {
    if ((env[i] ?? 0) > floor) return i;
  }
  return Math.max(0, env.length - 1);
}

/** First frame above silence. */
function activeStartFrame(env: Float32Array, floor: number): number {
  for (let i = 0; i < env.length; i++) {
    if ((env[i] ?? 0) > floor) return i;
  }
  return 0;
}

/**
 * Normalized autocorr best lag on a 1-D series (envelope or downsampled PCM).
 * Returns lag in series units + correlation in [-1, 1].
 */
function bestAutocorrLag(
  series: Float32Array,
  minLag: number,
  maxLag: number,
): { lag: number; corr: number } {
  let bestLag = minLag;
  let bestCorr = -1;
  const maxL = Math.min(maxLag, Math.floor(series.length / 2) - 1);
  if (maxL <= minLag) return { lag: minLag, corr: -1 };

  for (let p = minLag; p <= maxL; p += Math.max(1, (p / 48) | 0)) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const len = series.length - p;
    for (let i = 0; i < len; i++) {
      const a = series[i] ?? 0;
      const b = series[i + p] ?? 0;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const corr = num / (Math.sqrt(denA * denB) + 1e-12);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = p;
    }
  }
  return { lag: bestLag, corr: bestCorr };
}

/** Score a candidate period (samples) against the active PCM slice. */
function periodCorr(pcm: Float32Array, period: number): number {
  if (period < 8 || period * 2 > pcm.length) return -1;
  let num = 0;
  let denA = 0;
  let denB = 0;
  const len = Math.min(pcm.length - period, period * 4);
  for (let i = 0; i < len; i++) {
    const a = pcm[i] ?? 0;
    const b = pcm[i + period] ?? 0;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  return num / (Math.sqrt(denA * denB) + 1e-12);
}

/**
 * Downbeat-ish peaks on the envelope, refractory ≈ 60% of period.
 * Used so a last hit mid-bar still claims a full period after it.
 */
function envelopePeaks(
  env: Float32Array,
  aFrame: number,
  bFrame: number,
  periodFrames: number,
  floor: number,
): number[] {
  const peaks: number[] = [];
  const thr = floor * 2.5;
  const refractory = Math.max(2, Math.floor(periodFrames * 0.6));
  let i = aFrame;
  while (i <= bFrame) {
    const v = env[i] ?? 0;
    const prev = env[i - 1] ?? 0;
    const next = env[i + 1] ?? 0;
    if (v >= thr && v >= prev && v >= next) {
      peaks.push(i);
      i += refractory;
      continue;
    }
    i++;
  }
  return peaks;
}

/**
 * Prefer musically square lengths: 1, 2, 4, 8… periods.
 * `exact` may include a fractional period (e.g. 3.7); we round up into
 * trailing silence when within slack and the buffer has room.
 */
function fitPeriodCount(
  exact: number,
  maxN: number,
): number {
  const floorN = Math.max(1, Math.floor(exact + 1e-6));
  const musical = [1, 2, 3, 4, 6, 8, 12, 16];
  const slack = DSP_THRESHOLDS.loop.squareSlack;
  const cap = Math.max(1, maxN);

  let chosen = 0;
  for (const n of musical) {
    if (n > cap) break;
    if (n >= floorN && n <= exact + slack) chosen = n;
  }
  if (chosen > 0) return chosen;

  let best = Math.min(floorN, cap);
  for (const n of musical) {
    if (n <= Math.min(floorN, cap)) best = n;
  }
  return Math.max(1, best);
}

/**
 * Normalized autocorrelation loop search + trailing-silence trim +
 * integer-period (“square”) fit. Non-destructive: returns points only.
 */
export function optimizeLoop(
  samples: Float32Array,
  sampleRate: number,
): LoopPoints | null {
  const n = samples.length;
  const minMs = DSP_THRESHOLDS.loop.minPeriodMs;
  if (n < sampleRate * (minMs / 1000) * 2) return null;

  const hop = Math.max(64, Math.floor(sampleRate * 0.01)); // ~10 ms
  const env = rmsEnvelope(samples, hop);
  const peak = env.reduce((m, v) => (v > m ? v : m), 0);
  if (peak < 1e-6) return null;
  const floor = peak * DSP_THRESHOLDS.loop.silenceRelPeak;

  const aFrame = activeStartFrame(env, floor);
  const bFrame = activeEndFrame(env, floor);
  if (bFrame <= aFrame + 2) return null;

  const activeStart = aFrame * hop;
  const activeEnd = Math.min(n, (bFrame + 1) * hop);
  const active = samples.subarray(activeStart, activeEnd);
  if (active.length < sampleRate * (minMs / 1000) * 1.5) return null;

  // Envelope autocorr → tempo/period (cheap, ignores quiet tails).
  const minLagEnv = Math.max(
    2,
    Math.floor(((minMs / 1000) * sampleRate) / hop),
  );
  const maxLagEnv = Math.floor(env.length / 2);
  const { lag: envLag, corr: envCorr } = bestAutocorrLag(
    env.subarray(aFrame, bFrame + 1),
    minLagEnv,
    maxLagEnv,
  );
  const period = Math.max(
    Math.floor((minMs / 1000) * sampleRate),
    Math.round(envLag * hop),
  );

  // Refine on PCM around envelope period (±8%) and half/double (bar vs beat).
  const candidates = [
    period,
    Math.round(period * 0.5),
    Math.round(period * 2),
    Math.round(period * 0.92),
    Math.round(period * 1.08),
  ].filter(
    (p) =>
      p >= Math.floor((minMs / 1000) * sampleRate) && p * 2 <= active.length,
  );

  let bestPeriod = period;
  let bestCorr = periodCorr(active, period);
  for (const p of candidates) {
    const c = periodCorr(active, p);
    if (c > bestCorr) {
      bestCorr = c;
      bestPeriod = p;
    }
  }

  // Blend envelope + PCM confidence — both must look periodic.
  if (bestCorr < 0.35 || envCorr < 0.25) return null;
  const loopScore = Math.max(
    0,
    Math.min(1, ((bestCorr + 1) / 2) * 0.65 + ((envCorr + 1) / 2) * 0.35),
  );
  if (loopScore < DSP_THRESHOLDS.loop.minScore) return null;

  const periodFrames = Math.max(2, Math.round(bestPeriod / hop));
  const peaks = envelopePeaks(env, aFrame, bFrame, periodFrames, floor);
  const maxN = Math.max(1, Math.floor((n - activeStart) / bestPeriod));

  // Peaks: last downbeat still owns a full period (square bar even if quiet).
  // Else: energy length / period (continuous textures).
  let exact: number;
  if (peaks.length >= 2) {
    const span = (peaks[peaks.length - 1]! - peaks[0]!) * hop;
    exact = span / bestPeriod + 1;
  } else {
    exact = active.length / bestPeriod;
  }

  const count = fitPeriodCount(exact, maxN);
  const approxStart = activeStart;
  const approxEnd = Math.min(n, activeStart + count * bestPeriod);

  const start = snapToRisingZeroCrossing(samples, approxStart, 256);
  let end = snapToRisingZeroCrossing(
    samples,
    Math.min(n - 1, Math.max(start + bestPeriod, approxEnd)),
    256,
  );
  if (end <= start) end = Math.min(n, start + count * bestPeriod);
  end = Math.min(end, n);
  if (end - start < bestPeriod * 0.85) return null;

  const xfadeMs = Math.min(
    DSP_THRESHOLDS.loop.xfadeMaxMs,
    Math.max(
      DSP_THRESHOLDS.loop.xfadeMinMs,
      ((end - start) / sampleRate) * 1000 * 0.08,
    ),
  );

  return {
    loopStartSample: start,
    loopEndSample: end,
    xfadeMs,
    loopScore,
    periodSamples: bestPeriod,
    periodCount: count,
  };
}
