/**
 * Close the gap to the UI playhead in this many seconds (servo).
 * Smaller = snappier catch-up when the pointer stops far from audio.
 */
export const TAPE_SCRUB_CATCHUP_S = 0.028;

/** |error| below this → rate 0 (arrived at target). */
export const TAPE_SCRUB_SNAP_SAMPLES = 48;

/** Soft-resync only on catastrophic drift (buffer change / desync). */
export const TAPE_SCRUB_DRIFT_SAMPLES = 48_000;

/** Treat |rate| below this as stopped. */
export const TAPE_SCRUB_RATE_EPS = 1e-4;

/** Short fades — start / stop / hard resync only. */
export const TAPE_SCRUB_FADE_IN_S = 0.006;
export const TAPE_SCRUB_FADE_OUT_S = 0.01;

/**
 * Playback rate to close `errorSamples` (target − audio) in `catchupSec`.
 * No max clamp — large jumps → large |rate|.
 * +error → forward, −error → reverse.
 */
export function scrubRateToTarget(
  errorSamples: number,
  sampleRate: number,
  catchupSec = TAPE_SCRUB_CATCHUP_S,
  snapSamples = TAPE_SCRUB_SNAP_SAMPLES,
): number {
  if (!(sampleRate > 0) || !(catchupSec > 0) || !Number.isFinite(errorSamples)) {
    return 0;
  }
  if (Math.abs(errorSamples) <= snapSamples) return 0;
  const rate = errorSamples / (sampleRate * catchupSec);
  return Number.isFinite(rate) ? rate : 0;
}

export type TapeScrubVoice = {
  /** Stable id (clip id / "edit") — reused across scrub frames. */
  key: string;
  buffer: AudioBuffer;
  /** UI target — buffer-relative sample the tape should reach. */
  sample: number;
  gain?: number;
  trackId?: string;
  /** Clip pitch multiplier on top of scrub rate. Default 1. */
  pitchRate?: number;
  /** Optional loop region (seconds into buffer) for spin / turntable. */
  loopStartSec?: number;
  loopEndSec?: number;
};
