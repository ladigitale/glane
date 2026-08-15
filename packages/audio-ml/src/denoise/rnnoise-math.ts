import { resampleLinear } from "../resample.js";

/** RNNoise native rate (Xiph / @shiguredo/rnnoise-wasm). */
export const RNNOISE_SAMPLE_RATE = 48_000;
/** Default frame size when wasm is not yet loaded (480 @ 48 kHz = 10 ms). */
export const RNNOISE_FRAME_SIZE = 480;
/** Scale float −1…1 ↔ 16-bit PCM values RNNoise expects in Float32Array. */
export const RNNOISE_PCM_SCALE = 0x7fff;

/**
 * In-place: float −1…1 → 16-bit PCM scale for {@link DenoiseState.processFrame}.
 */
export function floatToRnnoisePcm(frame: Float32Array): void {
  for (let i = 0; i < frame.length; i++) {
    const x = frame[i] ?? 0;
    frame[i] = Math.max(-1, Math.min(1, x)) * RNNOISE_PCM_SCALE;
  }
}

/** In-place: 16-bit PCM scale → float −1…1. */
export function rnnoisePcmToFloat(frame: Float32Array): void {
  const inv = 1 / RNNOISE_PCM_SCALE;
  for (let i = 0; i < frame.length; i++) {
    frame[i] = (frame[i] ?? 0) * inv;
  }
}

export type RnnoiseFrameProcessor = {
  frameSize: number;
  /** Mutates `frame` (PCM-scaled) in place; returns VAD 0…1. */
  processFrame: (frame: Float32Array) => number;
};

/**
 * Denoise mono float PCM with an RNNoise-compatible frame processor.
 * Resamples to 48 kHz for inference, then back to `sampleRate`.
 */
export function denoiseMonoPcm(
  pcm: Float32Array,
  sampleRate: number,
  processor: RnnoiseFrameProcessor,
  opts?: { onProgress?: (ratio: number) => void },
): Float32Array {
  if (pcm.length === 0 || sampleRate <= 0) return new Float32Array(0);

  const at48 =
    sampleRate === RNNOISE_SAMPLE_RATE
      ? pcm.slice()
      : resampleLinear(pcm, sampleRate, RNNOISE_SAMPLE_RATE);

  const frameSize = processor.frameSize || RNNOISE_FRAME_SIZE;
  const nFrames = Math.ceil(at48.length / frameSize);
  const padded = new Float32Array(nFrames * frameSize);
  padded.set(at48);

  const frame = new Float32Array(frameSize);
  for (let f = 0; f < nFrames; f++) {
    const off = f * frameSize;
    frame.set(padded.subarray(off, off + frameSize));
    floatToRnnoisePcm(frame);
    processor.processFrame(frame);
    rnnoisePcmToFloat(frame);
    padded.set(frame, off);
    if (f % 32 === 0 || f === nFrames - 1) {
      opts?.onProgress?.(nFrames > 0 ? (f + 1) / nFrames : 1);
    }
  }

  const trimmed = padded.subarray(0, at48.length);
  if (sampleRate === RNNOISE_SAMPLE_RATE) return trimmed.slice();
  const back = resampleLinear(trimmed, RNNOISE_SAMPLE_RATE, sampleRate);
  return back.subarray(0, pcm.length);
}
