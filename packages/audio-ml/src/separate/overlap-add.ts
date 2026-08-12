import {
  DEMUCS_N_SAMPLES,
  DEMUCS_OVERLAP,
  DEMUCS_STEMS,
  DEMUCS_STRIDE,
  accumulateStemFromFlat,
  makeTransitionWindow,
  normalizeOverlap,
  packStereoChunk,
  type DemucsStemName,
} from "./demucs-math.js";

export type StemPair = { left: Float32Array; right: Float32Array };

export type SeparateProgress = {
  chunk: number;
  chunks: number;
  /** 0–1 */
  ratio: number;
};

/**
 * Infer one fixed chunk. `mixFlat` is (1,2,N) packed [L…|R…].
 * Returns flat `(1,4,2,N)` stems tensor data.
 */
export type DemucsChunkInfer = (mixFlat: Float32Array) => Promise<Float32Array>;

/**
 * Chunked overlap-add separation (all 4 stems). Pure aside from `infer`.
 */
export async function separateOverlapAdd(
  left: Float32Array,
  right: Float32Array,
  infer: DemucsChunkInfer,
  opts?: {
    onProgress?: (p: SeparateProgress) => void;
    stems?: readonly DemucsStemName[];
  },
): Promise<Record<DemucsStemName, StemPair>> {
  const total = Math.min(left.length, right.length);
  const stemNames = opts?.stems ?? DEMUCS_STEMS;
  const nChunks = Math.max(1, Math.ceil(total / DEMUCS_STRIDE));
  const window = makeTransitionWindow(DEMUCS_N_SAMPLES, DEMUCS_OVERLAP);
  const chunkBuf = new Float32Array(2 * DEMUCS_N_SAMPLES);

  const outs: Record<string, StemPair & { weight: Float32Array }> = {};
  for (const name of stemNames) {
    outs[name] = {
      left: new Float32Array(total),
      right: new Float32Array(total),
      weight: new Float32Array(total),
    };
  }

  for (let i = 0; i < nChunks; i++) {
    const start = i * DEMUCS_STRIDE;
    const end = Math.min(start + DEMUCS_N_SAMPLES, total);
    packStereoChunk(left, right, start, end, DEMUCS_N_SAMPLES, chunkBuf);
    const stemsFlat = await infer(chunkBuf);
    const clen = end - start;

    for (const name of stemNames) {
      const row = DEMUCS_STEMS.indexOf(name);
      const bucket = outs[name]!;
      accumulateStemFromFlat(
        stemsFlat,
        row,
        DEMUCS_N_SAMPLES,
        clen,
        window,
        bucket.left,
        bucket.right,
        bucket.weight,
        start,
      );
    }

    opts?.onProgress?.({
      chunk: i + 1,
      chunks: nChunks,
      ratio: (i + 1) / nChunks,
    });
  }

  const result = {} as Record<DemucsStemName, StemPair>;
  for (const name of stemNames) {
    const bucket = outs[name]!;
    normalizeOverlap(bucket.left, bucket.right, bucket.weight);
    result[name] = { left: bucket.left, right: bucket.right };
  }
  return result;
}
