import { denormalizeNoise } from "./map.js";
import { normalizePeak, scheduleAdsr } from "./audio-util.js";
import type { NoiseNorm, NoisePhysical } from "./types.js";

export type RenderNoiseResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: NoisePhysical;
};

function fillNoise(
  buf: AudioBuffer,
  color: NoisePhysical["color"],
  density: number,
): void {
  const data = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  // density 1 = continuous; lower = sparse impulses
  const keepProb = 0.08 + density * 0.92;
  for (let i = 0; i < data.length; i++) {
    if (Math.random() > keepProb) {
      data[i] = 0;
      continue;
    }
    const white = Math.random() * 2 - 1;
    if (color === "white") {
      data[i] = white;
    } else if (color === "pink") {
      // Paul Kellet approx
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      data[i] = (b0 + b1 + b2 + white * 0.3) * 0.11;
    } else {
      // brown / red
      b0 = (b0 + 0.02 * white) / 1.02;
      data[i] = b0 * 3.5;
    }
  }
}

/**
 * Filtered noise bake: buffer → HP → LP → amp ADSR.
 */
export async function renderNoise(
  norm: NoiseNorm,
  opts?: { sampleRate?: number },
): Promise<RenderNoiseResult> {
  const physical = denormalizeNoise(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );

  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const noiseBuf = offline.createBuffer(1, frames, sampleRate);
  fillNoise(noiseBuf, physical.color, physical.density);

  const src = offline.createBufferSource();
  src.buffer = noiseBuf;

  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = Math.min(physical.hpHz, physical.lpHz * 0.9);
  hp.Q.value = 0.7;

  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.max(physical.lpHz, hp.frequency.value + 50);
  lp.Q.value = 0.7;

  // Extra color shaping
  if (physical.color === "brown") {
    lp.frequency.value = Math.min(lp.frequency.value, 800);
  } else if (physical.color === "pink") {
    lp.frequency.value = Math.min(lp.frequency.value, 6000);
  }

  const amp = offline.createGain();
  amp.gain.value = 0.0001;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(amp);
  amp.connect(offline.destination);

  const t0 = 0;
  const endTime = durationMs / 1000;
  scheduleAdsr(
    amp.gain,
    t0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    0.7,
    endTime,
  );

  src.start(t0);
  src.stop(frames / sampleRate);

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
