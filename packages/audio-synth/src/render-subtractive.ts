import { denormalizeSubtractive } from "./map.js";
import {
  normalizePeak,
  scheduleAdsr,
  softClipCurve,
} from "./audio-util.js";
import type { SubtractiveNorm, SubtractivePhysical } from "./types.js";

export type RenderSubtractiveResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: SubtractivePhysical;
};

/**
 * Bake a subtractive voice via OfflineAudioContext (osc → biquad → gain → soft clip).
 */
export async function renderSubtractive(
  norm: SubtractiveNorm,
  opts?: { sampleRate?: number },
): Promise<RenderSubtractiveResult> {
  const physical = denormalizeSubtractive(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );

  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const osc = offline.createOscillator();
  osc.type = physical.wave;
  osc.frequency.value = physical.fundHz;
  osc.detune.value = physical.detuneCents;

  const filter = offline.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = physical.resoQ;
  filter.frequency.value = physical.cutoffHz;

  const amp = offline.createGain();
  amp.gain.value = 0.0001;

  const shaper = offline.createWaveShaper();
  const curve = softClipCurve(physical.drive);
  shaper.curve = new Float32Array(curve);
  shaper.oversample = "2x";

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(shaper);
  shaper.connect(offline.destination);

  const t0 = 0;
  const endTime = durationMs / 1000;

  scheduleAdsr(
    amp.gain,
    t0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    0.85,
    endTime,
  );

  const baseCut = Math.max(80, physical.cutoffHz);
  const peakCut = Math.min(16_000, baseCut * (1.8 + physical.resoQ / 40));
  const fa = Math.max(0.001, physical.filterAttackSec);
  const fd = Math.max(0.001, physical.filterDecaySec);
  const fr = Math.max(0.001, physical.filterReleaseSec);
  const fSustain = baseCut + (peakCut - baseCut) * physical.filterSustain;
  const noteEnd = Math.max(t0 + fa + fd + 0.01, endTime - fr);
  filter.frequency.cancelScheduledValues(t0);
  filter.frequency.setValueAtTime(baseCut * 0.5, t0);
  filter.frequency.linearRampToValueAtTime(peakCut, t0 + fa);
  filter.frequency.linearRampToValueAtTime(fSustain, t0 + fa + fd);
  filter.frequency.setValueAtTime(fSustain, noteEnd);
  filter.frequency.linearRampToValueAtTime(baseCut * 0.5, noteEnd + fr);

  osc.start(t0);
  osc.stop(frames / sampleRate);

  const rendered = await offline.startRendering();
  const channel = rendered.getChannelData(0);
  const pcm = normalizePeak(new Float32Array(channel));

  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    physical,
  };
}
