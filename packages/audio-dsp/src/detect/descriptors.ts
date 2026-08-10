import { DSP_THRESHOLDS } from "../config/thresholds.js";

export type FrameDescriptors = {
  rms: number;
  peak: number;
  zcr: number;
  spectralFlux: number;
  centroid: number;
  flatness: number;
};

/** Hann window (allocated once per size outside audio thread). */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

/**
 * Lightweight realtime descriptors (TS prototype; WASM swap later ADR-0004).
 * Pure: Float32Array frame in → structured out. No DOM.
 */
export function computeDescriptors(
  frame: Float32Array,
  window: Float32Array,
  prevSpectrumMag: Float32Array | null,
): { descriptors: FrameDescriptors; spectrumMag: Float32Array } {
  const n = frame.length;
  const windowed = new Float32Array(n);
  let sumSq = 0;
  let peak = 0;
  let zc = 0;
  for (let i = 0; i < n; i++) {
    const s = (frame[i] ?? 0) * (window[i] ?? 1);
    windowed[i] = s;
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (i > 0) {
      const prev = windowed[i - 1] ?? 0;
      if ((prev >= 0 && s < 0) || (prev < 0 && s >= 0)) zc++;
    }
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = zc / n;

  // DFT magnitude (small N — prototype; replace with WASM FFT)
  const half = (n / 2) | 0;
  const spectrumMag = new Float32Array(half);
  let weighted = 0;
  let magSum = 0;
  let geo = 0;
  let arith = 0;
  for (let k = 0; k < half; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const s = windowed[i] ?? 0;
      re += s * Math.cos(w * i);
      im -= s * Math.sin(w * i);
    }
    const mag = Math.sqrt(re * re + im * im) / n;
    spectrumMag[k] = mag;
    weighted += k * mag;
    magSum += mag;
    arith += mag;
    geo += Math.log(mag + 1e-12);
  }
  const centroid = magSum > 0 ? weighted / magSum : 0;
  const flatness = Math.exp(geo / half) / (arith / half + 1e-12);

  let spectralFlux = 0;
  if (prevSpectrumMag) {
    for (let k = 0; k < half; k++) {
      const d = (spectrumMag[k] ?? 0) - (prevSpectrumMag[k] ?? 0);
      if (d > 0) spectralFlux += d;
    }
  }

  return {
    descriptors: { rms, peak, zcr, spectralFlux, centroid, flatness },
    spectrumMag,
  };
}

export class AdaptiveNoiseFloor {
  readonly bandHistory: number[] = [];
  readonly windowFrames: number;

  constructor(sampleRate: number, hop: number = DSP_THRESHOLDS.hopSize) {
    this.windowFrames = Math.max(
      1,
      Math.round(
        (DSP_THRESHOLDS.noiseFloorWindowMs / 1000) * (sampleRate / hop),
      ),
    );
  }

  pushRms(rms: number): number {
    this.bandHistory.push(rms);
    if (this.bandHistory.length > this.windowFrames) {
      this.bandHistory.shift();
    }
    const sorted = [...this.bandHistory].sort((a, b) => a - b);
    const idx = Math.floor(
      sorted.length * DSP_THRESHOLDS.noiseFloorPercentile,
    );
    return sorted[Math.min(idx, sorted.length - 1)] ?? rms;
  }
}

export class OnsetDetector {
  readonly fluxHistory: number[] = [];
  #lastOnsetFrame = -Infinity;
  readonly medianWindow: number;
  readonly hop: number;
  readonly sampleRate: number;
  readonly thresholdFactor: number;
  readonly delta: number;
  readonly guardMs: number;

  constructor(
    sampleRate: number,
    hop = DSP_THRESHOLDS.hopSize,
    opts?: {
      thresholdFactor?: number;
      delta?: number;
      guardMs?: number;
    },
  ) {
    this.sampleRate = sampleRate;
    this.hop = hop;
    this.thresholdFactor =
      opts?.thresholdFactor ?? DSP_THRESHOLDS.onsetThresholdFactor;
    this.delta = opts?.delta ?? DSP_THRESHOLDS.onsetDelta;
    this.guardMs = opts?.guardMs ?? DSP_THRESHOLDS.onsetGuardMs;
    this.medianWindow = Math.max(
      3,
      Math.round(
        (DSP_THRESHOLDS.onsetMedianWindowMs / 1000) * (sampleRate / hop),
      ),
    );
  }

  push(flux: number, frameIndex: number): boolean {
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.medianWindow * 2 + 1) {
      this.fluxHistory.shift();
    }
    const med = median(this.fluxHistory);
    const thresh = this.thresholdFactor * med + this.delta;
    const guardFrames =
      (this.guardMs / 1000) * (this.sampleRate / this.hop);
    if (flux > thresh && frameIndex - this.#lastOnsetFrame > guardFrames) {
      this.#lastOnsetFrame = frameIndex;
      return true;
    }
    return false;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Nearest zero-crossing with matching slope preference. */
export function snapToZeroCrossing(
  buffer: Float32Array,
  index: number,
  searchRadius = 64,
): number {
  let best = index;
  let bestDist = Infinity;
  const start = Math.max(1, index - searchRadius);
  const end = Math.min(buffer.length - 1, index + searchRadius);
  for (let i = start; i < end; i++) {
    const a = buffer[i - 1] ?? 0;
    const b = buffer[i] ?? 0;
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
      const d = Math.abs(i - index);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best;
}

/**
 * Rising zero-crossing: prev < 0, sample > 0, positive slope (prev < sample).
 * Returns the positive sample index — use as inclusive start, or exclusive end
 * (last included sample is then negative; next would continue the rising edge).
 */
export function snapToRisingZeroCrossing(
  buffer: Float32Array,
  index: number,
  searchRadius = 128,
): number {
  let best = index;
  let bestDist = Infinity;
  const start = Math.max(1, index - searchRadius);
  const end = Math.min(buffer.length - 1, index + searchRadius);
  for (let i = start; i <= end; i++) {
    const prev = buffer[i - 1] ?? 0;
    const cur = buffer[i] ?? 0;
    if (prev < 0 && cur > 0 && prev < cur) {
      const d = Math.abs(i - index);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best;
}

export function findEnergyMinimum(
  buffer: Float32Array,
  onsetIndex: number,
  backtrackSamples: number,
): number {
  const start = Math.max(0, onsetIndex - backtrackSamples);
  let best = onsetIndex;
  let bestE = Infinity;
  const win = 32;
  for (let i = start; i <= onsetIndex; i++) {
    let e = 0;
    for (let j = 0; j < win && i + j < buffer.length; j++) {
      const v = buffer[i + j] ?? 0;
      e += v * v;
    }
    if (e < bestE) {
      bestE = e;
      best = i;
    }
  }
  return best;
}
