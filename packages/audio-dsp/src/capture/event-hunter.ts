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
};

export class EnvelopeHunter {
  readonly sampleRate: number;
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
  #activeLen = 0;
  /** Recent audio for pre-roll when an event opens mid-delta. */
  #history: Float32Array;
  #histWrite = 0;
  #histFilled = 0;
  lastFramesScanned = 0;

  constructor(sampleRate: number, opts: EnvelopeHunterOpts = {}) {
    this.sampleRate = sampleRate;
    this.#openFloorFactor =
      opts.openFloorFactor ?? DSP_THRESHOLDS.live.openFloorFactor;
    this.floor = new AdaptiveNoiseFloor(
      sampleRate,
      DSP_THRESHOLDS.live.envelopeHop,
    );
    const histN = Math.max(
      64,
      Math.floor((DSP_THRESHOLDS.live.preRollMs / 1000) * sampleRate * 2),
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
   * @param delta Contiguous **new** PCM since the previous call (cursor-fed).
   */
  analyse(delta: Float32Array, nowMs: number): {
    state: CaptureLiveState;
    extraction: Extraction | null;
  } {
    const live = DSP_THRESHOLDS.live;
    if (nowMs < this.#cooldownUntil) {
      if (delta.length > 0) this.#pushHistory(delta);
      this.#lastState = this.#active ? "event:sustain" : "listening";
      return { state: this.#lastState, extraction: null };
    }

    if (delta.length === 0) {
      this.#lastState = this.#active
        ? this.#activeLen < this.sampleRate * live.minBufferSec
          ? "event:attack"
          : "event:sustain"
        : "listening";
      return { state: this.#lastState, extraction: null };
    }

    const hop = live.envelopeHop;
    const closeHoldFrames = Math.max(
      2,
      Math.round(
        (this.#effectiveCloseHoldMs() / 1000) * (this.sampleRate / hop),
      ),
    );
    const maxSamples = Math.floor((live.maxDurationMs / 1000) * this.sampleRate);
    const minSamples = Math.floor((live.minDurationMs / 1000) * this.sampleRate);
    const postRoll = Math.floor((live.postRollMs / 1000) * this.sampleRate);
    const preRollN = Math.floor((live.preRollMs / 1000) * this.sampleRate);
    const openFloor = this.#openFloorFactor;

    let frames = 0;
    let noiseFloor = 0;
    /** Samples of `delta` already copied into `#active`. */
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
      const frame = delta.subarray(i, i + hop);
      const rms = frameRms(frame);
      const peak = framePeak(frame);
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
    if (!this.#active || this.#activeLen < this.sampleRate * 0.05) {
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

    const pcm = new Float32Array(len + Math.max(0, postRollSamples));
    let o = 0;
    for (const p of parts) {
      pcm.set(p, o);
      o += p.length;
    }

    let start = 0;
    let end = Math.min(pcm.length, o + postRollSamples);
    start = snapToZeroCrossing(pcm, start, 32);
    end = snapToZeroCrossing(pcm, Math.max(start + 32, end), 48);
    const slice = new Float32Array(pcm.subarray(start, end));
    if (slice.length < this.sampleRate * 0.04) return null;

    const durationMs = (slice.length / this.sampleRate) * 1000;
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

function frameRms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += (frame[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, frame.length));
}

function framePeak(frame: Float32Array): number {
  let p = 0;
  for (let i = 0; i < frame.length; i++) {
    const a = Math.abs(frame[i] ?? 0);
    if (a > p) p = a;
  }
  return p;
}
