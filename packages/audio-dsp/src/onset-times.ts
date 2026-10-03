import { DSP_THRESHOLDS } from "./config/thresholds.js";
import { clampChannelCount, toMonoPcm } from "./pcm-layout.js";

/**
 * Offline envelope onsets → times in seconds (attacks).
 * Cheap RMS + relative jump; enough to seed a 16th-grid RhythmGene.
 */
export function detectOnsetTimesSec(
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
): number[] {
  if (sampleRate <= 0 || pcm.length === 0) return [];
  const mono = toMonoPcm(pcm, clampChannelCount(channelCount));
  const hop = DSP_THRESHOLDS.hopSize;
  if (mono.length < hop * 4) return [];

  const env: number[] = [];
  let peak = 0;
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
  if (peak < 1e-6) return [];

  const floor = peak * 0.1;
  const guardFrames = Math.max(
    2,
    Math.round((DSP_THRESHOLDS.onsetGuardMs / 1000) * (sampleRate / hop)),
  );
  const times: number[] = [];
  let last = -guardFrames;
  let prev = 0;
  for (let i = 0; i < env.length; i++) {
    const cur = env[i] ?? 0;
    const rising = cur > floor && (prev <= floor || cur > prev * 1.65);
    if (rising && i - last >= guardFrames) {
      times.push((i * hop) / sampleRate);
      last = i;
    }
    prev = cur;
  }
  return times;
}
