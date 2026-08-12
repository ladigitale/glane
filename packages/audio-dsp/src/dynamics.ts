/** Offline dynamics for the mono editor (gate / soft compress). */

export type NoiseGateParams = {
  /** Open above this level (dBFS). Typical field: −40…−24. */
  thresholdDb: number;
  /** Time to open once above threshold (ms). */
  attackMs: number;
  /** Time to close once below threshold (ms) — “decay”. */
  releaseMs: number;
  /** Linear gain when fully closed (0 = mute). */
  floor?: number;
};

export type SoftCompressParams = {
  /** Compress above this level (dBFS). */
  thresholdDb: number;
  /** Ratio above threshold (≥ 1). */
  ratio: number;
  attackMs: number;
  releaseMs: number;
  /** Soft knee width in dB (0 = hard). */
  kneeDb?: number;
  /** Makeup gain in dB after compression. */
  makeupDb?: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function msToCoef(ms: number, sampleRate: number): number {
  const t = Math.max(0.05, ms) / 1000;
  return Math.exp(-1 / (t * sampleRate));
}

/**
 * Noise gate: envelope follower + smooth open/close around `thresholdDb`.
 * Returns a new buffer (same length).
 */
export function noiseGate(
  input: Float32Array,
  sampleRate: number,
  params: NoiseGateParams,
): Float32Array {
  const out = new Float32Array(input.length);
  if (input.length === 0 || sampleRate <= 0) return out;

  const thr = Math.pow(10, clamp(params.thresholdDb, -96, 0) / 20);
  const floor = clamp(params.floor ?? 0, 0, 1);
  const atk = msToCoef(params.attackMs, sampleRate);
  const rel = msToCoef(params.releaseMs, sampleRate);

  let env = 0;
  let gain = floor;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] ?? 0;
    const a = Math.abs(x);
    env = a > env ? a + (env - a) * atk : a + (env - a) * rel;
    const target = env >= thr ? 1 : floor;
    const coef = target > gain ? atk : rel;
    gain = target + (gain - target) * coef;
    out[i] = x * gain;
  }
  return out;
}

/**
 * Soft-knee compressor (mono, sample-by-sample envelope).
 * Returns a new buffer (same length).
 */
export function softCompress(
  input: Float32Array,
  sampleRate: number,
  params: SoftCompressParams,
): Float32Array {
  const out = new Float32Array(input.length);
  if (input.length === 0 || sampleRate <= 0) return out;

  const thrDb = clamp(params.thresholdDb, -96, 0);
  const ratio = Math.max(1, params.ratio);
  const knee = Math.max(0, params.kneeDb ?? 6);
  const makeup = Math.pow(10, (params.makeupDb ?? 0) / 20);
  const atk = msToCoef(params.attackMs, sampleRate);
  const rel = msToCoef(params.releaseMs, sampleRate);

  let envDb = -96;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] ?? 0;
    const levelDb = 20 * Math.log10(Math.max(1e-9, Math.abs(x)));
    envDb =
      levelDb > envDb
        ? levelDb + (envDb - levelDb) * atk
        : levelDb + (envDb - levelDb) * rel;

    let grDb = 0;
    if (knee > 0 && envDb > thrDb - knee / 2 && envDb < thrDb + knee / 2) {
      const xk = envDb - thrDb + knee / 2;
      grDb = ((1 / ratio - 1) * (xk * xk)) / (2 * knee);
    } else if (envDb > thrDb + knee / 2) {
      grDb = (thrDb - envDb) * (1 - 1 / ratio);
    }

    out[i] = x * Math.pow(10, grDb / 20) * makeup;
  }
  return out;
}
