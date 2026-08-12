/** HT-Demucs ONNX segment constants (StemSplit / demucs-onnx browser). */
export const DEMUCS_SAMPLE_RATE = 44_100;
/** Fixed graph length ≈ 7.8 s @ 44.1 kHz. */
export const DEMUCS_N_SAMPLES = Math.round(7.8 * DEMUCS_SAMPLE_RATE); // 343_980
export const DEMUCS_OVERLAP = Math.floor(DEMUCS_N_SAMPLES / 4);
export const DEMUCS_STRIDE = DEMUCS_N_SAMPLES - DEMUCS_OVERLAP;

export const DEMUCS_STEMS = ["drums", "bass", "other", "vocals"] as const;
export type DemucsStemName = (typeof DEMUCS_STEMS)[number];

export const STEM_TAG_PREFIX = "stem:";
export const ML_DEMUCS_TAG = "ml:demucs";

export function stemTag(name: DemucsStemName): string {
  return `${STEM_TAG_PREFIX}${name}`;
}

/** Triangular fade at overlap edges (demucs-onnx browser demo). */
export function makeTransitionWindow(
  seg: number,
  overlap: number,
): Float32Array {
  const w = new Float32Array(seg).fill(1);
  const o = Math.min(overlap, Math.floor(seg / 2));
  for (let i = 0; i < o; i++) {
    const t = i / o;
    w[i] = t;
    w[seg - 1 - i] = t;
  }
  return w;
}

/**
 * Pack stereo channels into ORT layout (1, 2, N) flat: [L…, R…].
 */
export function packStereoChunk(
  left: Float32Array,
  right: Float32Array,
  start: number,
  end: number,
  nSamples: number,
  out: Float32Array,
): void {
  out.fill(0);
  const clen = end - start;
  out.subarray(0, clen).set(left.subarray(start, end));
  out.subarray(nSamples, nSamples + clen).set(right.subarray(start, end));
}

/**
 * Read one stem row from flat `(1, 4, 2, N)` output into L/R with window weight.
 * Layout: stem-major, then channel, then sample.
 */
export function accumulateStemFromFlat(
  stemsFlat: Float32Array,
  stemRow: number,
  nSamples: number,
  clen: number,
  window: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  weight: Float32Array,
  destStart: number,
): void {
  const rowBase = stemRow * 2 * nSamples;
  for (let s = 0; s < clen; s++) {
    const w = window[s] ?? 1;
    const i = destStart + s;
    outL[i]! += (stemsFlat[rowBase + s] ?? 0) * w;
    outR[i]! += (stemsFlat[rowBase + nSamples + s] ?? 0) * w;
    weight[i]! += w;
  }
}

export function normalizeOverlap(
  left: Float32Array,
  right: Float32Array,
  weight: Float32Array,
): void {
  for (let i = 0; i < left.length; i++) {
    const w = Math.max(weight[i] ?? 0, 1e-8);
    left[i]! /= w;
    right[i]! /= w;
  }
}

/** Mono mid from stereo. */
export function stereoToMono(left: Float32Array, right: Float32Array): Float32Array {
  const n = Math.min(left.length, right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = ((left[i] ?? 0) + (right[i] ?? 0)) * 0.5;
  }
  return out;
}

/** Duplicate mono to stereo channels (Demucs expects stereo). */
export function monoToStereo(mono: Float32Array): [Float32Array, Float32Array] {
  return [mono.slice(), mono.slice()];
}
