import type { SampleClass } from "@glane/core-model";
import { DSP_THRESHOLDS } from "../config/thresholds.js";
import { AdaptiveNoiseFloor, snapToZeroCrossing } from "../detect/descriptors.js";

export type CaptureLiveState =
  | "idle"
  | "listening"
  | "event:attack"
  | "event:sustain"
  | "extracting"
  | "characterized";

export type Extraction = {
  pcm: Float32Array;
  class: SampleClass;
  confidence: number;
  tags: string[];
  loopProposed: boolean;
  loopStartMs?: number;
  loopEndMs?: number;
  loopXfadeMs?: number;
  loopScore?: number;
  kind: "oneshot" | "texture";
};

export type LiveKindDecision = {
  kind: "oneshot" | "texture";
  class: "percussive" | "texture";
};

/** Envelope shape → oneshot vs texture (pure; used by hunter + tests). */
export function liveKindFromEnvelope(opts: {
  durationMs: number;
  crest: number;
  textureMinMs: number;
  textureForceMs: number;
  oneshotCrestMin: number;
}): LiveKindDecision {
  const { durationMs, crest, textureMinMs, textureForceMs, oneshotCrestMin } =
    opts;
  const isTexture =
    durationMs >= textureForceMs ||
    (durationMs >= textureMinMs && crest < oneshotCrestMin);
  return isTexture
    ? { kind: "texture", class: "texture" }
    : { kind: "oneshot", class: "percussive" };
}

/**
 * Envelope-only segmenter for live capture.
 *
 * `analyse(delta, …)` expects **contiguous new samples only** (from a
 * RollingPcmWindow cursor). Hop frames are used for envelope detection;
 * PCM accumulation appends the full delta — no `length % hop` gaps.
 */
export type EnvelopeHunterOpts = {
  /** Overrides DSP_THRESHOLDS.live.openFloorFactor (lower = more sensitive). */
  openFloorFactor?: number;
  /** Interleaved channel count (1 = mono, 2 = stereo). Default 1. */
  channelCount?: number;
};

export class EnvelopeHunter {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly floor: AdaptiveNoiseFloor;
  #openFloorFactor: number;
  #lastState: CaptureLiveState = "idle";
  #cooldownUntil = 0;
  #openHold = 0;
  #closeHold = 0;
  #attackPeak = 0;
  #rmsSum = 0;
  #rmsFrames = 0;
  #prevRms = 0;
  #active: Float32Array[] | null = null;
  /** Interleaved sample count in `#active`. */
  #activeLen = 0;
  /** Recent audio for pre-roll when an event opens mid-delta. */
  #history: Float32Array;
  #histWrite = 0;
  #histFilled = 0;
  lastFramesScanned = 0;

  constructor(sampleRate: number, opts: EnvelopeHunterOpts = {}) {
    this.sampleRate = sampleRate;
    this.channelCount = Math.min(2, Math.max(1, Math.floor(opts.channelCount ?? 1)));
    this.#openFloorFactor =
      opts.openFloorFactor ?? DSP_THRESHOLDS.live.openFloorFactor;
    this.floor = new AdaptiveNoiseFloor(
      sampleRate,
      DSP_THRESHOLDS.live.envelopeHop,
    );
    const histN = Math.max(
      64 * this.channelCount,
      Math.floor(
        (DSP_THRESHOLDS.live.preRollMs / 1000) *
          sampleRate *
          2 *
          this.channelCount,
      ),
    );
    this.#history = new Float32Array(histN);
  }

  get state(): CaptureLiveState {
    return this.#lastState;
  }

  get openFloorFactor(): number {
    return this.#openFloorFactor;
  }

  /** Live-tweak attack sensitivity (clamped to openFloorMin…Max). */
  setOpenFloorFactor(factor: number): void {
    const { openFloorMin, openFloorMax } = DSP_THRESHOLDS.live;
    this.#openFloorFactor = Math.min(
      openFloorMax,
      Math.max(openFloorMin, factor),
    );
  }

  /**
   * 0 = least sensitive (high open floor), 1 = most sensitive.
   * Drives every AtMin↔AtMax live threshold.
   */
  #sensitivity01(): number {
    const { openFloorMin, openFloorMax } = DSP_THRESHOLDS.live;
    const span = openFloorMax - openFloorMin;
    if (span <= 0) return 0.5;
    return 1 - (this.#openFloorFactor - openFloorMin) / span;
  }

  #lerp(atMin: number, atMax: number): number {
    const s = this.#sensitivity01();
    return atMin + s * (atMax - atMin);
  }

  #effectiveCloseHoldMs(): number {
    const live = DSP_THRESHOLDS.live;
    return this.#lerp(live.closeHoldMsAtMin, live.closeHoldMsAtMax);
  }

  #effectiveTextureMinMs(): number {
    const live = DSP_THRESHOLDS.live;
    return this.#lerp(live.textureMinMsAtMin, live.textureMinMsAtMax);
  }

  #effectiveTextureForceMs(): number {
    const live = DSP_THRESHOLDS.live;
    return this.#lerp(live.textureForceMsAtMin, live.textureForceMsAtMax);
  }

  #effectiveOneshotCrestMin(): number {
    const live = DSP_THRESHOLDS.live;
    return this.#lerp(live.oneshotCrestMinAtMin, live.oneshotCrestMinAtMax);
  }

  /**
   * @param delta Contiguous **new** interleaved PCM since the previous call.
   */
  analyse(delta: Float32Array, nowMs: number): {
    state: CaptureLiveState;
    extraction: Extraction | null;
  } {
    const live = DSP_THRESHOLDS.live;
    const ch = this.channelCount;
    if (nowMs < this.#cooldownUntil) {
      if (delta.length > 0) this.#pushHistory(delta);
      this.#lastState = this.#active ? "event:sustain" : "listening";
      return { state: this.#lastState, extraction: null };
    }

    if (delta.length === 0) {
      this.#lastState = this.#active
        ? this.#activeLen < this.sampleRate * live.minBufferSec * ch
          ? "event:attack"
          : "event:sustain"
        : "listening";
      return { state: this.#lastState, extraction: null };
    }

    const hopFrames = live.envelopeHop;
    const hop = hopFrames * ch;
    const closeHoldFrames = Math.max(
      2,
      Math.round(
        (this.#effectiveCloseHoldMs() / 1000) * (this.sampleRate / hopFrames),
      ),
    );
    const maxSamples =
      Math.floor((live.maxDurationMs / 1000) * this.sampleRate) * ch;
    const minSamples =
      Math.floor((live.minDurationMs / 1000) * this.sampleRate) * ch;
    const postRoll =
      Math.floor((live.postRollMs / 1000) * this.sampleRate) * ch;
    const preRollN =
      Math.floor((live.preRollMs / 1000) * this.sampleRate) * ch;
    const openFloor = this.#openFloorFactor;

    let frames = 0;
    let noiseFloor = 0;
    /** Interleaved samples of `delta` already copied into `#active`. */
    let committed = 0;

    const commitUntil = (end: number): void => {
      if (!this.#active || end <= committed) return;
      const slice = delta.subarray(committed, end);
      if (slice.length === 0) return;
      this.#active.push(new Float32Array(slice));
      this.#activeLen += slice.length;
      committed = end;
    };

    for (let i = 0; i + hop <= delta.length; i += hop) {
      const { rms, peak } = hopMidStats(delta, i, hopFrames, ch);
      noiseFloor = this.floor.pushRms(rms);
      frames++;

      if (!this.#active) {
        if (rms > noiseFloor * openFloor) {
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
        const s = this.#sensitivity01();
        const reattackRatio = this.#lerp(
          live.reattackPeakRatioAtMin,
          live.reattackPeakRatioAtMax,
        );
        const reattackRise = this.#lerp(
          live.reattackRmsRiseAtMin,
          live.reattackRmsRiseAtMax,
        );
        const reattack =
          s >= live.reattackMinSensitivity &&
          this.#activeLen + (i - committed) >= minSamples &&
          this.#closeHold >= 1 &&
          peak >= this.#attackPeak * reattackRatio &&
          rms > this.#prevRms * reattackRise;

        if (reattack) {
          commitUntil(i);
          const extraction = this.#finish(postRoll);
          this.#cooldownUntil = nowMs + live.cooldownMs;
          this.#startEvent(delta, i, hop, preRollN, peak, rms);
          committed = i + hop;
          this.lastFramesScanned = frames;
          this.#lastState = extraction ? "characterized" : "event:attack";
          this.#prevRms = rms;
          this.#pushHistory(delta);
          return { state: this.#lastState, extraction };
        }

        this.#rmsSum += rms;
        this.#rmsFrames++;
        if (peak > this.#attackPeak) this.#attackPeak = peak;

        const closeThresh = Math.max(
          this.#attackPeak * live.closePeakRatio,
          noiseFloor * live.closeFloorFactor,
        );
        const longEnough =
          this.#activeLen + Math.max(0, i + hop - committed) >= minSamples;
        if (longEnough && rms < closeThresh) {
          this.#closeHold++;
          if (this.#closeHold >= closeHoldFrames) {
            commitUntil(i + hop);
            const extraction = this.#finish(postRoll);
            this.#cooldownUntil = nowMs + live.cooldownMs;
            this.lastFramesScanned = frames;
            this.#lastState = extraction ? "characterized" : "listening";
            this.#prevRms = rms;
            this.#pushHistory(delta);
            return { state: this.#lastState, extraction };
          }
        } else {
          this.#closeHold = 0;
          this.#lastState = "event:sustain";
        }

        if (this.#activeLen + Math.max(0, i + hop - committed) >= maxSamples) {
          commitUntil(i + hop);
          const extraction = this.#finish(0);
          this.#cooldownUntil = nowMs + live.cooldownMs;
          this.lastFramesScanned = frames;
          this.#lastState = extraction ? "characterized" : "listening";
          this.#prevRms = rms;
          this.#pushHistory(delta);
          return { state: this.#lastState, extraction };
        }
      }

      this.#prevRms = rms;
    }

    // Gap-free: append every sample of this delta, including hop remainder.
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
    return { state: this.#lastState, extraction: null };
  }

  /** Flush open event on stop (optional). */
  flush(): Extraction | null {
    const minLen = this.sampleRate * 0.05 * this.channelCount;
    if (!this.#active || this.#activeLen < minLen) {
      this.#active = null;
      this.#activeLen = 0;
      this.#rmsSum = 0;
      this.#rmsFrames = 0;
      return null;
    }
    return this.#finish(0);
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
    // History is samples *before* this delta (pushed at end of prior analyse).
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

  #finish(postRollSamples: number): Extraction | null {
    if (!this.#active) return null;
    const parts = this.#active;
    this.#active = null;
    const len = this.#activeLen;
    this.#activeLen = 0;
    this.#closeHold = 0;
    this.#openHold = 0;
    const attackPeak = this.#attackPeak;
    const meanRms =
      this.#rmsFrames > 0 ? this.#rmsSum / this.#rmsFrames : 0;
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
    const decision = liveKindFromEnvelope({
      durationMs,
      crest,
      textureMinMs: this.#effectiveTextureMinMs(),
      textureForceMs: this.#effectiveTextureForceMs(),
      oneshotCrestMin: this.#effectiveOneshotCrestMin(),
    });
    const isTexture = decision.kind === "texture";
    const tags = [
      "envelope",
      isTexture ? "texture" : "oneshot",
      "processing:pending",
    ];
    return {
      pcm: slice,
      class: decision.class,
      confidence: isTexture ? 0.55 : 0.62,
      tags,
      loopProposed: isTexture,
      loopStartMs: isTexture ? 0 : undefined,
      loopEndMs: isTexture ? durationMs : undefined,
      loopXfadeMs: isTexture ? 40 : undefined,
      loopScore: isTexture ? 0.3 : undefined,
      kind: decision.kind,
    };
  }
}

/** @deprecated alias — capture uses EnvelopeHunter */
export { EnvelopeHunter as EventHunter };

/** Mid RMS/peak over `hopFrames` starting at interleaved index `start`. */
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
