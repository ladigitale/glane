/** Multi-resolution min/max peak pyramid for waveform LOD. */
export type PeakPyramid = {
  sampleRate: number;
  levels: Float32Array[]; // interleaved min,max per bucket
  factors: number[];
};

/** Dense powers of two — enough steps so zoom never sticks on a coarse mip. */
const MIN_FACTOR = 32;
const MAX_FACTOR = 65536;

/** Ascending factors from 32 … 65536 (clamped to audio length). */
export function defaultPeakFactors(sampleCount: number): number[] {
  const lim = Math.max(MIN_FACTOR, sampleCount);
  const factors: number[] = [];
  for (let f = MIN_FACTOR; f <= MAX_FACTOR && f < lim; f *= 2) {
    factors.push(f);
  }
  if (factors.length === 0) factors.push(MIN_FACTOR);
  return factors;
}

function buildLevelFromSamples(
  samples: Float32Array,
  factor: number,
): Float32Array {
  const buckets = Math.ceil(samples.length / factor);
  const out = new Float32Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    const start = b * factor;
    const end = Math.min(start + factor, samples.length);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      const v = samples[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max < min) {
      min = 0;
      max = 0;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/** Halve a peak level when nextFactor === 2 * prevFactor. */
function reduceLevel(prev: Float32Array): Float32Array {
  const prevBuckets = prev.length / 2;
  const buckets = Math.ceil(prevBuckets / 2);
  const out = new Float32Array(buckets * 2);
  for (let b = 0; b < buckets; b++) {
    const i0 = b * 2 * 2;
    const i1 = i0 + 2;
    const min0 = prev[i0] ?? 0;
    const max0 = prev[i0 + 1] ?? 0;
    if (i1 + 1 < prev.length) {
      const min1 = prev[i1] ?? 0;
      const max1 = prev[i1 + 1] ?? 0;
      out[b * 2] = Math.min(min0, min1);
      out[b * 2 + 1] = Math.max(max0, max1);
    } else {
      out[b * 2] = min0;
      out[b * 2 + 1] = max0;
    }
  }
  return out;
}

export function buildPeakPyramid(
  samples: Float32Array,
  sampleRate: number,
  factors = defaultPeakFactors(samples.length),
): PeakPyramid {
  const sorted = [...factors].sort((a, b) => a - b);
  const levels: Float32Array[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const factor = sorted[i] ?? MIN_FACTOR;
    if (i === 0) {
      levels.push(buildLevelFromSamples(samples, factor));
      continue;
    }
    const prevFactor = sorted[i - 1] ?? factor;
    const prev = levels[i - 1];
    if (prev && factor === prevFactor * 2) {
      levels.push(reduceLevel(prev));
    } else {
      levels.push(buildLevelFromSamples(samples, factor));
    }
  }
  return { sampleRate, levels, factors: sorted };
}

/**
 * Largest pyramid level whose bucket ≤ samplesPerPixel.
 * `-1` → no level fine enough; caller should scan PCM for the viewport.
 */
export function pickPeakLevelIndex(
  pyramid: PeakPyramid,
  samplesPerPixel: number,
): number {
  let best = -1;
  for (let i = 0; i < pyramid.factors.length; i++) {
    const f = pyramid.factors[i] ?? Infinity;
    if (f <= samplesPerPixel) best = i;
    else break;
  }
  return best;
}
