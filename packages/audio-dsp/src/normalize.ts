import { DSP_THRESHOLDS } from "./config/thresholds.js";

/**
 * In-place / copy peak normalize to target dBTP (default −0.3).
 * Applied to every extracted capture clip.
 */
export function normalizePeak(
  input: Float32Array,
  targetDbtp: number = DSP_THRESHOLDS.percussive.peakNormDbtp,
): Float32Array {
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const a = Math.abs(input[i] ?? 0);
    if (a > peak) peak = a;
  }
  const out = new Float32Array(input.length);
  if (peak < 1e-9) {
    out.set(input);
    return out;
  }
  const target = Math.pow(10, targetDbtp / 20);
  const g = target / peak;
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] ?? 0) * g;
  }
  return out;
}
