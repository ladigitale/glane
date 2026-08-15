import { denormalizeGranular } from "./map.js";
import { normalizePeak, scheduleAdsr } from "./audio-util.js";
import type { GranularNorm, GranularPhysical } from "./types.js";

export type RenderGranularResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: GranularPhysical;
};

function makeSourceBuffer(
  ctx: OfflineAudioContext,
  frames: number,
): AudioBuffer {
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let phase = 0;
  const freq = 110;
  for (let i = 0; i < frames; i++) {
    phase += (Math.PI * 2 * freq) / ctx.sampleRate;
    const saw = ((phase % (Math.PI * 2)) / Math.PI) - 1;
    d[i] = saw * 0.7 + (Math.random() * 2 - 1) * 0.3;
  }
  return buf;
}

/** Overlapping grains from a synthetic source buffer. */
export async function renderGranular(
  norm: GranularNorm,
  opts?: { sampleRate?: number },
): Promise<RenderGranularResult> {
  const physical = denormalizeGranular(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(60, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const srcLen = Math.max(sampleRate, Math.floor(sampleRate * 1.5));
  const source = makeSourceBuffer(offline, srcLen);

  const master = offline.createGain();
  master.gain.value = 0.0001;
  master.connect(offline.destination);

  const t0 = 0;
  const endTime = durationMs / 1000;
  scheduleAdsr(
    master.gain,
    t0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    0.7,
    endTime,
  );

  const interval = 1 / Math.max(1, physical.densityHz);
  const grainFrames = Math.max(32, Math.floor(physical.grainSec * sampleRate));
  let t = 0;
  let guard = 0;
  while (t < endTime && guard < 400) {
    guard++;
    const spray = (Math.random() * 2 - 1) * physical.spraySec;
    const start = Math.max(0, t + spray);
    const pos = Math.floor(
      physical.position * (srcLen - grainFrames - 1) * Math.random() * 0.5 +
        physical.position * (srcLen - grainFrames - 1) * 0.5,
    );
    const rate = 1 + (Math.random() * 2 - 1) * physical.pitchRand;
    const g = offline.createBufferSource();
    g.buffer = source;
    g.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const env = offline.createGain();
    env.gain.value = 0;
    g.connect(env);
    env.connect(master);
    const half = physical.grainSec * 0.5;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(0.35, start + half);
    env.gain.linearRampToValueAtTime(0.0001, start + physical.grainSec);
    g.start(start, Math.max(0, pos) / sampleRate, physical.grainSec);
    t += interval;
  }

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
