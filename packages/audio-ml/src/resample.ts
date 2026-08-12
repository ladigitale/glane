/**
 * Linear resample mono PCM to a target rate (YAMNet expects 16 kHz).
 */
export function resampleLinear(
  pcm: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm.slice();
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error(`invalid sample rate ${fromRate}→${toRate}`);
  }
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(pcm.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const t = src - i0;
    const a = pcm[i0] ?? 0;
    const b = pcm[i1] ?? a;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** Take center window of `durationSec` (or full buffer if shorter). */
export function centerWindow(
  pcm: Float32Array,
  sampleRate: number,
  durationSec: number,
): Float32Array {
  const want = Math.min(pcm.length, Math.round(durationSec * sampleRate));
  if (want >= pcm.length) return pcm;
  const start = Math.floor((pcm.length - want) / 2);
  return pcm.subarray(start, start + want);
}
