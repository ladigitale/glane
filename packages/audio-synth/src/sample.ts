import {
  DEFAULT_ADDITIVE_NORM,
  DEFAULT_FM_NORM,
  DEFAULT_GRANULAR_NORM,
  DEFAULT_NOISE_NORM,
  DEFAULT_PHYSICAL_NORM,
  DEFAULT_SUBTRACTIVE_NORM,
  DEFAULT_VOICE_NORM,
  ADDITIVE_KEYS,
  FM_KEYS,
  GRANULAR_KEYS,
  NOISE_KEYS,
  PHYSICAL_KEYS,
  SUBTRACTIVE_KEYS,
  VOICE_KEYS,
  type AdditiveKey,
  type AdditiveNorm,
  type AdditiveRanges,
  type FmKey,
  type FmNorm,
  type FmRanges,
  type GranularKey,
  type GranularNorm,
  type GranularRanges,
  type NoiseKey,
  type NoiseNorm,
  type NoiseRanges,
  type Norm01,
  type ParamRange,
  type PhysicalKey,
  type PhysicalNorm,
  type PhysicalRanges,
  type RangeMode,
  type SubtractiveKey,
  type SubtractiveNorm,
  type SubtractiveRanges,
  type VoiceKey,
  type VoiceNorm,
  type VoiceRanges,
} from "./types.js";

function clamp01(n: number): Norm01 {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Deterministic PRNG (same as app generative mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample inside [min,max].
 * - add: linear uniform
 * - mul: log-uniform (useful for freqs / times in 0–1 space)
 */
export function sampleInRange(
  min: Norm01,
  max: Norm01,
  mode: RangeMode,
  rnd: () => number,
): Norm01 {
  const lo = clamp01(Math.min(min, max));
  const hi = clamp01(Math.max(min, max));
  if (hi - lo < 1e-9) return lo;
  const u = rnd();
  if (mode === "mul") {
    const a = Math.max(1e-4, lo);
    const b = Math.max(a + 1e-6, hi);
    return clamp01(Math.exp(Math.log(a) + u * (Math.log(b) - Math.log(a))));
  }
  return clamp01(lo + u * (hi - lo));
}

/** Symmetric span around pivot; randomness 0 = point, 1 = full [0,1] width. */
export function expandSymmetric(
  pivot: Norm01,
  randomness: Norm01,
  fullSpan = 1,
): { min: Norm01; max: Norm01 } {
  const p = clamp01(pivot);
  const r = clamp01(randomness);
  const half = (r * fullSpan) / 2;
  return {
    min: clamp01(p - half),
    max: clamp01(p + half),
  };
}

function defaultModeForKey(key: string): RangeMode {
  if (
    key === "fund" ||
    key === "carrier" ||
    key === "cutoff" ||
    key === "lp" ||
    key === "hp" ||
    key === "ratio" ||
    key === "duration" ||
    key.endsWith("Attack") ||
    key.endsWith("Decay") ||
    key.endsWith("Release")
  ) {
    return "mul";
  }
  return "add";
}

function rangesFromPivotGeneric<K extends string>(
  pivot: Record<K, Norm01>,
  keys: readonly K[],
  randomness: Norm01,
  modes?: Partial<Record<K, RangeMode>>,
): Record<K, ParamRange> {
  const out = {} as Record<K, ParamRange>;
  for (const key of keys) {
    const { min, max } = expandSymmetric(pivot[key], randomness);
    out[key] = {
      min,
      max,
      mode: modes?.[key] ?? defaultModeForKey(key),
    };
  }
  return out;
}

function sampleGeneric<K extends string>(
  ranges: Record<K, ParamRange>,
  keys: readonly K[],
  rnd: () => number,
): Record<K, Norm01> {
  const n = {} as Record<K, Norm01>;
  for (const key of keys) {
    const r = ranges[key];
    n[key] = sampleInRange(r.min, r.max, r.mode, rnd);
  }
  return n;
}

export function rangesFromPivot(
  pivot: SubtractiveNorm,
  randomness: Norm01,
  modes?: Partial<Record<SubtractiveKey, RangeMode>>,
): SubtractiveRanges {
  return rangesFromPivotGeneric(
    pivot,
    SUBTRACTIVE_KEYS,
    randomness,
    modes,
  ) as SubtractiveRanges;
}

export function sampleSubtractive(
  ranges: SubtractiveRanges,
  rnd: () => number,
): SubtractiveNorm {
  return sampleGeneric(ranges, SUBTRACTIVE_KEYS, rnd) as SubtractiveNorm;
}

export function defaultRangesAround(
  pivot: SubtractiveNorm = DEFAULT_SUBTRACTIVE_NORM,
  randomness = 0.35,
): SubtractiveRanges {
  return rangesFromPivot(pivot, randomness);
}

export function rangesFromFmPivot(
  pivot: FmNorm,
  randomness: Norm01,
  modes?: Partial<Record<FmKey, RangeMode>>,
): FmRanges {
  return rangesFromPivotGeneric(pivot, FM_KEYS, randomness, modes) as FmRanges;
}

export function sampleFm(ranges: FmRanges, rnd: () => number): FmNorm {
  return sampleGeneric(ranges, FM_KEYS, rnd) as FmNorm;
}

export function defaultFmRangesAround(
  pivot: FmNorm = DEFAULT_FM_NORM,
  randomness = 0.35,
): FmRanges {
  return rangesFromFmPivot(pivot, randomness);
}

export function rangesFromNoisePivot(
  pivot: NoiseNorm,
  randomness: Norm01,
  modes?: Partial<Record<NoiseKey, RangeMode>>,
): NoiseRanges {
  return rangesFromPivotGeneric(
    pivot,
    NOISE_KEYS,
    randomness,
    modes,
  ) as NoiseRanges;
}

export function sampleNoise(ranges: NoiseRanges, rnd: () => number): NoiseNorm {
  return sampleGeneric(ranges, NOISE_KEYS, rnd) as NoiseNorm;
}

export function defaultNoiseRangesAround(
  pivot: NoiseNorm = DEFAULT_NOISE_NORM,
  randomness = 0.35,
): NoiseRanges {
  return rangesFromNoisePivot(pivot, randomness);
}

export function rangesFromGranularPivot(
  pivot: GranularNorm,
  randomness: Norm01,
  modes?: Partial<Record<GranularKey, RangeMode>>,
): GranularRanges {
  return rangesFromPivotGeneric(
    pivot,
    GRANULAR_KEYS,
    randomness,
    modes,
  ) as GranularRanges;
}
export function sampleGranular(
  ranges: GranularRanges,
  rnd: () => number,
): GranularNorm {
  return sampleGeneric(ranges, GRANULAR_KEYS, rnd) as GranularNorm;
}
export function defaultGranularRangesAround(
  pivot: GranularNorm = DEFAULT_GRANULAR_NORM,
  randomness = 0.35,
): GranularRanges {
  return rangesFromGranularPivot(pivot, randomness);
}

export function rangesFromAdditivePivot(
  pivot: AdditiveNorm,
  randomness: Norm01,
  modes?: Partial<Record<AdditiveKey, RangeMode>>,
): AdditiveRanges {
  return rangesFromPivotGeneric(
    pivot,
    ADDITIVE_KEYS,
    randomness,
    modes,
  ) as AdditiveRanges;
}
export function sampleAdditive(
  ranges: AdditiveRanges,
  rnd: () => number,
): AdditiveNorm {
  return sampleGeneric(ranges, ADDITIVE_KEYS, rnd) as AdditiveNorm;
}
export function defaultAdditiveRangesAround(
  pivot: AdditiveNorm = DEFAULT_ADDITIVE_NORM,
  randomness = 0.35,
): AdditiveRanges {
  return rangesFromAdditivePivot(pivot, randomness);
}

export function rangesFromPhysicalPivot(
  pivot: PhysicalNorm,
  randomness: Norm01,
  modes?: Partial<Record<PhysicalKey, RangeMode>>,
): PhysicalRanges {
  return rangesFromPivotGeneric(
    pivot,
    PHYSICAL_KEYS,
    randomness,
    modes,
  ) as PhysicalRanges;
}
export function samplePhysical(
  ranges: PhysicalRanges,
  rnd: () => number,
): PhysicalNorm {
  return sampleGeneric(ranges, PHYSICAL_KEYS, rnd) as PhysicalNorm;
}
export function defaultPhysicalRangesAround(
  pivot: PhysicalNorm = DEFAULT_PHYSICAL_NORM,
  randomness = 0.35,
): PhysicalRanges {
  return rangesFromPhysicalPivot(pivot, randomness);
}

export function rangesFromVoicePivot(
  pivot: VoiceNorm,
  randomness: Norm01,
  modes?: Partial<Record<VoiceKey, RangeMode>>,
): VoiceRanges {
  return rangesFromPivotGeneric(
    pivot,
    VOICE_KEYS,
    randomness,
    modes,
  ) as VoiceRanges;
}
export function sampleVoice(ranges: VoiceRanges, rnd: () => number): VoiceNorm {
  return sampleGeneric(ranges, VOICE_KEYS, rnd) as VoiceNorm;
}
export function defaultVoiceRangesAround(
  pivot: VoiceNorm = DEFAULT_VOICE_NORM,
  randomness = 0.35,
): VoiceRanges {
  return rangesFromVoicePivot(pivot, randomness);
}

export function rangeFromValues(
  min: Norm01,
  max: Norm01,
  mode: RangeMode = "add",
): ParamRange {
  return { min: clamp01(min), max: clamp01(max), mode };
}
