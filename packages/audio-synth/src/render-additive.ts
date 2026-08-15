import { denormalizeAdditive } from "./map.js";
import { normalizePeak, scheduleAdsr } from "./audio-util.js";
import type { AdditiveNorm, AdditivePhysical } from "./types.js";

export type RenderAdditiveResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: AdditivePhysical;
};

/** Weighted harmonic stack. */
export async function renderAdditive(
  norm: AdditiveNorm,
  opts?: { sampleRate?: number },
): Promise<RenderAdditiveResult> {
  const physical = denormalizeAdditive(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const mix = offline.createGain();
  mix.gain.value = 1;
  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  mix.connect(amp);
  amp.connect(offline.destination);

  const n = Math.max(2, physical.partials);
  const evenBias = physical.evenOdd;
  const phaseCents = physical.inharm;
  for (let i = 1; i <= n; i++) {
    const osc = offline.createOscillator();
    osc.type = "sine";
    // Integer harmonics only — natural spectrum; inharm = ±cents phasing
    osc.frequency.value = physical.fundHz * i;
    osc.detune.value = (i % 2 === 0 ? 1 : -1) * phaseCents;
    const g = offline.createGain();
    const odd = i % 2 === 1;
    const weight = odd ? 1 - evenBias * 0.7 : evenBias;
    g.gain.value = (weight / i) * 0.45;
    osc.connect(g);
    g.connect(mix);
    osc.start(0);
    osc.stop(frames / sampleRate);
  }

  const endTime = durationMs / 1000;
  scheduleAdsr(
    amp.gain,
    0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    0.8,
    endTime,
  );

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    physical,
  };
}
