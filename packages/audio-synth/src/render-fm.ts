import { denormalizeFm } from "./map.js";
import { normalizePeak, scheduleAdsr } from "./audio-util.js";
import type { FmNorm, FmPhysical } from "./types.js";

export type RenderFmResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: FmPhysical;
};

export type RenderFmOpts = {
  sampleRate?: number;
  /**
   * When mixed with other pitched engines, force integer c:m, lower index /
   * feedback so sidebands stay consonant with harmonic companions.
   */
  layered?: boolean;
};

/** Soft-snap ratio toward integer harmonics (matches render-arp). */
function resolveFmRatio(rawRatio: number, layered: boolean): number {
  const raw = Math.max(0.25, rawRatio);
  const harmonic = Math.max(1, Math.round(raw));
  if (layered) return harmonic;
  return Math.abs(raw - harmonic) < 0.35 ? harmonic : raw;
}

/**
 * 2-op FM bake: modulator → carrier.frequency, optional feedback into modulator.
 */
export async function renderFm(
  norm: FmNorm,
  opts?: RenderFmOpts,
): Promise<RenderFmResult> {
  const physical = denormalizeFm(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const layered = opts?.layered === true;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) +
      Math.ceil(physical.ampReleaseSec * sampleRate),
  );

  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const carrierHz = physical.carrierHz;
  const ratio = resolveFmRatio(physical.ratio, layered);
  const modHz = carrierHz * ratio;

  const carrier = offline.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = carrierHz;

  const modulator = offline.createOscillator();
  modulator.type = "sine";
  modulator.frequency.value = modHz;

  const modIndex = offline.createGain();
  // Peak deviation in Hz ≈ index * carrier (classic FM depth scaling)
  modIndex.gain.value = 0.0001;

  const amp = offline.createGain();
  amp.gain.value = 0.0001;

  modulator.connect(modIndex);
  modIndex.connect(carrier.frequency);

  // Feedback: keep mild (aligned with render-arp) — strong fb → inharmonic mush
  const feedbackScale = layered ? 0.08 : 0.35;
  const feedbackAmt = physical.feedback * feedbackScale;
  if (feedbackAmt > 0.001) {
    const fb = offline.createGain();
    fb.gain.value = feedbackAmt * modHz * 0.25;
    carrier.connect(fb);
    fb.connect(modulator.frequency);
  }

  carrier.connect(amp);
  amp.connect(offline.destination);

  const t0 = 0;
  const endTime = durationMs / 1000;
  const indexScale = layered ? 0.22 : 0.55;
  const peakDev = Math.max(1, physical.index * indexScale * carrierHz);
  const ampPeak = layered ? 0.55 : 0.75;

  scheduleAdsr(
    modIndex.gain,
    t0,
    physical.modAttackSec,
    physical.modDecaySec,
    physical.modSustain,
    physical.modReleaseSec,
    peakDev,
    endTime,
  );

  scheduleAdsr(
    amp.gain,
    t0,
    physical.ampAttackSec,
    physical.ampDecaySec,
    physical.ampSustain,
    physical.ampReleaseSec,
    ampPeak,
    endTime,
  );

  const stopAt = frames / sampleRate;
  modulator.start(t0);
  carrier.start(t0);
  modulator.stop(stopAt);
  carrier.stop(stopAt);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));

  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    physical: { ...physical, ratio },
  };
}
