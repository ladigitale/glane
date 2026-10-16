import type { DualHunterOpts, DetectionMode } from "@glane/audio-dsp";
import type { FileProcessMode } from "./db.js";

/** Modes that segment via event detectors (not tempo grid / whole file). */
export function isEventProcessMode(
  mode: FileProcessMode,
): mode is "hunt" | "attack" | "harmonic" {
  return mode === "hunt" || mode === "attack" || mode === "harmonic";
}

/** Live mic uses event modes; song/whole fall back to hunt. */
export function liveEventMode(mode: FileProcessMode): "hunt" | "attack" | "harmonic" {
  return isEventProcessMode(mode) ? mode : "hunt";
}

/**
 * Density (sons/min + interest cull) only for classic hunt / song grid.
 * Attack & harmonic = pure detection criteria.
 */
export function usesDensityTarget(mode: FileProcessMode): boolean {
  return mode === "hunt" || mode === "song";
}

export type EventHunterPrefs = {
  attackSensitivity?: number;
  openFloorFactor?: number;
  harmonicSensitivity?: number;
  harmonicMinHarmonicity?: number;
  harmonicMaxFlatness?: number;
  harmonicMinDurationMs?: number;
  channelCount?: number;
};

/**
 * Map file/live process mode → DualEventHunter options.
 * - hunt: general envelope (current default)
 * - attack: short transients / claps (tight max duration)
 * - harmonic: stable tonal zones
 */
export function dualHunterOptsFor(
  mode: "hunt" | "attack" | "harmonic",
  prefs: EventHunterPrefs = {},
): DualHunterOpts {
  const channelCount = prefs.channelCount;
  const openFloorFactor = prefs.openFloorFactor;
  const attackSensitivity = prefs.attackSensitivity;

  if (mode === "harmonic") {
    return {
      mode: "harmonic" satisfies DetectionMode,
      channelCount,
      harmonicSensitivity: prefs.harmonicSensitivity ?? 50,
      harmonicMinHarmonicity: prefs.harmonicMinHarmonicity ?? 0.25,
      harmonicMaxFlatness: prefs.harmonicMaxFlatness ?? 0.65,
      harmonicMinDurationMs: prefs.harmonicMinDurationMs ?? 500,
    };
  }

  if (mode === "attack") {
    return {
      mode: "attack",
      channelCount,
      openFloorFactor,
      attackSensitivity,
      /** Claps / hits — refuse long sustains. */
      minDurationMs: 30,
      maxDurationMs: 1_800,
    };
  }

  return {
    mode: "attack",
    channelCount,
    openFloorFactor,
    attackSensitivity,
  };
}
