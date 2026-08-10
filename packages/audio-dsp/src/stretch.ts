/** Repeat (or truncate) a buffer to fill `targetLen` — stretch mode `copy`. */
export function tileBuffer(
  input: Float32Array,
  targetLen: number,
  startOffset = 0,
): Float32Array {
  const out = new Float32Array(Math.max(1, targetLen));
  if (input.length === 0) return out;
  const n = input.length;
  let src = ((Math.floor(startOffset) % n) + n) % n;
  for (let i = 0; i < out.length; i++) {
    out[i] = input[src]!;
    src++;
    if (src >= n) src = 0;
  }
  return out;
}

/** Simple phase-vocoder-ish stretch stub (P5) — replace with signalsmith WASM. */
export function stretchBuffer(
  input: Float32Array,
  ratio: number,
  mode: "preserve-pitch" | "resample",
): Float32Array {
  if (ratio === 1) return input.slice();
  if (mode === "resample") {
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const f = src - i0;
      out[i] = (input[i0] ?? 0) * (1 - f) + (input[i1] ?? 0) * f;
    }
    return out;
  }
  // preserve-pitch: overlap-add WSOLA-ish
  const hopIn = 256;
  const hopOut = Math.max(1, Math.floor(hopIn / ratio));
  const out = new Float32Array(Math.floor(input.length / ratio) + hopIn);
  let read = 0;
  let write = 0;
  while (read + hopIn < input.length && write + hopIn < out.length) {
    for (let i = 0; i < hopIn; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / hopIn);
      out[write + i] = (out[write + i] ?? 0) + (input[read + i] ?? 0) * w;
    }
    read += hopIn;
    write += hopOut;
  }
  return out;
}
