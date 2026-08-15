/** Shared offline bake helpers. */

export const PEAK_TARGET = Math.pow(10, -0.3 / 20);

export function normalizePeak(pcm: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i] ?? 0);
    if (a > peak) peak = a;
  }
  const out = new Float32Array(pcm.length);
  if (peak < 1e-9) {
    out.set(pcm);
    return out;
  }
  const g = PEAK_TARGET / peak;
  for (let i = 0; i < pcm.length; i++) {
    out[i] = (pcm[i] ?? 0) * g;
  }
  return out;
}

/** Mix mono buffers (equal weight), pad to max length, peak-normalize. */
export function mixPcm(buffers: Float32Array[]): Float32Array {
  if (buffers.length === 0) return new Float32Array(0);
  if (buffers.length === 1) return normalizePeak(buffers[0] ?? new Float32Array(0));
  let maxLen = 0;
  for (const b of buffers) maxLen = Math.max(maxLen, b.length);
  const out = new Float32Array(maxLen);
  const w = 1 / buffers.length;
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) {
      out[i] = (out[i] ?? 0) + (b[i] ?? 0) * w;
    }
  }
  return normalizePeak(out);
}

export function scheduleAdsr(
  param: AudioParam,
  t0: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  peak: number,
  endTime: number,
): void {
  const a = Math.max(0.001, attack);
  const d = Math.max(0.001, decay);
  const r = Math.max(0.001, release);
  const noteEnd = Math.max(t0 + a + d + 0.01, endTime - r);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  param.exponentialRampToValueAtTime(
    Math.max(0.0001, peak * Math.max(0.001, sustain)),
    t0 + a + d,
  );
  param.setValueAtTime(
    Math.max(0.0001, peak * Math.max(0.001, sustain)),
    noteEnd,
  );
  param.exponentialRampToValueAtTime(0.0001, noteEnd + r);
}

export function softClipCurve(drive: number): Float32Array {
  const curve = new Float32Array(256);
  const k = 1 + Math.max(0, Math.min(1, drive)) * 40;
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
