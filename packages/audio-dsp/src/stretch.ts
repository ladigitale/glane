/** Linear resample to a new sample rate (mono). No-op when rates match. */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (
    input.length === 0 ||
    !Number.isFinite(fromRate) ||
    !Number.isFinite(toRate) ||
    fromRate <= 0 ||
    toRate <= 0 ||
    Math.abs(fromRate - toRate) < 1e-3
  ) {
    return input.slice();
  }
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.min(last, Math.floor(src));
    const i1 = Math.min(last, i0 + 1);
    const f = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i1] ?? 0) * f;
  }
  return out;
}

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

function hann(i: number, n: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / n);
}

/**
 * 4-point Catmull-Rom. Smoother than linear; slight overshoot on transients.
 */
function sampleCubic(buf: Float32Array, pos: number): number {
  const n = buf.length;
  if (n === 0) return 0;
  if (n === 1) return buf[0]!;
  const x = pos < 0 ? 0 : pos > n - 1 ? n - 1 : pos;
  const i1 = Math.floor(x);
  const f = x - i1;
  if (f < 1e-12) return buf[i1]!;
  const i0 = i1 > 0 ? i1 - 1 : 0;
  const i2 = i1 + 1 < n ? i1 + 1 : n - 1;
  const i3 = i1 + 2 < n ? i1 + 2 : n - 1;
  const y0 = buf[i0]!;
  const y1 = buf[i1]!;
  const y2 = buf[i2]!;
  const y3 = buf[i3]!;
  const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c = -0.5 * y0 + 0.5 * y2;
  return ((a * f + b) * f + c) * f + y1;
}

/** Cubic resample. `ratio` > 1 → shorter / faster (pitch rises). */
function stretchResample(input: Float32Array, ratio: number): Float32Array {
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = sampleCubic(input, i * ratio);
  }
  return out;
}

function nccScore(
  a: Float32Array,
  a0: number,
  b: Float32Array,
  b0: number,
  n: number,
): number {
  let corr = 0;
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < n; i++) {
    const x = a[a0 + i] ?? 0;
    const y = b[b0 + i] ?? 0;
    corr += x * y;
    e1 += x * x;
    e2 += y * y;
  }
  return corr / (Math.sqrt(e1 * e2) + 1e-12);
}

/** Sub-sample peak: Δ ∈ [-1, 1] from neighbors of a discrete NCC max. */
function parabolicDelta(sL: number, sC: number, sR: number): number {
  const denom = sL - 2 * sC + sR;
  if (Math.abs(denom) < 1e-12) return 0;
  const d = (0.5 * (sL - sR)) / denom;
  if (d > 1) return 1;
  if (d < -1) return -1;
  return d;
}

function pickGrain(inputLen: number): number {
  if (inputLen >= 2048 + 256) return 2048;
  if (inputLen >= 1024 + 128) return 1024;
  return 512;
}

/**
 * Granular WSOLA (pitch preserved): 75% Hann overlap-add, coarse-to-fine
 * splice search, parabolic offset, cubic grain read.
 * Same `ratio` contract as resample: >1 shorter/faster, <1 longer/slower.
 */
function stretchPreservePitch(input: Float32Array, ratio: number): Float32Array {
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const grain = pickGrain(input.length);
  if (input.length < grain + 64 || outLen < grain / 2) {
    return stretchResample(input, ratio);
  }

  const hopOut = grain >> 2;
  const hopIn = hopOut * (input.length / outLen);
  const search = Math.min(192, hopOut);
  const overlapLen = grain - hopOut;

  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) win[i] = hann(i, grain);

  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const maxRead = input.length - grain;

  const addGrain = (read: number, at: number): void => {
    const r = read < 0 ? 0 : read > maxRead ? maxRead : read;
    for (let i = 0; i < grain; i++) {
      const o = at + i;
      if (o >= outLen) break;
      const w = win[i]!;
      out[o] = (out[o] ?? 0) + sampleCubic(input, r + i) * w;
      norm[o] = (norm[o] ?? 0) + w;
    }
  };

  const scoreAt = (ref: number, cand: number): number => {
    const n = Math.min(overlapLen, input.length - ref, input.length - cand);
    if (n < 16) return -Infinity;
    return nccScore(input, ref, input, cand, n);
  };

  /** Best splice around `center`, then parabolic sub-sample. */
  const bestRead = (center: number, ref: number): number => {
    let lo = Math.max(0, Math.floor(center) - search);
    let hi = Math.min(maxRead, Math.ceil(center) + search);
    if (hi < lo) {
      lo = Math.max(0, Math.min(Math.round(center), maxRead));
      hi = lo;
    }

    let bestPos = Math.max(lo, Math.min(Math.round(center), hi));
    let bestScore = -Infinity;
    for (let cand = lo; cand <= hi; cand += 4) {
      const s = scoreAt(ref, cand);
      if (s > bestScore) {
        bestScore = s;
        bestPos = cand;
      }
    }
    const refineLo = Math.max(lo, bestPos - 4);
    const refineHi = Math.min(hi, bestPos + 4);
    for (let cand = refineLo; cand <= refineHi; cand++) {
      const s = scoreAt(ref, cand);
      if (s > bestScore) {
        bestScore = s;
        bestPos = cand;
      }
    }
    if (bestPos <= lo || bestPos >= hi) return bestPos;
    const sL = scoreAt(ref, bestPos - 1);
    const sR = scoreAt(ref, bestPos + 1);
    if (!Number.isFinite(sL) || !Number.isFinite(sR)) return bestPos;
    return bestPos + parabolicDelta(sL, bestScore, sR);
  };

  addGrain(0, 0);
  let write = hopOut;
  let prevRead = 0;

  while (write < outLen) {
    const mapped = (write / Math.max(1, outLen - grain)) * maxRead;
    const local = prevRead + hopIn;
    const center = mapped * 0.6 + local * 0.4;
    const ref = Math.max(
      0,
      Math.min(maxRead, Math.round(prevRead + hopOut)),
    );
    const read = bestRead(center, ref);
    addGrain(read, write);
    prevRead = read;
    write += hopOut;
  }

  for (let i = 0; i < outLen; i++) {
    const n = norm[i]!;
    if (n > 1e-8) out[i] = out[i]! / n;
  }
  return out;
}

/**
 * Time-stretch a mono buffer.
 * `ratio` > 1 → shorter/faster; `preserve-pitch` keeps pitch (granular WSOLA),
 * `resample` changes pitch with duration (cubic).
 */
export function stretchBuffer(
  input: Float32Array,
  ratio: number,
  mode: "preserve-pitch" | "resample",
): Float32Array {
  if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-9) {
    return input.slice();
  }
  const r = Math.min(4, Math.max(0.25, ratio));
  if (mode === "resample") return stretchResample(input, r);
  return stretchPreservePitch(input, r);
}
