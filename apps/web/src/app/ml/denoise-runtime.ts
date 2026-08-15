/**
 * RNNoise offline denoise (runs inside denoise-worker).
 * Model: Xiph RNNoise via @shiguredo/rnnoise-wasm (Apache-2.0).
 */
import { denoiseMonoPcm } from "@glane/audio-ml";
import { clampChannelCount, toMonoPcm } from "@glane/audio-dsp";
import { Rnnoise } from "@shiguredo/rnnoise-wasm";

let rnnoisePromise: Promise<Rnnoise> | null = null;

async function getRnnoise(): Promise<Rnnoise> {
  if (!rnnoisePromise) rnnoisePromise = Rnnoise.load();
  return rnnoisePromise;
}

export type DenoiseResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
};

/**
 * Denoise interleaved PCM → mono float at the original sample rate.
 */
export async function runRnnoiseDenoise(
  pcm: Float32Array,
  sampleRate: number,
  channelCount: number,
  opts?: { onProgress?: (ratio: number) => void },
): Promise<DenoiseResult> {
  const ch = clampChannelCount(channelCount);
  const mono = toMonoPcm(pcm, ch);
  const engine = await getRnnoise();
  const state = engine.createDenoiseState();
  try {
    const out = denoiseMonoPcm(
      mono,
      sampleRate,
      {
        frameSize: engine.frameSize,
        processFrame: (frame) => state.processFrame(frame),
      },
      opts,
    );
    return { pcm: out, sampleRate, channelCount: 1 };
  } finally {
    state.destroy();
  }
}

/** Prefetch wasm (optional warm-up). */
export async function preloadRnnoise(): Promise<void> {
  await getRnnoise();
}
