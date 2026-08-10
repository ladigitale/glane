/**
 * Versioned DSP thresholds — no magic constants elsewhere (spec §22).
 * Units and useful ranges documented per field.
 */
export const DSP_THRESHOLDS = {
  version: "1.5.2",
  frameSize: 1024,
  hopSize: 256,
  /** Adaptive noise floor: 10th percentile over this window (ms). */
  noiseFloorWindowMs: 5000,
  noiseFloorPercentile: 0.1,
  /** Onset: half-wave spectral flux median window (±ms) and factor. */
  onsetMedianWindowMs: 100,
  onsetThresholdFactor: 1.5,
  onsetDelta: 0.01,
  onsetGuardMs: 30,
  /** Offset: drop below peak − N dB or floor + 6 dB. */
  offsetPeakDropDb: 40,
  offsetFloorMarginDb: 6,
  /** Backtrack / zero-crossing / rolls (ms). Percussive uses preRollMs.percussive (tight). */
  backtrackMs: 12,
  preRollMs: { percussive: 4, tonal: 10, texture: 15, noise: 15, rhythmic: 10, voice: 10, unclassified: 8 },
  postRollMs: { percussive: 25, tonal: 80, texture: 200, noise: 200, rhythmic: 50, voice: 50, unclassified: 50 },
  durationMs: {
    percussive: { min: 30, max: 20000 },
    tonal: { min: 200, max: 60000 },
    texture: { min: 500, max: 60000 },
    noise: { min: 500, max: 60000 },
    rhythmic: { min: 2000, max: 60000 },
    voice: { min: 100, max: 60000 },
    unclassified: { min: 50, max: 60000 },
  },
  loop: {
    minPeriodMs: 250,
    xfadeMinMs: 20,
    xfadeMaxMs: 200,
  },
  percussive: {
    attackMaxMs: 20,
    fadeInMs: 2,
    fadeOutMs: 5,
    peakNormDbtp: -0.3,
    releasePeakRatio: 0.08,
    releaseHoldMs: 100,
    minDurationMs: 80,
    releasePostRollMs: 40,
    maxDurationMs: 20000,
  },
  /**
   * Live envelope hunter — RMS only (no DFT). Capture stays cheap;
   * polish runs in the persistent process queue.
   *
   * Capture UI sets a target events/min; openFloorFactor (and AtMin/AtMax
   * pairs) are auto-tuned so observed density approaches that target.
   */
  live: {
    /** Envelope hop (samples) — larger = cheaper. */
    envelopeHop: 512,
    minBufferSec: 0.12,
    /** New audio considered per tick (ms). */
    analyseHorizonMs: 350,
    /** Rolling snapshot for cursor tracking (ms). */
    snapshotMs: 2000,
    /**
     * Open when rms > noiseFloor * factor.
     * Lower = more attack-sensitive. UI maps 0–100 → openFloorMax…openFloorMin.
     */
    openFloorFactor: 1.3,
    openFloorMin: 1.05,
    /** High = “aucun” : only loud events open. */
    openFloorMax: 4.0,
    closeFloorFactor: 1.12,
    closePeakRatio: 0.1,
    /** Frames above floor to open an event. */
    openHoldFrames: 2,
    /** Close-hold ms: long at min (merge → textures), short at max (split taps). */
    closeHoldMsAtMin: 320,
    closeHoldMsAtMax: 55,
    preRollMs: 25,
    postRollMs: 100,
    minDurationMs: 80,
    /** Hard cap — long takes allowed; buffered outside the ring. */
    maxDurationMs: 25000,
    cooldownMs: 40,
    /** Duration floor for texture candidacy (lower → more textures). */
    textureMinMsAtMin: 500,
    textureMinMsAtMax: 2800,
    /** Past this → texture even with a sharp crest. */
    textureForceMsAtMin: 1600,
    textureForceMsAtMax: 14000,
    /**
     * peak / meanRms must be below this for texture (when past textureMin).
     * High at min → almost everything long becomes texture.
     * Low at max → only flat sustains are texture.
     */
    oneshotCrestMinAtMin: 25,
    oneshotCrestMinAtMax: 2.8,
    /** Re-attack only above this sensitivity01 (0…1). */
    reattackMinSensitivity: 0.35,
    reattackPeakRatioAtMin: 0.75,
    reattackPeakRatioAtMax: 0.4,
    reattackRmsRiseAtMin: 2.8,
    reattackRmsRiseAtMax: 1.5,
  },
  vad: {
    minScore: 3,
  },
} as const;

export type DspThresholds = typeof DSP_THRESHOLDS;
