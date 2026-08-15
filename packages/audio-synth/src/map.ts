import {
  WAVE_SHAPES,
  type AdditiveNorm,
  type AdditivePhysical,
  type FmNorm,
  type FmPhysical,
  type GranularNorm,
  type GranularPhysical,
  type NoiseColor,
  type NoiseNorm,
  type NoisePhysical,
  type Norm01,
  type PhysicalExcitation,
  type PhysicalNorm,
  type PhysicalPhysical,
  type SubtractiveNorm,
  type SubtractivePhysical,
  type VoiceNorm,
  type VoicePhysical,
  type WaveShape,
} from "./types.js";

export function clamp01(n: number): Norm01 {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Log-lerp between positive a..b using t in 0–1. */
export function logLerp(a: number, b: number, t: number): number {
  const la = Math.log(Math.max(1e-9, a));
  const lb = Math.log(Math.max(1e-9, b));
  return Math.exp(lerp(la, lb, t));
}

export function waveFromNorm(n: Norm01): WaveShape {
  const i = Math.min(
    WAVE_SHAPES.length - 1,
    Math.floor(clamp01(n) * WAVE_SHAPES.length),
  );
  return WAVE_SHAPES[i] ?? "sawtooth";
}

export function waveToNorm(wave: WaveShape): Norm01 {
  const i = WAVE_SHAPES.indexOf(wave);
  if (i < 0) return 0.66;
  return (i + 0.5) / WAVE_SHAPES.length;
}

/** Map hz into fund 0–1 (20–2000 Hz log). */
export function hzToFundNorm(hz: number): Norm01 {
  const lo = 20;
  const hi = 2000;
  const c = Math.min(hi, Math.max(lo, hz));
  return clamp01((Math.log(c) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
}

export function fundNormToHz(n: Norm01): number {
  return logLerp(20, 2000, clamp01(n));
}

export function hzToCutoffNorm(hz: number): Norm01 {
  const lo = 80;
  const hi = 16_000;
  const c = Math.min(hi, Math.max(lo, hz));
  return clamp01((Math.log(c) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
}

export function cutoffNormToHz(n: Norm01): number {
  return logLerp(80, 16_000, clamp01(n));
}

export function msToDurationNorm(ms: number): Norm01 {
  const lo = 80;
  const hi = 4000;
  const c = Math.min(hi, Math.max(lo, ms));
  return clamp01((Math.log(c) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
}

export function durationNormToMs(n: Norm01): number {
  return logLerp(80, 4000, clamp01(n));
}

export function timeNormToSec(n: Norm01): number {
  return logLerp(0.002, 2, clamp01(n));
}

export function denormalizeSubtractive(n: SubtractiveNorm): SubtractivePhysical {
  return {
    wave: waveFromNorm(n.wave),
    fundHz: fundNormToHz(n.fund),
    detuneCents: lerp(-50, 50, clamp01(n.detune)),
    cutoffHz: cutoffNormToHz(n.cutoff),
    resoQ: lerp(0.2, 28, clamp01(n.reso)),
    filterAttackSec: timeNormToSec(n.filterAttack),
    filterDecaySec: timeNormToSec(n.filterDecay),
    filterSustain: clamp01(n.filterSustain),
    filterReleaseSec: timeNormToSec(n.filterRelease),
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    drive: clamp01(n.drive),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampNorm(n: SubtractiveNorm): SubtractiveNorm {
  return {
    wave: clamp01(n.wave),
    fund: clamp01(n.fund),
    detune: clamp01(n.detune),
    cutoff: clamp01(n.cutoff),
    reso: clamp01(n.reso),
    filterAttack: clamp01(n.filterAttack),
    filterDecay: clamp01(n.filterDecay),
    filterSustain: clamp01(n.filterSustain),
    filterRelease: clamp01(n.filterRelease),
    ampAttack: clamp01(n.ampAttack),
    ampDecay: clamp01(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampRelease: clamp01(n.ampRelease),
    drive: clamp01(n.drive),
    duration: clamp01(n.duration),
  };
}

/** Ratio 0.25–8 (log), index 0–12, feedback 0–0.85. */
export function denormalizeFm(n: FmNorm): FmPhysical {
  return {
    carrierHz: fundNormToHz(n.carrier),
    ratio: logLerp(0.25, 8, clamp01(n.ratio)),
    index: lerp(0, 12, clamp01(n.index)),
    modAttackSec: timeNormToSec(n.modAttack),
    modDecaySec: timeNormToSec(n.modDecay),
    modSustain: clamp01(n.modSustain),
    modReleaseSec: timeNormToSec(n.modRelease),
    feedback: clamp01(n.feedback) * 0.85,
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampFm(n: FmNorm): FmNorm {
  return {
    carrier: clamp01(n.carrier),
    ratio: clamp01(n.ratio),
    index: clamp01(n.index),
    modAttack: clamp01(n.modAttack),
    modDecay: clamp01(n.modDecay),
    modSustain: clamp01(n.modSustain),
    modRelease: clamp01(n.modRelease),
    feedback: clamp01(n.feedback),
    ampAttack: clamp01(n.ampAttack),
    ampDecay: clamp01(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampRelease: clamp01(n.ampRelease),
    duration: clamp01(n.duration),
  };
}

const NOISE_COLORS: readonly NoiseColor[] = ["white", "pink", "brown"];

export function noiseColorFromNorm(n: Norm01): NoiseColor {
  const i = Math.min(
    NOISE_COLORS.length - 1,
    Math.floor(clamp01(n) * NOISE_COLORS.length),
  );
  return NOISE_COLORS[i] ?? "white";
}

export function denormalizeNoise(n: NoiseNorm): NoisePhysical {
  return {
    color: noiseColorFromNorm(n.color),
    lpHz: cutoffNormToHz(n.lp),
    hpHz: logLerp(20, 4000, clamp01(n.hp)),
    density: clamp01(n.density),
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampNoise(n: NoiseNorm): NoiseNorm {
  return {
    color: clamp01(n.color),
    lp: clamp01(n.lp),
    hp: clamp01(n.hp),
    density: clamp01(n.density),
    ampAttack: clamp01(n.ampAttack),
    ampDecay: clamp01(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampRelease: clamp01(n.ampRelease),
    duration: clamp01(n.duration),
  };
}

export function denormalizeGranular(n: GranularNorm): GranularPhysical {
  return {
    densityHz: logLerp(2, 80, clamp01(n.density)),
    grainSec: logLerp(0.008, 0.18, clamp01(n.grainSize)),
    pitchRand: clamp01(n.pitchRand) * 0.5,
    position: clamp01(n.position),
    spraySec: logLerp(0.001, 0.08, clamp01(n.spray)),
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampGranular(n: GranularNorm): GranularNorm {
  const out = { ...n };
  for (const k of Object.keys(out) as (keyof GranularNorm)[]) {
    out[k] = clamp01(out[k]);
  }
  return out;
}

export function denormalizeAdditive(n: AdditiveNorm): AdditivePhysical {
  return {
    fundHz: fundNormToHz(n.fund),
    partials: Math.round(lerp(2, 24, clamp01(n.partials))),
    evenOdd: clamp01(n.evenOdd),
    /** 0–14¢ alternating detune for phasing (not partial stretch). */
    inharm: clamp01(n.inharm) * 14,
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampAdditive(n: AdditiveNorm): AdditiveNorm {
  const out = { ...n };
  for (const k of Object.keys(out) as (keyof AdditiveNorm)[]) {
    out[k] = clamp01(out[k]);
  }
  return out;
}

export function excitationFromNorm(n: Norm01): PhysicalExcitation {
  if (n < 0.34) return "strike";
  if (n < 0.67) return "blow";
  return "bow";
}

export function denormalizePhysical(n: PhysicalNorm): PhysicalPhysical {
  return {
    fundHz: fundNormToHz(n.length),
    stiffness: clamp01(n.stiffness),
    damping: lerp(0.995, 0.9998, 1 - clamp01(n.damping)),
    excitation: excitationFromNorm(n.excitation),
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampPhysical(n: PhysicalNorm): PhysicalNorm {
  const out = { ...n };
  for (const k of Object.keys(out) as (keyof PhysicalNorm)[]) {
    out[k] = clamp01(out[k]);
  }
  return out;
}

export function denormalizeVoice(n: VoiceNorm): VoicePhysical {
  return {
    fundHz: fundNormToHz(n.fund),
    f1Hz: logLerp(200, 900, clamp01(n.f1)),
    f2Hz: logLerp(600, 2200, clamp01(n.f2)),
    f3Hz: logLerp(1800, 3500, clamp01(n.f3)),
    voicing: clamp01(n.voicing),
    breath: clamp01(n.breath),
    ampAttackSec: timeNormToSec(n.ampAttack),
    ampDecaySec: timeNormToSec(n.ampDecay),
    ampSustain: clamp01(n.ampSustain),
    ampReleaseSec: timeNormToSec(n.ampRelease),
    durationMs: durationNormToMs(n.duration),
  };
}

export function clampVoice(n: VoiceNorm): VoiceNorm {
  const out = { ...n };
  for (const k of Object.keys(out) as (keyof VoiceNorm)[]) {
    out[k] = clamp01(out[k]);
  }
  return out;
}
