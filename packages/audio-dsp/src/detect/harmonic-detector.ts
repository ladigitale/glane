import { DSP_THRESHOLDS } from "../config/thresholds.js";
import {
  AdaptiveNoiseFloor,
  computeDescriptors,
  snapToZeroCrossing,
} from "./descriptors.js";

export type HarmonicDetectorOpts = {
  sampleRate: number;
  channelCount?: number;
  /** Override DSP_THRESHOLDS.live.openFloorFactor (lower = more sensitive). */
  openFloorFactor?: number;
  /** Override close hold (ms). */
  closeHoldMs?: number;
  /** Override close peak ratio. */
  closePeakRatio?: number;
  /** Minimum event duration (ms). */
  minDurationMs?: number;
  /** Maximum event duration (ms). */
  maxDurationMs?: number;
  /** Minimum harmonicity (0–1) to accept an event. */
  minHarmonicity?: number;
  /** Maximum spectral flatness (0–1) to accept an event. */
  maxFlatness?: number;
  /** Pre-roll (ms). */
  preRollMs?: number;
  /** Post-roll (ms). */
  postRollMs?: number;
  /** Envelope hop frames. */
  envelopeHop?: number;
};

export type HarmonicExtraction = {
  pcm: Float32Array;
  class: "texture" | "tonal";
  confidence: number;
  tags: string[];
  loopProposed: boolean;
  loopStartMs?: number;
  loopEndMs?: number;
  loopXfadeMs?: number;
  loopScore?: number;
  kind: "texture";
  harmonicity: number;
  flatness: number;
  centroid: number;
};

export type HarmonicLiveState =
  | "idle"
  | "listening"
  | "event:attack"
  | "event:sustain"
  | "extracting"
  | "characterized";

/**
 * Harmonic detector — RMS envelope + spectral descriptors (harmonicity, flatness, centroid).
 * Designed for sustained, musical sounds: pads, drones, held notes, resonances.
 * Uses computeDescriptors (lightweight DFT) per hop frame.
 */
export class HarmonicDetector {
  readonly sampleRate: number;
  readonly channelCount: number;
  #openFloorFactor: number;
  #closeHoldMs: number;
  #closePeakRatio: number;
  #minDurationMs: number;
  #maxDurationMs: number;
  #minHarmonicity: number;
  #maxFlatness: number;
  #preRollMs: number;
  #postRollMs: number;
  #envelopeHop: number;

  readonly floor: AdaptiveNoiseFloor;
  #lastState: HarmonicLiveState = "idle";
  #cooldownUntil = 0;
  #openHold = 0;
  #closeHold = 0;
  #attackPeak = 0;
  #rmsSum = 0;
  #rmsFrames = 0;
  #prevRms = 0;
  #active: Float32Array[] | null = null;
  #activeLen = 0;
  #history: Float32Array;
  #histWrite = 0;
  #histFilled = 0;
  lastFramesScanned = 0;

  constructor(opts: HarmonicDetectorOpts) {
    this.sampleRate = opts.sampleRate;
    this.channelCount = Math.min(2, Math.max(1, Math.floor(opts.channelCount ?? 1)));
    const live = DSP_THRESHOLDS.live;

    this.#openFloorFactor = opts.openFloorFactor ?? live.openFloorFactor;
    this.#closeHoldMs = opts.closeHoldMs ?? live.closeHoldMsAtMin; // longer for textures
    this.#closePeakRatio = opts.closePeakRatio ?? live.closePeakRatio;
    this.#minDurationMs = opts.minDurationMs ?? live.textureMinMsAtMin;
    this.#maxDurationMs = opts.maxDurationMs ?? live.maxDurationMs;
    this.#minHarmonicity = opts.minHarmonicity ?? 0.25;
    this.#maxFlatness = opts.maxFlatness ?? 0.65;
    this.#preRollMs = opts.preRollMs ?? live.preRollMs;
    this.#postRollMs = opts.postRollMs ?? live.postRollMs;
    this.#envelopeHop = opts.envelopeHop ?? live.envelopeHop;

    this.floor = new AdaptiveNoiseFloor(this.sampleRate, this.#envelopeHop);

    const histN = Math.max(
      64 * this.channelCount,
      Math.floor(
        (this.#preRollMs / 1000) * this.sampleRate * 2 * this.channelCount,
      ),
    );
    this.#history = new Float32Array(histN);
  }

  get state(): HarmonicLiveState {
    return this.#lastState;
  }

  get openFloorFactor(): number {
    return this.#openFloorFactor;
  }

  setOpenFloorFactor(factor: number): void {
    const { openFloorMin, openFloorMax } = DSP_THRESHOLDS.live;
    this.#openFloorFactor = Math.min(openFloorMax, Math.max(openFloorMin, factor));
  }

  setMinHarmonicity(v: number): void {
    this.#minHarmonicity = Math.max(0, Math.min(1, v));
  }

  setMaxFlatness(v: number): void {
    this.#maxFlatness = Math.max(0, Math.min(1, v));
  }

  setMinDurationMs(ms: number): void {
    this.#minDurationMs = Math.max(50, Math.min(120_000, ms));
    if (this.#minDurationMs > this.#maxDurationMs) this.#maxDurationMs = this.#minDurationMs;
  }

  setMaxDurationMs(ms: number): void {
    this.#maxDurationMs = Math.max(this.#minDurationMs, Math.min(120_000, ms));
  }

  /**
   * @param delta Contiguous new interleaved PCM since previous call.
   * @returns state + extraction (null if no event closed).
   */
  analyse(delta: Float32Array, nowMs: number): {
    state: HarmonicLiveState;
    extraction: HarmonicExtraction | null;
    descriptors: {
      harmonicity: number;
      flatness: number;
      centroid: number;
      rms: number;
      peak: number;
    } | null;
  } {
    const live = DSP_THRESHOLDS.live;
    const ch = this.channelCount;
    const hopFrames = this.#envelopeHop;
    const hop = hopFrames * ch;

    if (nowMs < this.#cooldownUntil) {
      if (delta.length > 0) this.#pushHistory(delta);
      this.#lastState = this.#active ? "event:sustain" : "listening";
      return { state: this.#lastState, extraction: null, descriptors: null };
    }

    if (delta.length === 0) {
      this.#lastState = this.#active
        ? this.#activeLen < this.sampleRate * live.minBufferSec * ch
          ? "event:attack"
          : "event:sustain"
        : "listening";
      return { state: this.#lastState, extraction: null, descriptors: null };
    }

    const closeHoldFrames = Math.max(
      2,
      Math.round((this.#closeHoldMs / 1000) * (this.sampleRate / hopFrames)),
    );
    const maxSamples = Math.floor((this.#maxDurationMs / 1000) * this.sampleRate) * ch;
    const minSamples = Math.floor((this.#minDurationMs / 1000) * this.sampleRate) * ch;
    const postRoll = Math.floor((this.#postRollMs / 1000) * this.sampleRate) * ch;
    const preRollN = Math.floor((this.#preRollMs / 1000) * this.sampleRate) * ch;
    const openFloor = this.#openFloorFactor;

    let frames = 0;
    let noiseFloor = 0;
    let committed = 0;
    let lastDescriptors: ReturnType<typeof computeDescriptors>["descriptors"] | null = null;

    const commitUntil = (end: number): void => {
      if (!this.#active || end <= committed) return;
      const slice = delta.subarray(committed, end);
      if (slice.length === 0) return;
      this.#active.push(new Float32Array(slice));
      this.#activeLen += slice.length;
      committed = end;
    };

    const window = hannWindow(this.#envelopeHop);

    for (let i = 0; i + hop <= delta.length; i += hop) {
      const { rms, peak } = hopMidStats(delta, i, hopFrames, ch);
      noiseFloor = this.floor.pushRms(rms);
      frames++;

      // Spectral descriptors on mono frame
      const frameStart = i;
      const frameEnd = i + hopFrames * ch;
      const monoFrame = new Float32Array(hopFrames);
      for (let f = 0; f < hopFrames; f++) {
        let s = 0;
        const base = frameStart + f * ch;
        for (let c = 0; c < ch; c++) s += delta[base + c] ?? 0;
        monoFrame[f] = s / ch;
      }
      const descResult = computeDescriptors(monoFrame, window, null);
      lastDescriptors = descResult.descriptors;

      const harmonicity = descResult.descriptors.centroid > 0
        ? 1 - descResult.descriptors.flatness // proxy: low flatness = more harmonic
        : 0;
      const flatness = descResult.descriptors.flatness;

      if (!this.#active) {
        const harmonicOk = harmonicity >= this.#minHarmonicity && flatness <= this.#maxFlatness;
        if (rms > noiseFloor * openFloor && harmonicOk) {
          this.#openHold++;
          if (this.#openHold >= live.openHoldFrames) {
            this.#startEvent(delta, i, hop, preRollN, peak, rms);
            committed = i + hop;
            this.#lastState = "event:attack";
          }
        } else {
          this.#openHold = 0;
        }
      } else {
        this.#rmsSum += rms;
        this.#rmsFrames++;
        if (peak > this.#attackPeak) this.#attackPeak = peak;

        const closeThresh = Math.max(
          this.#attackPeak * this.#closePeakRatio,
          noiseFloor * live.closeFloorFactor,
        );
        const longEnough = this.#activeLen + Math.max(0, i + hop - committed) >= minSamples;
        if (longEnough && rms < closeThresh) {
          this.#closeHold++;
          if (this.#closeHold >= closeHoldFrames) {
            commitUntil(i + hop);
            const extraction = this.#finish(postRoll, lastDescriptors);
            this.#cooldownUntil = nowMs + live.cooldownMs;
            this.lastFramesScanned = frames;
            this.#lastState = extraction ? "characterized" : "listening";
            this.#prevRms = rms;
            this.#pushHistory(delta);
            return {
              state: this.#lastState,
              extraction,
              descriptors: lastDescriptors
                ? {
                    harmonicity,
                    flatness,
                    centroid: lastDescriptors.centroid,
                    rms: lastDescriptors.rms,
                    peak: lastDescriptors.peak,
                  }
                : null,
            };
          }
        } else {
          this.#closeHold = 0;
          this.#lastState = "event:sustain";
        }

        if (this.#activeLen + Math.max(0, i + hop - committed) >= maxSamples) {
          commitUntil(i + hop);
          const extraction = this.#finish(0, lastDescriptors);
          this.#cooldownUntil = nowMs + live.cooldownMs;
          this.lastFramesScanned = frames;
          this.#lastState = extraction ? "characterized" : "listening";
          this.#prevRms = rms;
          this.#pushHistory(delta);
          return {
            state: this.#lastState,
            extraction,
            descriptors: lastDescriptors
              ? {
                  harmonicity,
                  flatness,
                  centroid: lastDescriptors.centroid,
                  rms: lastDescriptors.rms,
                  peak: lastDescriptors.peak,
                }
              : null,
          };
        }
      }

      this.#prevRms = rms;
    }

    if (this.#active) {
      commitUntil(delta.length);
    }
    this.#pushHistory(delta);
    this.lastFramesScanned = frames;
    this.#lastState = this.#active
      ? this.#activeLen < minSamples
        ? "event:attack"
        : "event:sustain"
      : "listening";
    const harmonicityVal = lastDescriptors ? 1 - lastDescriptors.flatness : 0;
    const flatnessVal = lastDescriptors?.flatness ?? 1;
    return {
      state: this.#lastState,
      extraction: null,
      descriptors: lastDescriptors
        ? {
            harmonicity: harmonicityVal,
            flatness: flatnessVal,
            centroid: lastDescriptors.centroid,
            rms: lastDescriptors.rms,
            peak: lastDescriptors.peak,
          }
        : null,
    };
  }

  flush(): HarmonicExtraction | null {
    const minLen = this.sampleRate * 0.05 * this.channelCount;
    if (!this.#active || this.#activeLen < minLen) {
      this.#active = null;
      this.#activeLen = 0;
      this.#rmsSum = 0;
      this.#rmsFrames = 0;
      return null;
    }
    return this.#finish(0, null);
  }

  #pushHistory(delta: Float32Array): void {
    const hist = this.#history;
    const cap = hist.length;
    for (let i = 0; i < delta.length; i++) {
      hist[this.#histWrite] = delta[i] ?? 0;
      this.#histWrite = (this.#histWrite + 1) % cap;
      if (this.#histFilled < cap) this.#histFilled++;
    }
  }

  #historyTail(n: number): Float32Array {
    const take = Math.min(n, this.#histFilled);
    const out = new Float32Array(take);
    if (take === 0) return out;
    const cap = this.#history.length;
    const start = (this.#histWrite - take + cap * 2) % cap;
    for (let i = 0; i < take; i++) {
      out[i] = this.#history[(start + i) % cap] ?? 0;
    }
    return out;
  }

  #startEvent(
    delta: Float32Array,
    i: number,
    hop: number,
    preRollN: number,
    peak: number,
    rms: number,
  ): void {
    const fromDelta = Math.min(i, preRollN);
    const fromHist = preRollN - fromDelta;
    const histPart = this.#historyTail(fromHist);
    const deltaPart = delta.subarray(i - fromDelta, i + hop);
    const parts: Float32Array[] = [];
    let len = 0;
    if (histPart.length > 0) {
      parts.push(histPart);
      len += histPart.length;
    }
    parts.push(new Float32Array(deltaPart));
    len += deltaPart.length;
    this.#active = parts;
    this.#activeLen = len;
    this.#attackPeak = peak;
    this.#rmsSum = rms;
    this.#rmsFrames = 1;
    this.#closeHold = 0;
    this.#openHold = 0;
  }

  #finish(
    postRollSamples: number,
    descriptors: ReturnType<typeof computeDescriptors>["descriptors"] | null,
  ): HarmonicExtraction | null {
    if (!this.#active) return null;
    const parts = this.#active;
    this.#active = null;
    const len = this.#activeLen;
    this.#activeLen = 0;
    this.#closeHold = 0;
    this.#openHold = 0;
    const attackPeak = this.#attackPeak;
    const meanRms = this.#rmsFrames > 0 ? this.#rmsSum / this.#rmsFrames : 0;
    this.#rmsSum = 0;
    this.#rmsFrames = 0;
    const ch = this.channelCount;

    const pcm = new Float32Array(len + Math.max(0, postRollSamples));
    let o = 0;
    for (const p of parts) {
      pcm.set(p, o);
      o += p.length;
    }

    const mono = toMonoForSnap(pcm.subarray(0, o + Math.max(0, postRollSamples)), ch);
    let startFrame = 0;
    let endFrame = mono.length;
    startFrame = snapToZeroCrossing(mono, startFrame, 32);
    endFrame = snapToZeroCrossing(mono, Math.max(startFrame + 32, endFrame), 48);
    const start = startFrame * ch;
    const end = endFrame * ch;
    const slice = new Float32Array(pcm.subarray(start, end));
    const frames = Math.floor(slice.length / ch);
    if (frames < this.sampleRate * 0.04) return null;

    const durationMs = (frames / this.sampleRate) * 1000;
    const crest = attackPeak / (meanRms + 1e-9);

    // Classify: texture (long, flat) vs tonal (pitched, harmonic)
    const isTexture =
      durationMs >= this.#maxDurationMs * 0.7 ||
      (durationMs >= this.#minDurationMs && crest < 5);
    const klass = isTexture ? "texture" : "tonal";

    const harmonicity = descriptors?.centroid ? 1 - descriptors.flatness : 0;
    const flatness = descriptors?.flatness ?? 1;
    const centroid = descriptors?.centroid ?? 0;

    const tags = ["envelope", "harmonic", klass, "processing:pending"];

    return {
      pcm: slice,
      class: klass,
      confidence: isTexture ? 0.55 : 0.7,
      tags,
      loopProposed: isTexture,
      loopStartMs: isTexture ? 0 : undefined,
      loopEndMs: isTexture ? durationMs : undefined,
      loopXfadeMs: isTexture ? 40 : undefined,
      loopScore: isTexture ? 0.3 : undefined,
      kind: "texture",
      harmonicity,
      flatness,
      centroid,
    };
  }
}

/** Hann window (allocated once per size). */
function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

/** Mid RMS/peak over hopFrames starting at interleaved index start. */
function hopMidStats(
  delta: Float32Array,
  start: number,
  hopFrames: number,
  channelCount: number,
): { rms: number; peak: number } {
  let sumSq = 0;
  let peak = 0;
  const inv = 1 / channelCount;
  for (let f = 0; f < hopFrames; f++) {
    let mid = 0;
    const base = start + f * channelCount;
    for (let c = 0; c < channelCount; c++) mid += delta[base + c] ?? 0;
    mid *= inv;
    sumSq += mid * mid;
    const a = mid < 0 ? -mid : mid;
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, hopFrames)), peak };
}

function toMonoForSnap(pcm: Float32Array, channelCount: number): Float32Array {
  if (channelCount <= 1) return pcm;
  const frames = Math.floor(pcm.length / channelCount);
  const out = new Float32Array(frames);
  const inv = 1 / channelCount;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    const base = i * channelCount;
    for (let c = 0; c < channelCount; c++) s += pcm[base + c] ?? 0;
    out[i] = s * inv;
  }
  return out;
}

