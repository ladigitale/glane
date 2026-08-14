import { DSP_THRESHOLDS } from "./config/thresholds.js";
import {
  computeDescriptors,
  hannWindow,
} from "./detect/descriptors.js";
import { clampChannelCount, toMonoPcm } from "./pcm-layout.js";
import { songSlice } from "./song-slice.js";

export type ClipCharacterization = {
  lufs: number;
  peakDbtp: number;
  centroidHz: number;
  harmonicity: number;
  transientDensity: number;
  pitchHz?: number;
  noteName?: string;
  bpm?: number;
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const PITCH_MIN_HZ = 50;
const PITCH_MAX_HZ = 2000;
const PITCH_MIN_CORR = 0.55;
const DESCRIPTOR_FRAMES = 16;
const PITCH_WINDOW = 4096;

function hzToNoteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc] ?? "C"}${oct}`;
}

function corrAt(series: Float32Array, lag: number): number {
  let num = 0;
  let denA = 0;
  let denB = 0;
  const len = series.length - lag;
  if (len < 8 || lag < 1) return -1;
  for (let i = 0; i < len; i++) {
    const a = series[i] ?? 0;
    const b = series[i + lag] ?? 0;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  return num / (Math.sqrt(denA * denB) + 1e-12);
}

function estimatePitchHz(
  mono: Float32Array,
  sampleRate: number,
): number | undefined {
  const n = mono.length;
  if (n < 256 || sampleRate <= 0) return undefined;
  const win = Math.min(PITCH_WINDOW, n);
  let bestEnergy = -1;
  let bestStart = 0;
  const hop = Math.max(1, Math.floor(win / 4));
  for (let start = 0; start + win <= n; start += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) {
      const v = mono[start + i] ?? 0;
      e += v * v;
    }
    if (e > bestEnergy) {
      bestEnergy = e;
      bestStart = start;
    }
  }
  const slice = mono.subarray(bestStart, bestStart + win);
  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ));
  const maxLag = Math.min(
    Math.floor(slice.length / 2) - 1,
    Math.floor(sampleRate / PITCH_MIN_HZ),
  );
  if (maxLag <= minLag) return undefined;

  let bestLag = minLag;
  let bestCorr = -1;
  const step = Math.max(1, Math.floor((maxLag - minLag) / 400));
  for (let lag = minLag; lag <= maxLag; lag += step) {
    const corr = corrAt(slice, lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  const refineLo = Math.max(minLag, bestLag - step);
  const refineHi = Math.min(maxLag, bestLag + step);
  for (let lag = refineLo; lag <= refineHi; lag++) {
    const corr = corrAt(slice, lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestCorr < PITCH_MIN_CORR) return undefined;
  // Prefer the shortest period that still correlates (avoid octave-down).
  let lag = bestLag;
  for (const div of [2, 3, 4]) {
    const sub = Math.round(bestLag / div);
    if (sub < minLag) continue;
    if (corrAt(slice, sub) >= PITCH_MIN_CORR) lag = sub;
  }
  const hz = sampleRate / lag;
  if (hz < PITCH_MIN_HZ || hz > PITCH_MAX_HZ) return undefined;
  return hz;
}

function subsampledDescriptors(
  mono: Float32Array,
  sampleRate: number,
): { centroidHz: number; harmonicity: number } {
  const frameSize = DSP_THRESHOLDS.frameSize;
  if (mono.length < frameSize) {
    return { centroidHz: 0, harmonicity: 0 };
  }
  const window = hannWindow(frameSize);
  const maxStart = mono.length - frameSize;
  const count = Math.min(
    DESCRIPTOR_FRAMES,
    Math.max(1, Math.floor(mono.length / frameSize)),
  );
  let centroidSum = 0;
  let flatSum = 0;
  let used = 0;
  let prevSpec: Float32Array | null = null;
  const binHz = sampleRate / frameSize;
  for (let i = 0; i < count; i++) {
    const start =
      count === 1 ? 0 : Math.floor((i / (count - 1)) * maxStart);
    const frame = mono.subarray(start, start + frameSize);
    const { descriptors, spectrumMag } = computeDescriptors(
      frame,
      window,
      prevSpec,
    );
    prevSpec = spectrumMag;
    centroidSum += descriptors.centroid * binHz;
    flatSum += descriptors.flatness;
    used += 1;
  }
  const n = Math.max(1, used);
  return {
    centroidHz: centroidSum / n,
    harmonicity: Math.max(0, Math.min(1, 1 - flatSum / n)),
  };
}

function envelopeTransientDensity(
  mono: Float32Array,
  sampleRate: number,
): number {
  const hop = DSP_THRESHOLDS.hopSize;
  if (mono.length < hop * 4 || sampleRate <= 0) return 0;
  let peak = 0;
  const env: number[] = [];
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) {
      const v = mono[i + j] ?? 0;
      s += v * v;
    }
    const rms = Math.sqrt(s / hop);
    env.push(rms);
    if (rms > peak) peak = rms;
  }
  if (peak < 1e-6) return 0;
  const floor = peak * 0.08;
  let onsets = 0;
  let prev = env[0] ?? 0;
  for (let i = 1; i < env.length; i++) {
    const cur = env[i] ?? 0;
    if (cur > floor && cur > prev * 1.8) onsets += 1;
    prev = cur;
  }
  const durationSec = mono.length / sampleRate;
  return Math.max(0, Math.min(1, onsets / Math.max(0.25, durationSec * 8)));
}

/**
 * Cheap T2 scalars for SampleAnalysis (loudness, pitch, spectral cues).
 * A few DFT windows — not a full T1 pass.
 */
export function characterizePcm(
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
): ClipCharacterization {
  const mono = toMonoPcm(pcm, clampChannelCount(channelCount));
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const v = mono[i] ?? 0;
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const n = Math.max(1, mono.length);
  const meanSq = sumSq / n;
  const lufs = -0.691 + 10 * Math.log10(meanSq + 1e-12);
  const peakDbtp = 20 * Math.log10(peak + 1e-12);
  const { centroidHz, harmonicity } = subsampledDescriptors(mono, sampleRate);
  const transientDensity = envelopeTransientDensity(mono, sampleRate);
  const pitchHz = estimatePitchHz(mono, sampleRate);
  const tempo = songSlice.detectTempo(mono, sampleRate);

  const out: ClipCharacterization = {
    lufs,
    peakDbtp,
    centroidHz,
    harmonicity,
    transientDensity,
  };
  if (pitchHz != null) {
    out.pitchHz = pitchHz;
    out.noteName = hzToNoteName(pitchHz);
  }
  if (tempo?.bpm != null) out.bpm = tempo.bpm;
  return out;
}
