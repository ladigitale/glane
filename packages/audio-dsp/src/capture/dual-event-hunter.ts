import { DSP_THRESHOLDS } from "../config/thresholds.js";
import { HarmonicDetector, type HarmonicExtraction } from "../detect/harmonic-detector.js";
import {
  EnvelopeHunter,
  type CaptureLiveState,
  type EnvelopeHunterOpts,
  type Extraction,
} from "./event-hunter.js";

export type DetectionMode = "attack" | "harmonic" | "both";

export type DualHunterOpts = EnvelopeHunterOpts & {
  /** Attack/transient sensitivity 0–100 (maps to openFloorFactor). */
  attackSensitivity?: number;
  /** Harmonic/sustained sensitivity 0–100. */
  harmonicSensitivity?: number;
  /** Harmonic min duration (ms). */
  harmonicMinDurationMs?: number;
  /** Harmonic max duration (ms). */
  harmonicMaxDurationMs?: number;
  /** Harmonic minimum harmonicity (0–1). */
  harmonicMinHarmonicity?: number;
  /** Harmonic maximum flatness (0–1). */
  harmonicMaxFlatness?: number;
  /** Which detector(s) to run. Default `"attack"` — same as EnvelopeHunter. */
  mode?: DetectionMode;
};

export type DualExtraction = Extraction & {
  source: "attack" | "harmonic";
  harmonicity?: number;
  flatness?: number;
  centroid?: number;
};

export type DualHunterResult = {
  state: CaptureLiveState;
  extraction: DualExtraction | null;
  source: "attack" | "harmonic" | null;
};

function sensitivityToOpenFloor(sensitivity: number): number {
  const { openFloorMin, openFloorMax } = DSP_THRESHOLDS.live;
  const s = Math.min(100, Math.max(0, sensitivity));
  return openFloorMax - (s / 100) * (openFloorMax - openFloorMin);
}

/**
 * Dual event hunter — Attack (`EnvelopeHunter`) and/or Harmonic (`HarmonicDetector`).
 * Same call shape as `EnvelopeHunter`: `new DualEventHunter(sampleRate, opts)`.
 */
export class DualEventHunter {
  readonly sampleRate: number;
  readonly channelCount: number;
  #attack: EnvelopeHunter | null = null;
  #harmonic: HarmonicDetector | null = null;
  #mode: DetectionMode;
  #lastState: CaptureLiveState = "idle";
  #lastSource: "attack" | "harmonic" | null = null;
  lastFramesScanned = 0;

  constructor(sampleRate: number, opts: DualHunterOpts = {}) {
    this.sampleRate = sampleRate;
    this.channelCount = Math.min(
      2,
      Math.max(1, Math.floor(opts.channelCount ?? 1)),
    );
    this.#mode = opts.mode ?? "attack";

    const openFloor =
      opts.openFloorFactor ??
      (opts.attackSensitivity != null
        ? sensitivityToOpenFloor(opts.attackSensitivity)
        : undefined);

    if (this.#mode !== "harmonic") {
      this.#attack = new EnvelopeHunter(sampleRate, {
        openFloorFactor: openFloor,
        channelCount: this.channelCount,
        minDurationMs: opts.minDurationMs,
        maxDurationMs: opts.maxDurationMs,
      });
    }

    if (this.#mode !== "attack") {
      const harmSens = opts.harmonicSensitivity ?? 50;
      const live = DSP_THRESHOLDS.live;
      this.#harmonic = new HarmonicDetector({
        sampleRate,
        channelCount: this.channelCount,
        openFloorFactor: sensitivityToOpenFloor(harmSens),
        closeHoldMs: live.closeHoldMsAtMin,
        closePeakRatio: live.closePeakRatio,
        minDurationMs: opts.harmonicMinDurationMs ?? live.textureMinMsAtMin,
        maxDurationMs: opts.harmonicMaxDurationMs ?? live.maxDurationMs,
        minHarmonicity: opts.harmonicMinHarmonicity ?? 0.25,
        maxFlatness: opts.harmonicMaxFlatness ?? 0.65,
        preRollMs: live.preRollMs,
        postRollMs: live.postRollMs,
        envelopeHop: live.envelopeHop,
      });
    }
  }

  get mode(): DetectionMode {
    return this.#mode;
  }

  get state(): CaptureLiveState {
    return this.#lastState;
  }

  get openFloorFactor(): number {
    return (
      this.#attack?.openFloorFactor ??
      this.#harmonic?.openFloorFactor ??
      DSP_THRESHOLDS.live.openFloorFactor
    );
  }

  /** Compat with EnvelopeHunter / rate regulator. */
  setOpenFloorFactor(factor: number): void {
    this.#attack?.setOpenFloorFactor(factor);
  }

  setAttackSensitivity(s: number): void {
    this.#attack?.setOpenFloorFactor(sensitivityToOpenFloor(s));
  }

  setHarmonicSensitivity(s: number): void {
    this.#harmonic?.setOpenFloorFactor(sensitivityToOpenFloor(s));
  }

  setHarmonicMinHarmonicity(v: number): void {
    this.#harmonic?.setMinHarmonicity(v);
  }

  setHarmonicMaxFlatness(v: number): void {
    this.#harmonic?.setMaxFlatness(v);
  }

  setHarmonicMinDurationMs(ms: number): void {
    this.#harmonic?.setMinDurationMs(ms);
  }

  setHarmonicMaxDurationMs(ms: number): void {
    this.#harmonic?.setMaxDurationMs(ms);
  }

  setMinDurationMs(ms: number): void {
    this.#attack?.setMinDurationMs(ms);
  }

  setMaxDurationMs(ms: number): void {
    this.#attack?.setMaxDurationMs(ms);
  }

  analyse(delta: Float32Array, nowMs: number): DualHunterResult {
    let attackExt: Extraction | null = null;
    let harmonicExt: HarmonicExtraction | null = null;
    let attackState: CaptureLiveState = "listening";
    let harmonicState: CaptureLiveState = "listening";
    let frames = 0;

    if (this.#attack) {
      const res = this.#attack.analyse(delta, nowMs);
      attackState = res.state;
      attackExt = res.extraction;
      frames = Math.max(frames, this.#attack.lastFramesScanned);
    }

    if (this.#harmonic) {
      const res = this.#harmonic.analyse(delta, nowMs);
      harmonicState = res.state as CaptureLiveState;
      harmonicExt = res.extraction;
      frames = Math.max(frames, this.#harmonic.lastFramesScanned);
    }

    this.lastFramesScanned = frames;

    // Prefer attack extraction when both close (transients first).
    if (attackExt) {
      const out: DualExtraction = { ...attackExt, source: "attack" };
      this.#lastState = "characterized";
      this.#lastSource = "attack";
      return { state: this.#lastState, extraction: out, source: "attack" };
    }

    if (harmonicExt) {
      const out = harmonicToDual(harmonicExt);
      this.#lastState = "characterized";
      this.#lastSource = "harmonic";
      return { state: this.#lastState, extraction: out, source: "harmonic" };
    }

    this.#lastState = mergeStates(attackState, harmonicState);
    this.#lastSource =
      this.#lastState === "listening" || this.#lastState === "idle"
        ? null
        : attackState === "event:attack" || attackState === "event:sustain"
          ? "attack"
          : "harmonic";

    return { state: this.#lastState, extraction: null, source: this.#lastSource };
  }

  flush(): DualExtraction | null {
    const attackExt = this.#attack?.flush() ?? null;
    if (attackExt) {
      this.#lastSource = "attack";
      return { ...attackExt, source: "attack" };
    }
    const harmonicExt = this.#harmonic?.flush() ?? null;
    if (harmonicExt) {
      this.#lastSource = "harmonic";
      return harmonicToDual(harmonicExt);
    }
    return null;
  }

  get lastSource(): "attack" | "harmonic" | null {
    return this.#lastSource;
  }
}

function harmonicToDual(h: HarmonicExtraction): DualExtraction {
  return {
    pcm: h.pcm,
    class: h.class === "tonal" ? "tonal" : "texture",
    confidence: h.confidence,
    tags: h.tags,
    loopProposed: h.loopProposed,
    loopStartMs: h.loopStartMs,
    loopEndMs: h.loopEndMs,
    loopXfadeMs: h.loopXfadeMs,
    loopScore: h.loopScore,
    kind: h.kind,
    source: "harmonic",
    harmonicity: h.harmonicity,
    flatness: h.flatness,
    centroid: h.centroid,
  };
}

function mergeStates(a: CaptureLiveState, b: CaptureLiveState): CaptureLiveState {
  const rank = (s: CaptureLiveState): number => {
    switch (s) {
      case "characterized":
        return 5;
      case "extracting":
        return 4;
      case "event:attack":
        return 3;
      case "event:sustain":
        return 2;
      case "listening":
        return 1;
      default:
        return 0;
    }
  };
  return rank(a) >= rank(b) ? a : b;
}

