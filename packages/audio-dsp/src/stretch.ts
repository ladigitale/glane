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

/** Linear resample. `ratio` > 1 → shorter / faster (pitch rises). */
function stretchResample(input: Float32Array, ratio: number): Float32Array {
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.min(last, Math.floor(src));
    const i1 = Math.min(last, i0 + 1);
    const f = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - f) + (input[i1] ?? 0) * f;
  }
  return out;
}

/**
 * WSOLA time-stretch (pitch preserved).
 * Same `ratio` contract as resample: >1 shorter/faster, <1 longer/slower.
 */
function stretchPreservePitch(input: Float32Array, ratio: number): Float32Array {
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const frameSize = 1024;
  if (input.length < frameSize + 64 || outLen < frameSize / 2) {
    return stretchResample(input, ratio);
  }

  const hopOut = 256;
  const search = 128;
  const corrLen = Math.min(hopOut * 2, frameSize);

  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = hann(i, frameSize);

  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  const maxRead = input.length - frameSize;
  let write = 0;
  let prevRead = 0;

  const addGrain = (read: number, at: number): void => {
    const r = Math.max(0, Math.min(maxRead, read));
    for (let i = 0; i < frameSize; i++) {
      const o = at + i;
      if (o >= outLen) break;
      const w = win[i]!;
      out[o] = (out[o] ?? 0) + (input[r + i] ?? 0) * w;
      norm[o] = (norm[o] ?? 0) + w;
    }
  };

  addGrain(0, 0);
  write = hopOut;

  while (write < outLen) {
    const ideal = Math.round((write / outLen) * maxRead);
    const targetStart = Math.min(maxRead, prevRead + hopOut);

    let lo = Math.max(0, ideal - search);
    let hi = Math.min(maxRead, ideal + search);
    if (hi < lo) {
      lo = Math.max(0, Math.min(ideal, maxRead));
      hi = lo;
    }

    let bestPos = Math.max(lo, Math.min(ideal, hi));
    let bestScore = -Infinity;
    const L = Math.min(corrLen, input.length - targetStart);

    for (let cand = lo; cand <= hi; cand += 2) {
      const n = Math.min(L, input.length - cand);
      if (n < 16) continue;
      let corr = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i < n; i++) {
        const a = input[targetStart + i]!;
        const b = input[cand + i]!;
        corr += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      const score = corr / (Math.sqrt(e1 * e2) + 1e-12);
      if (score > bestScore) {
        bestScore = score;
        bestPos = cand;
      }
    }

    addGrain(bestPos, write);
    prevRead = bestPos;
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
 * `ratio` > 1 → shorter/faster; mode `preserve-pitch` keeps pitch (WSOLA),
 * `resample` changes pitch with duration.
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
