/**
 * Song-mode import: detect tempo, map density → musical grid, cut slices.
 *
 * Tempo for real music comes from envelope / onset novelty autocorrelation
 * (not raw PCM period correlation — that only works on click trains).
 */
import { DSP_THRESHOLDS } from "./config/thresholds.js";
import { snapToRisingZeroCrossing } from "./detect/descriptors.js";

const MUSICAL_BEATS = [1, 2, 4, 8, 16] as const;
const BPM_MIN = 70;
const BPM_MAX = 180;
/** Cap tempo analysis window (long files stay cheap). */
const TEMPO_WINDOW_SEC = 30;
const MIN_SLICE_MS = 80;
const SILENCE_REL_PEAK = 0.02;
/** Envelope autocorr peak must beat the mean by this factor. */
const TEMPO_PEAK_PROMINENCE = 1.15;
const TEMPO_MIN_CORR = 0.08;

export type TempoEstimate = {
  bpm: number;
  periodSamples: number;
  confidence: number;
};

export type SongSlice = {
  start: number;
  end: number;
  pcm: Float32Array;
};

export type SliceSongResult = {
  bpm: number;
  periodSamples: number;
  beatsPerSlice: number;
  slices: SongSlice[];
};

function rmsEnvelope(samples: Float32Array, hop: number): Float32Array {
  const n = Math.max(1, Math.floor(samples.length / hop));
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop;
    const b = Math.min(samples.length, a + hop);
    let s = 0;
    for (let i = a; i < b; i++) {
      const v = samples[i] ?? 0;
      s += v * v;
    }
    env[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  return env;
}

/** Half-wave rectified envelope derivative — emphasizes attacks. */
function onsetNovelty(env: Float32Array): Float32Array {
  const out = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) {
    const d = (env[i] ?? 0) - (env[i - 1] ?? 0);
    out[i] = d > 0 ? d : 0;
  }
  return out;
}

function activeStartFrame(env: Float32Array, floor: number): number {
  for (let i = 0; i < env.length; i++) {
    if ((env[i] ?? 0) > floor) return i;
  }
  return 0;
}

function activeEndFrame(env: Float32Array, floor: number): number {
  for (let i = env.length - 1; i >= 0; i--) {
    if ((env[i] ?? 0) > floor) return i;
  }
  return Math.max(0, env.length - 1);
}

/** Normalized autocorr at one lag. */
function autocorrAt(series: Float32Array, lag: number): number {
  if (lag < 1 || lag >= series.length) return -1;
  const len = series.length - lag;
  if (len < 8) return -1;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < len; i++) {
    const a = series[i] ?? 0;
    const b = series[i + lag] ?? 0;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  return num / (Math.sqrt(denA * denB) + 1e-12);
}

/** Fold period into a typical beat BPM range. */
function foldToBeatPeriod(
  periodSamples: number,
  sampleRate: number,
): { bpm: number; periodSamples: number } {
  let period = Math.max(1, periodSamples);
  let bpm = (60 * sampleRate) / period;
  while (bpm < BPM_MIN && period > 8) {
    period = Math.round(period / 2);
    bpm = (60 * sampleRate) / period;
  }
  while (bpm > BPM_MAX) {
    period = Math.round(period * 2);
    bpm = (60 * sampleRate) / period;
  }
  return { bpm, periodSamples: period };
}

function analysisWindows(
  pcm: Float32Array,
  sampleRate: number,
): Float32Array[] {
  const maxN = Math.floor(TEMPO_WINDOW_SEC * sampleRate);
  if (pcm.length <= maxN) return [pcm];

  const starts = [
    0,
    Math.floor((pcm.length - maxN) / 3),
    Math.floor((pcm.length - maxN) / 2),
    Math.max(0, pcm.length - maxN),
  ];
  const seen = new Set<number>();
  const out: Float32Array[] = [];
  for (const s of starts) {
    const start = Math.max(0, Math.min(s, pcm.length - maxN));
    if (seen.has(start)) continue;
    seen.add(start);
    out.push(pcm.subarray(start, start + maxN));
  }
  return out;
}

function peakAbs(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i] ?? 0);
    if (a > peak) peak = a;
  }
  return peak;
}

function sliceRms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s / pcm.length);
}

/**
 * Score BPM candidates via novelty autocorr + harmonic reinforcement
 * (lag + 2×lag). Real music rarely has waveform-periodic PCM.
 */
function estimateTempoFromSeries(
  series: Float32Array,
  hop: number,
  sampleRate: number,
): TempoEstimate | null {
  if (series.length < 32) return null;

  const minLag = Math.max(
    2,
    Math.floor(((60 / BPM_MAX) * sampleRate) / hop),
  );
  const maxLag = Math.min(
    Math.floor(series.length / 2) - 1,
    Math.floor(((60 / BPM_MIN) * sampleRate) / hop),
  );
  if (maxLag <= minLag) return null;

  const scores: number[] = [];
  let bestLag = minLag;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const c1 = autocorrAt(series, lag);
    const c2 = autocorrAt(series, Math.min(maxLag, lag * 2));
    const score = c1 + Math.max(0, c2) * 0.4;
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  scores.sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)] ?? 0;
  const p90 = scores[Math.floor(scores.length * 0.9)] ?? 0;

  let refined = bestLag;
  let refinedScore = bestScore;
  for (const d of [-2, -1, 1, 2]) {
    const lag = bestLag + d;
    if (lag < minLag || lag > maxLag) continue;
    const c1 = autocorrAt(series, lag);
    const c2 = autocorrAt(series, Math.min(maxLag, lag * 2));
    const score = c1 + Math.max(0, c2) * 0.4;
    if (score > refinedScore) {
      refinedScore = score;
      refined = lag;
    }
  }

  const peakCorr = autocorrAt(series, refined);
  const harmCorr = autocorrAt(series, Math.min(maxLag, refined * 2));
  if (peakCorr < TEMPO_MIN_CORR) return null;
  // Peak must stand out from the bulk of the lag spectrum (noise is flat).
  if (refinedScore < median + 0.06 && refinedScore < p90 * 1.05) return null;
  if (refinedScore < median * TEMPO_PEAK_PROMINENCE && peakCorr < 0.18) {
    return null;
  }
  // Weak fundamental without harmonic support → reject.
  if (harmCorr < 0.04 && peakCorr < 0.22) return null;

  const periodSamples = Math.round(refined * hop);
  const folded = foldToBeatPeriod(periodSamples, sampleRate);
  const prominence =
    median > 1e-6 ? Math.max(0, refinedScore - median) / (Math.abs(median) + 0.05) : 1;
  const confidence = Math.max(
    0,
    Math.min(
      1,
      ((peakCorr + 1) / 2) * 0.4 +
        Math.max(0, harmCorr) * 0.25 +
        Math.min(1, prominence) * 0.35,
    ),
  );
  if (confidence < 0.5) return null;

  return {
    bpm: Math.round(folded.bpm * 10) / 10,
    periodSamples: folded.periodSamples,
    confidence,
  };
}

function detectTempoInWindow(
  window: Float32Array,
  sampleRate: number,
): TempoEstimate | null {
  if (window.length < sampleRate * 2) return null;

  const hop = Math.max(64, Math.floor(sampleRate * 0.01));
  const env = rmsEnvelope(window, hop);
  const peak = env.reduce((m, v) => (v > m ? v : m), 0);
  if (peak < 1e-6) return null;
  const floor = peak * DSP_THRESHOLDS.loop.silenceRelPeak;

  const aFrame = activeStartFrame(env, floor);
  const bFrame = activeEndFrame(env, floor);
  if (bFrame <= aFrame + 16) return null;

  const activeEnv = env.subarray(aFrame, bFrame + 1);
  const novelty = onsetNovelty(activeEnv);

  // Prefer novelty (attacks); fall back to RMS envelope.
  const fromNovelty = estimateTempoFromSeries(novelty, hop, sampleRate);
  if (fromNovelty && fromNovelty.confidence >= 0.5) return fromNovelty;

  const fromEnv = estimateTempoFromSeries(activeEnv, hop, sampleRate);
  if (!fromEnv) return fromNovelty;
  if (!fromNovelty) return fromEnv;
  return fromNovelty.confidence >= fromEnv.confidence ? fromNovelty : fromEnv;
}

/**
 * Envelope / onset novelty → beat period + BPM.
 * Tries several windows on long files (intros are often free-tempo).
 */
function detectTempo(
  pcm: Float32Array,
  sampleRate: number,
): TempoEstimate | null {
  if (sampleRate <= 0 || pcm.length < sampleRate * 2) return null;

  let best: TempoEstimate | null = null;
  for (const window of analysisWindows(pcm, sampleRate)) {
    const est = detectTempoInWindow(window, sampleRate);
    if (!est) continue;
    if (!best || est.confidence > best.confidence) best = est;
  }
  return best;
}

/** Map target slices/min + BPM → musical beats per slice. */
function beatsPerSliceFromTarget(bpm: number, targetPerMin: number): number {
  const t = Math.max(1, targetPerMin);
  const raw = Math.max(0.5, bpm / t);
  let best: (typeof MUSICAL_BEATS)[number] = 1;
  let bestDist = Infinity;
  for (const n of MUSICAL_BEATS) {
    const d = Math.abs(raw - n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/**
 * Human label for a beats-per-slice grid (4/4 assumed).
 * Used by Capture UI preview (often with a reference BPM).
 */
function gridLabel(beatsPerSlice: number): {
  beats: number;
  bars: number;
  kind: "beat" | "half-bar" | "bar" | "bars";
} {
  const beats = MUSICAL_BEATS.includes(
    beatsPerSlice as (typeof MUSICAL_BEATS)[number],
  )
    ? beatsPerSlice
    : beatsPerSliceFromTarget(120, 120 / Math.max(1, beatsPerSlice));
  if (beats <= 1) return { beats: 1, bars: 0.25, kind: "beat" };
  if (beats === 2) return { beats: 2, bars: 0.5, kind: "half-bar" };
  if (beats === 4) return { beats: 4, bars: 1, kind: "bar" };
  return { beats, bars: beats / 4, kind: "bars" };
}

export type SliceSongOpts = {
  targetPerMin: number;
  /** Override tempo (tests). */
  tempo?: TempoEstimate;
};

/**
 * Cut the whole file on a tempo grid. Returns null if tempo cannot be found.
 */
function sliceSong(
  pcm: Float32Array,
  sampleRate: number,
  opts: SliceSongOpts,
): SliceSongResult | null {
  const tempo = opts.tempo ?? detectTempo(pcm, sampleRate);
  if (!tempo) return null;

  const beatsPerSlice = beatsPerSliceFromTarget(tempo.bpm, opts.targetPerMin);
  const sliceLen = Math.max(
    1,
    Math.round(tempo.periodSamples * beatsPerSlice),
  );
  const minSamples = Math.floor((MIN_SLICE_MS / 1000) * sampleRate);
  const globalPeak = peakAbs(pcm);
  const silenceFloor = globalPeak * SILENCE_REL_PEAK;

  const hop = Math.max(64, Math.floor(sampleRate * 0.01));
  const env = rmsEnvelope(pcm, hop);
  const peak = env.reduce((m, v) => (v > m ? v : m), 0);
  const floor = peak * DSP_THRESHOLDS.loop.silenceRelPeak;
  const aFrame = activeStartFrame(env, floor);
  let cursor = snapToRisingZeroCrossing(pcm, aFrame * hop, 256);

  const slices: SongSlice[] = [];
  while (cursor + minSamples < pcm.length) {
    const approxEnd = Math.min(pcm.length, cursor + sliceLen);
    let end = snapToRisingZeroCrossing(
      pcm,
      Math.min(pcm.length - 1, approxEnd),
      256,
    );
    if (end <= cursor + minSamples) {
      end = Math.min(pcm.length, cursor + sliceLen);
    }
    if (Math.abs(end - cursor - sliceLen) > sliceLen * 0.15) {
      end = Math.min(pcm.length, cursor + sliceLen);
    }

    const body = pcm.subarray(cursor, end);
    // Keep almost all grid slices — only drop near-total silence.
    if (
      body.length >= minSamples &&
      (silenceFloor <= 1e-9 || sliceRms(body) >= silenceFloor * 0.5)
    ) {
      const copy = new Float32Array(body.length);
      copy.set(body);
      slices.push({ start: cursor, end, pcm: copy });
    }

    cursor = end;
    if (pcm.length - cursor < minSamples) break;
  }

  // If silence cull wiped everything, still keep the grid (user asked for parts).
  if (slices.length === 0) {
    cursor = snapToRisingZeroCrossing(pcm, aFrame * hop, 256);
    while (cursor + minSamples < pcm.length) {
      const end = Math.min(pcm.length, cursor + sliceLen);
      const body = pcm.subarray(cursor, end);
      if (body.length >= minSamples) {
        const copy = new Float32Array(body.length);
        copy.set(body);
        slices.push({ start: cursor, end, pcm: copy });
      }
      cursor = end;
    }
  }

  if (slices.length === 0) return null;

  return {
    bpm: tempo.bpm,
    periodSamples: tempo.periodSamples,
    beatsPerSlice,
    slices,
  };
}

/** Circular rotate: samples before `offset` move to the end. */
export function rotatePcm(pcm: Float32Array, offset: number): Float32Array {
  const n = pcm.length;
  if (n === 0) return pcm;
  let o = Math.round(offset) % n;
  if (o < 0) o += n;
  if (o === 0) {
    const copy = new Float32Array(n);
    copy.set(pcm);
    return copy;
  }
  const out = new Float32Array(n);
  out.set(pcm.subarray(o), 0);
  out.set(pcm.subarray(0, o), n - o);
  return out;
}

export const songSlice = {
  detectTempo,
  beatsPerSliceFromTarget,
  gridLabel,
  sliceSong,
  rotatePcm,
  musicalBeats: MUSICAL_BEATS,
  referenceBpm: 120,
} as const;
