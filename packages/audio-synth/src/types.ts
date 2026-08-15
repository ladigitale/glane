/** Engines planned in the product brief. */
export type SynthEngineId =
  | "subtractive"
  | "fm"
  | "granular"
  | "additive"
  | "physical"
  | "noise"
  | "voice";

export const SYNTH_ENGINE_IDS: readonly SynthEngineId[] = [
  "subtractive",
  "fm",
  "granular",
  "additive",
  "physical",
  "noise",
  "voice",
] as const;

/** Engines implemented with OfflineAudioContext bake. */
export const LIVE_ENGINES: readonly SynthEngineId[] = [
  "subtractive",
  "fm",
  "granular",
  "additive",
  "physical",
  "noise",
  "voice",
] as const;

export const MVP_ENGINE: SynthEngineId = "subtractive";

/** Normalized 0–1 UI / contract space. */
export type Norm01 = number;

export type WaveShape = "sine" | "triangle" | "sawtooth" | "square";

export const WAVE_SHAPES: readonly WaveShape[] = [
  "sine",
  "triangle",
  "sawtooth",
  "square",
] as const;

export type NoiseColor = "white" | "pink" | "brown";

/** Subtractive params in normalized 0–1 space. */
export type SubtractiveNorm = {
  wave: Norm01;
  fund: Norm01;
  detune: Norm01;
  cutoff: Norm01;
  reso: Norm01;
  filterAttack: Norm01;
  filterDecay: Norm01;
  filterSustain: Norm01;
  filterRelease: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  drive: Norm01;
  duration: Norm01;
};

export type SubtractiveKey = keyof SubtractiveNorm;

export const SUBTRACTIVE_KEYS: readonly SubtractiveKey[] = [
  "wave",
  "fund",
  "detune",
  "cutoff",
  "reso",
  "filterAttack",
  "filterDecay",
  "filterSustain",
  "filterRelease",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "drive",
  "duration",
] as const;

export type SubtractivePhysical = {
  wave: WaveShape;
  fundHz: number;
  detuneCents: number;
  cutoffHz: number;
  resoQ: number;
  filterAttackSec: number;
  filterDecaySec: number;
  filterSustain: number;
  filterReleaseSec: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  drive: number;
  durationMs: number;
};

/** FM 2-op contract (0–1). */
export type FmNorm = {
  carrier: Norm01;
  ratio: Norm01;
  index: Norm01;
  modAttack: Norm01;
  modDecay: Norm01;
  modSustain: Norm01;
  modRelease: Norm01;
  feedback: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};

export type FmKey = keyof FmNorm;

export const FM_KEYS: readonly FmKey[] = [
  "carrier",
  "ratio",
  "index",
  "modAttack",
  "modDecay",
  "modSustain",
  "modRelease",
  "feedback",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;

export type FmPhysical = {
  carrierHz: number;
  ratio: number;
  index: number;
  modAttackSec: number;
  modDecaySec: number;
  modSustain: number;
  modReleaseSec: number;
  feedback: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};

/** Filtered noise contract (0–1). */
export type NoiseNorm = {
  color: Norm01;
  lp: Norm01;
  hp: Norm01;
  density: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};

export type NoiseKey = keyof NoiseNorm;

export const NOISE_KEYS: readonly NoiseKey[] = [
  "color",
  "lp",
  "hp",
  "density",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;

export type NoisePhysical = {
  color: NoiseColor;
  lpHz: number;
  hpHz: number;
  density: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};

export type RangeMode = "add" | "mul";

export type ParamRange = {
  min: Norm01;
  max: Norm01;
  mode: RangeMode;
};

export type SubtractiveRanges = Record<SubtractiveKey, ParamRange>;
export type FmRanges = Record<FmKey, ParamRange>;
export type NoiseRanges = Record<NoiseKey, ParamRange>;

/** Granular (0–1). */
export type GranularNorm = {
  density: Norm01;
  grainSize: Norm01;
  pitchRand: Norm01;
  position: Norm01;
  spray: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};
export type GranularKey = keyof GranularNorm;
export const GRANULAR_KEYS: readonly GranularKey[] = [
  "density",
  "grainSize",
  "pitchRand",
  "position",
  "spray",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;
export type GranularPhysical = {
  densityHz: number;
  grainSec: number;
  pitchRand: number;
  position: number;
  spraySec: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};
export type GranularRanges = Record<GranularKey, ParamRange>;

/** Additive harmonics (0–1). */
export type AdditiveNorm = {
  fund: Norm01;
  partials: Norm01;
  evenOdd: Norm01;
  /** 0 = pure harmonics; higher = light ±detune phasing between partials. */
  inharm: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};
export type AdditiveKey = keyof AdditiveNorm;
export const ADDITIVE_KEYS: readonly AdditiveKey[] = [
  "fund",
  "partials",
  "evenOdd",
  "inharm",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;
export type AdditivePhysical = {
  fundHz: number;
  partials: number;
  evenOdd: number;
  /** Alternating detune in cents for phasing (±); 0 = pure harmonics. */
  inharm: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};
export type AdditiveRanges = Record<AdditiveKey, ParamRange>;

/** Karplus-Strong-ish physical (0–1). */
export type PhysicalNorm = {
  length: Norm01;
  stiffness: Norm01;
  damping: Norm01;
  excitation: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};
export type PhysicalKey = keyof PhysicalNorm;
export const PHYSICAL_KEYS: readonly PhysicalKey[] = [
  "length",
  "stiffness",
  "damping",
  "excitation",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;
export type PhysicalExcitation = "strike" | "blow" | "bow";
export type PhysicalPhysical = {
  fundHz: number;
  stiffness: number;
  damping: number;
  excitation: PhysicalExcitation;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};
export type PhysicalRanges = Record<PhysicalKey, ParamRange>;

/** Formant voice (0–1). */
export type VoiceNorm = {
  fund: Norm01;
  f1: Norm01;
  f2: Norm01;
  f3: Norm01;
  voicing: Norm01;
  breath: Norm01;
  ampAttack: Norm01;
  ampDecay: Norm01;
  ampSustain: Norm01;
  ampRelease: Norm01;
  duration: Norm01;
};
export type VoiceKey = keyof VoiceNorm;
export const VOICE_KEYS: readonly VoiceKey[] = [
  "fund",
  "f1",
  "f2",
  "f3",
  "voicing",
  "breath",
  "ampAttack",
  "ampDecay",
  "ampSustain",
  "ampRelease",
  "duration",
] as const;
export type VoicePhysical = {
  fundHz: number;
  f1Hz: number;
  f2Hz: number;
  f3Hz: number;
  voicing: number;
  breath: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  durationMs: number;
};
export type VoiceRanges = Record<VoiceKey, ParamRange>;

export type SynthMode = "variations" | "family" | "song";

export type SynthRoleId =
  | "pivot"
  | "kick"
  | "snare"
  | "hat"
  | "perc"
  | "bass"
  | "pad"
  | "lead"
  | "arp"
  | "fx"
  | "texture";

export const FAMILY_ROLE_IDS: readonly SynthRoleId[] = [
  "kick",
  "snare",
  "hat",
  "perc",
  "bass",
  "pad",
  "lead",
  "arp",
  "fx",
  "texture",
] as const;

export type ArpMeta = {
  pattern: "up" | "down" | "upDown" | "sequence";
  bars: 1 | 2 | 4 | 8;
  division: 8 | 16;
  form?: "AAAA" | "ABAB" | "AABA" | "ABAC" | "AABB" | "ABCD";
  motifs?: number[];
  lfos?: Array<{
    target: "cutoff" | "gate" | "velocity" | "octave";
    shape: "sine" | "triangle" | "square" | "saw";
    rate: number;
    depth: number;
    phase: number;
  }>;
};

export type SynthMeta = {
  mode: SynthMode;
  seed: number;
  engines: SynthEngineId[];
  /** Primary engine tag (first enabled). */
  engine: SynthEngineId;
  role?: SynthRoleId;
  /** Semantic machine knobs when baked via role synthesizer. */
  machine?: Partial<Record<string, number>>;
  /** True when DSP used a dedicated role recipe (not free engines). */
  roleSynth?: boolean;
  coherence?: "parametric" | "musical";
  tonicPc?: number;
  bpm?: number;
  freeFmRatios?: boolean;
  intention?: string;
  subtractive?: { params: SubtractiveNorm; physical: SubtractivePhysical };
  fm?: { params: FmNorm; physical: FmPhysical };
  noise?: { params: NoiseNorm; physical: NoisePhysical };
  granular?: { params: GranularNorm; physical: GranularPhysical };
  additive?: { params: AdditiveNorm; physical: AdditivePhysical };
  physicalModel?: { params: PhysicalNorm; physical: PhysicalPhysical };
  voice?: { params: VoiceNorm; physical: VoicePhysical };
  /** Baked arpeggio phrase (role === arp). */
  arp?: ArpMeta;
  /** Convenience for analysis / UI. */
  fundHz?: number;
  cutoffHz?: number;
  referentId?: string;
};

export const DEFAULT_SUBTRACTIVE_NORM: SubtractiveNorm = {
  wave: 0.66,
  fund: 0.45,
  detune: 0.5,
  cutoff: 0.55,
  reso: 0.25,
  filterAttack: 0.15,
  filterDecay: 0.35,
  filterSustain: 0.4,
  filterRelease: 0.4,
  ampAttack: 0.08,
  ampDecay: 0.3,
  ampSustain: 0.55,
  ampRelease: 0.45,
  drive: 0.15,
  duration: 0.35,
};

export const DEFAULT_FM_NORM: FmNorm = {
  carrier: 0.45,
  ratio: 0.45,
  index: 0.35,
  modAttack: 0.1,
  modDecay: 0.4,
  modSustain: 0.35,
  modRelease: 0.45,
  feedback: 0.15,
  ampAttack: 0.08,
  ampDecay: 0.3,
  ampSustain: 0.5,
  ampRelease: 0.45,
  duration: 0.35,
};

export const DEFAULT_NOISE_NORM: NoiseNorm = {
  color: 0.35,
  lp: 0.55,
  hp: 0.15,
  density: 0.7,
  ampAttack: 0.05,
  ampDecay: 0.35,
  ampSustain: 0.45,
  ampRelease: 0.4,
  duration: 0.4,
};

export const DEFAULT_GRANULAR_NORM: GranularNorm = {
  density: 0.45,
  grainSize: 0.4,
  pitchRand: 0.25,
  position: 0.3,
  spray: 0.35,
  ampAttack: 0.15,
  ampDecay: 0.35,
  ampSustain: 0.55,
  ampRelease: 0.5,
  duration: 0.55,
};

export const DEFAULT_ADDITIVE_NORM: AdditiveNorm = {
  fund: 0.45,
  partials: 0.45,
  evenOdd: 0.5,
  inharm: 0.15,
  ampAttack: 0.12,
  ampDecay: 0.35,
  ampSustain: 0.6,
  ampRelease: 0.5,
  duration: 0.5,
};

export const DEFAULT_PHYSICAL_NORM: PhysicalNorm = {
  length: 0.4,
  stiffness: 0.35,
  damping: 0.45,
  excitation: 0.2,
  ampAttack: 0.05,
  ampDecay: 0.4,
  ampSustain: 0.35,
  ampRelease: 0.55,
  duration: 0.5,
};

export const DEFAULT_VOICE_NORM: VoiceNorm = {
  fund: 0.4,
  f1: 0.35,
  f2: 0.5,
  f3: 0.65,
  voicing: 0.75,
  breath: 0.2,
  ampAttack: 0.15,
  ampDecay: 0.3,
  ampSustain: 0.65,
  ampRelease: 0.45,
  duration: 0.55,
};
