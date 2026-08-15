import { denormalizeVoice } from "./map.js";
import { normalizePeak, scheduleAdsr } from "./audio-util.js";
import type { VoiceNorm, VoicePhysical } from "./types.js";

export type RenderVoiceResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: VoicePhysical;
};

function formant(
  ctx: OfflineAudioContext,
  input: AudioNode,
  freq: number,
  q: number,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  input.connect(f);
  return f;
}

/** Glottal pulse + breath through F1–F3 formants. */
export async function renderVoice(
  norm: VoiceNorm,
  opts?: { sampleRate?: number },
): Promise<RenderVoiceResult> {
  const physical = denormalizeVoice(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );
  const offline = new OfflineAudioContext(1, frames, sampleRate);

  const glottal = offline.createOscillator();
  glottal.type = "sawtooth";
  glottal.frequency.value = physical.fundHz;

  const breathBuf = offline.createBuffer(1, frames, sampleRate);
  const bd = breathBuf.getChannelData(0);
  for (let i = 0; i < frames; i++) bd[i] = Math.random() * 2 - 1;
  const breath = offline.createBufferSource();
  breath.buffer = breathBuf;

  const glottalGain = offline.createGain();
  glottalGain.gain.value = physical.voicing;
  const breathGain = offline.createGain();
  breathGain.gain.value = physical.breath * 0.35;

  glottal.connect(glottalGain);
  breath.connect(breathGain);

  const mix = offline.createGain();
  mix.gain.value = 1;
  glottalGain.connect(mix);
  breathGain.connect(mix);

  const f1 = formant(offline, mix, physical.f1Hz, 8);
  const f2 = formant(offline, mix, physical.f2Hz, 10);
  const f3 = formant(offline, mix, physical.f3Hz, 12);

  const sum = offline.createGain();
  sum.gain.value = 0.45;
  f1.connect(sum);
  f2.connect(sum);
  f3.connect(sum);

  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  sum.connect(amp);
  amp.connect(offline.destination);

  const endTime = durationMs / 1000;
  scheduleAdsr(
    amp.gain,
    0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    0.75,
    endTime,
  );

  const stopAt = frames / sampleRate;
  glottal.start(0);
  breath.start(0);
  glottal.stop(stopAt);
  breath.stop(stopAt);

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
