import { snapToRisingZeroCrossing } from "../detect/descriptors.js";

export type SeamlessLoopResult = {
  /** Processed loop body (ready to play looped). */
  pcm: Float32Array;
  loopScore: number;
  xfadeMs: number;
  tags: string[];
};

/**
 * Divide each sample by a smoothed |signal| envelope so perceived loudness
 * stays nearly constant — accentuates texture grain.
 * Global peak-norm to −0.3 dBTP is applied afterward by `runProcessJob`.
 */
export function flattenEnvelope(
  input: Float32Array,
  sampleRate: number,
  opts: { target?: number; maxBoost?: number; maxCut?: number } = {},
): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  if (n < 64) {
    out.set(input);
    return out;
  }

  // Wide gain range so the result envelope is almost flat
  const maxBoost = opts.maxBoost ?? 48;
  const maxCut = opts.maxCut ?? 0.02;

  // Light envelope: |x| with asymmetric one-pole (faster rise, slower fall)
  const riseA = Math.exp(-1 / Math.max(2, sampleRate * 0.003));
  const fallA = Math.exp(-1 / Math.max(2, sampleRate * 0.08));
  const env = new Float32Array(n);
  let e = Math.abs(input[0] ?? 0);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(input[i] ?? 0);
    const a = x > e ? riseA : fallA;
    e = a * e + (1 - a) * x;
    env[i] = e;
  }
  // Forward + backward moving average (~15 ms) → stable amplitude envelope
  const smooth = new Float32Array(n);
  const ma = Math.max(16, Math.floor(sampleRate * 0.015));
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i] ?? 0;
    if (i >= ma) acc -= env[i - ma] ?? 0;
    smooth[i] = acc / Math.min(i + 1, ma);
  }
  acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += smooth[i] ?? 0;
    if (i + ma < n) acc -= smooth[i + ma] ?? 0;
    const w = Math.min(n - i, ma);
    smooth[i] = ((smooth[i] ?? 0) + acc / w) * 0.5;
  }

  // Target ≈ upper envelope so grain stays audible after division
  const sorted = Float32Array.from(smooth);
  sorted.sort();
  const hi =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0.2;
  const target = opts.target ?? Math.max(0.12, hi);

  const floor = target * 0.015;
  for (let i = 0; i < n; i++) {
    const local = Math.max(floor, smooth[i] ?? floor);
    let g = target / local;
    g = Math.min(maxBoost, Math.max(maxCut, g));
    out[i] = (input[i] ?? 0) * g;
  }
  return out;
}

/**
 * Join end→start with equal-power crossfade; output length = body − xfade
 * so the buffer loops without a level dip at the seam.
 */
export function crossfadeLoopEnds(
  body: Float32Array,
  xfadeN: number,
): Float32Array {
  const n = Math.min(Math.max(4, xfadeN), Math.floor(body.length / 3));
  const outLen = Math.max(n + 8, body.length - n);
  const out = new Float32Array(outLen);
  out.set(body.subarray(0, outLen));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const fadeIn = Math.sin((t * Math.PI) / 2);
    const fadeOut = Math.cos((t * Math.PI) / 2);
    const head = body[i] ?? 0;
    const tail = body[body.length - n + i] ?? 0;
    out[i] = head * fadeIn + tail * fadeOut;
  }
  return out;
}

/** Inclusive start + exclusive end on matching rising zero-crossings. */
function risingLoopBounds(
  pcm: Float32Array,
  approxStart: number,
  approxEnd: number,
  radius = 256,
): { start: number; end: number } {
  const start = snapToRisingZeroCrossing(pcm, approxStart, radius);
  let end = snapToRisingZeroCrossing(
    pcm,
    Math.max(start + 64, approxEnd),
    radius,
  );
  if (end <= start) {
    end = snapToRisingZeroCrossing(pcm, start + radius, radius * 2);
  }
  if (end <= start) end = Math.min(pcm.length - 1, start + 64);
  return { start, end };
}

/** Cosine fade at both ends so play/stop (and loop seams) do not click. */
function softenExtremities(
  pcm: Float32Array,
  sampleRate: number,
  fadeMs = 8,
): void {
  const fadeN = Math.min(
    Math.floor(pcm.length / 8),
    Math.max(4, Math.floor((fadeMs / 1000) * sampleRate)),
  );
  for (let i = 0; i < fadeN; i++) {
    const w = Math.sin(((i + 1) / (fadeN + 1)) * (Math.PI / 2));
    pcm[i] = (pcm[i] ?? 0) * w;
    pcm[pcm.length - 1 - i] = (pcm[pcm.length - 1 - i] ?? 0) * w;
  }
}

/**
 * Texture prep from a capture section:
 * 1. take a ZC-aligned slice (no repetition / stacking of the sound)
 * 2. flatten the amplitude envelope (sample / local envelope → almost constant)
 * 3. soften extremities to avoid clicks
 * Peak-norm is applied by `runProcessJob` after this returns.
 */
export function processTextureClip(
  input: Float32Array,
  sampleRate: number,
): SeamlessLoopResult | null {
  if (input.length < sampleRate * 0.15) return null;

  // Keep almost the whole take — trim only tiny edge noise, no period crop + copy
  const a = Math.floor(input.length * 0.01);
  const b = Math.floor(input.length * 0.99);
  const { start, end } = risingLoopBounds(input, a, b);
  const body = new Float32Array(input.subarray(start, end));
  if (body.length < 64) return null;

  const leveled = flattenEnvelope(body, sampleRate);
  softenExtremities(leveled, sampleRate);

  return {
    pcm: leveled,
    loopScore: 0.5,
    xfadeMs: 40,
    tags: ["loop-proposed", "seamless", "envelope-flat"],
  };
}

/** @deprecated prefer processTextureClip — kept for callers/tests */
export function makeSeamlessLoop(
  input: Float32Array,
  sampleRate: number,
): SeamlessLoopResult | null {
  return processTextureClip(input, sampleRate);
}
