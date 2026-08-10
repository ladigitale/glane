/**
 * Post-session analysis (T2) — runs off the capture path.
 */
export type T2Progress = { done: number; total: number; cancelled: boolean };

export async function runT2Analysis(
  samples: Float32Array[],
  onProgress?: (p: T2Progress) => void,
  signal?: AbortSignal,
): Promise<
  Array<{
    lufsApprox: number;
    peak: number;
    centroidApprox: number;
  }>
> {
  const out: Array<{
    lufsApprox: number;
    peak: number;
    centroidApprox: number;
  }> = [];
  for (let i = 0; i < samples.length; i++) {
    if (signal?.aborted) {
      onProgress?.({ done: i, total: samples.length, cancelled: true });
      break;
    }
    const s = samples[i] ?? new Float32Array(0);
    let sumSq = 0;
    let peak = 0;
    for (let j = 0; j < s.length; j++) {
      const v = s[j] ?? 0;
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, s.length));
    out.push({
      lufsApprox: -0.691 + 10 * Math.log10(rms * rms + 1e-12),
      peak,
      centroidApprox: 0,
    });
    onProgress?.({ done: i + 1, total: samples.length, cancelled: false });
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
