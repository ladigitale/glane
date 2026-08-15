import { clamp01 } from "./map.js";
import type {
  AdditiveNorm,
  FmNorm,
  GranularNorm,
  NoiseNorm,
  Norm01,
  PhysicalNorm,
  SubtractiveNorm,
  SynthRoleId,
  VoiceNorm,
} from "./types.js";

/** Semantic knobs for Family / Song role cards (UI façade). */
export type MachineKnobId =
  | "body"
  | "punch"
  | "click"
  | "length"
  | "snare"
  | "tone"
  | "brightness"
  | "open"
  | "metal"
  | "decay"
  | "pitch"
  | "growl"
  | "warmth"
  | "space"
  | "attack"
  | "bite"
  | "glide"
  | "gate"
  | "sparkle"
  | "chaos"
  | "breath"
  | "grain"
  | "vowel"
  | "gender"
  /** Classic biquad type (0–1 → discrete). */
  | "filtType"
  | "filtAtk"
  | "filtDec"
  | "filtSus"
  | "filtRel"
  /** Filter envelope amount (0 = bypass). */
  | "filtEnv";

export type MachineParams = Partial<Record<MachineKnobId, Norm01>>;

export type MachineKnobSpec = {
  id: MachineKnobId;
  /** Neutral centre (usually 0.5). */
  default: Norm01;
};

export type MachineSpec = {
  role: Exclude<SynthRoleId, "pivot">;
  knobs: readonly MachineKnobSpec[];
};

/** Classic Web Audio biquad types offered on every role machine. */
export const MACHINE_FILTER_TYPES = [
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "peaking",
] as const;
export type MachineFilterType = (typeof MACHINE_FILTER_TYPES)[number];

/** Shared filter + ADSR knobs appended to every Family role. */
export const MACHINE_FILTER_KNOBS: readonly MachineKnobSpec[] = [
  { id: "filtType", default: 0.1 },
  { id: "filtAtk", default: 0.12 },
  { id: "filtDec", default: 0.35 },
  { id: "filtSus", default: 0.45 },
  { id: "filtRel", default: 0.4 },
  { id: "filtEnv", default: 0.55 },
] as const;

export const MACHINE_FILTER_KNOB_IDS: readonly MachineKnobId[] =
  MACHINE_FILTER_KNOBS.map((k) => k.id);

export function isMachineFilterKnob(id: MachineKnobId): boolean {
  return (MACHINE_FILTER_KNOB_IDS as readonly string[]).includes(id);
}

export function filterTypeFromNorm(n: Norm01): MachineFilterType {
  const i = Math.min(
    MACHINE_FILTER_TYPES.length - 1,
    Math.floor(clamp01(n) * MACHINE_FILTER_TYPES.length),
  );
  return MACHINE_FILTER_TYPES[i] ?? "lowpass";
}

export function filterTypeToNorm(type: MachineFilterType): Norm01 {
  const i = MACHINE_FILTER_TYPES.indexOf(type);
  if (i < 0) return 0.1;
  return (i + 0.5) / MACHINE_FILTER_TYPES.length;
}

function withFilterKnobs(
  knobs: readonly MachineKnobSpec[],
): readonly MachineKnobSpec[] {
  return [...knobs, ...MACHINE_FILTER_KNOBS];
}

export type RolePivots = {
  pivot: SubtractiveNorm;
  pivotFm: FmNorm;
  pivotNoise: NoiseNorm;
  pivotGranular: GranularNorm;
  pivotAdditive: AdditiveNorm;
  pivotPhysical: PhysicalNorm;
  pivotVoice: VoiceNorm;
};

const MACHINE_SPECS: Record<Exclude<SynthRoleId, "pivot">, MachineSpec> = {
  kick: {
    role: "kick",
    knobs: withFilterKnobs([
      { id: "body", default: 0.5 },
      { id: "punch", default: 0.5 },
      { id: "click", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  snare: {
    role: "snare",
    knobs: withFilterKnobs([
      { id: "body", default: 0.5 },
      { id: "snare", default: 0.5 },
      { id: "tone", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  hat: {
    role: "hat",
    knobs: withFilterKnobs([
      { id: "brightness", default: 0.5 },
      { id: "open", default: 0.5 },
      { id: "metal", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  perc: {
    role: "perc",
    knobs: withFilterKnobs([
      { id: "tone", default: 0.5 },
      { id: "click", default: 0.5 },
      { id: "decay", default: 0.5 },
      { id: "pitch", default: 0.5 },
    ]),
  },
  bass: {
    role: "bass",
    knobs: withFilterKnobs([
      { id: "tone", default: 0.5 },
      { id: "growl", default: 0.5 },
      { id: "warmth", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  pad: {
    role: "pad",
    knobs: withFilterKnobs([
      { id: "brightness", default: 0.5 },
      { id: "space", default: 0.5 },
      { id: "attack", default: 0.5 },
      { id: "warmth", default: 0.5 },
    ]),
  },
  lead: {
    role: "lead",
    knobs: withFilterKnobs([
      { id: "bite", default: 0.5 },
      { id: "brightness", default: 0.5 },
      { id: "glide", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  arp: {
    role: "arp",
    knobs: withFilterKnobs([
      { id: "brightness", default: 0.5 },
      { id: "gate", default: 0.5 },
      { id: "sparkle", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  fx: {
    role: "fx",
    knobs: withFilterKnobs([
      { id: "chaos", default: 0.5 },
      { id: "brightness", default: 0.5 },
      { id: "space", default: 0.5 },
      { id: "length", default: 0.5 },
    ]),
  },
  texture: {
    role: "texture",
    knobs: withFilterKnobs([
      { id: "breath", default: 0.5 },
      { id: "grain", default: 0.5 },
      { id: "space", default: 0.5 },
      { id: "brightness", default: 0.5 },
    ]),
  },
};

/** Knob list for a family role (empty for pivot). */
export function machineSpecFor(
  role: SynthRoleId,
): MachineSpec | null {
  if (role === "pivot") return null;
  return MACHINE_SPECS[role];
}

export function defaultMachineParams(
  role: SynthRoleId,
): MachineParams {
  const spec = machineSpecFor(role);
  if (!spec) return {};
  const out: MachineParams = {};
  for (const k of spec.knobs) out[k.id] = k.default;
  return out;
}

export function clampMachineParams(
  role: SynthRoleId,
  machine: MachineParams,
): MachineParams {
  const spec = machineSpecFor(role);
  if (!spec) return {};
  const out: MachineParams = {};
  for (const k of spec.knobs) {
    out[k.id] = clamp01(machine[k.id] ?? k.default);
  }
  return out;
}

function kn(m: MachineParams, id: MachineKnobId, fallback = 0.5): Norm01 {
  return clamp01(m[id] ?? fallback);
}

/** n=0.5 → base; n=1 → base+amt; n=0 → base−amt. */
function nudge(base: number, n: Norm01, amt: number): Norm01 {
  return clamp01(base + (n - 0.5) * 2 * amt);
}

function clonePivots(base: RolePivots): RolePivots {
  return {
    pivot: { ...base.pivot },
    pivotFm: { ...base.pivotFm },
    pivotNoise: { ...base.pivotNoise },
    pivotGranular: { ...base.pivotGranular },
    pivotAdditive: { ...base.pivotAdditive },
    pivotPhysical: { ...base.pivotPhysical },
    pivotVoice: { ...base.pivotVoice },
  };
}

/**
 * Map semantic machine knobs onto role preset pivots.
 * Neutral knobs (0.5) leave the preset unchanged.
 */
export function bakeMachine(
  role: SynthRoleId,
  machineIn: MachineParams,
  base: RolePivots,
): RolePivots {
  if (role === "pivot") return clonePivots(base);
  const m = clampMachineParams(role, machineIn);
  const out = clonePivots(base);
  const s = out.pivot;
  const f = out.pivotFm;
  const n = out.pivotNoise;
  const g = out.pivotGranular;
  const a = out.pivotAdditive;
  const p = out.pivotPhysical;
  const v = out.pivotVoice;

  switch (role) {
    case "kick": {
      const body = kn(m, "body");
      const punch = kn(m, "punch");
      const click = kn(m, "click");
      const length = kn(m, "length");
      s.fund = nudge(s.fund, body, 0.12);
      s.cutoff = nudge(s.cutoff, body, -0.1);
      s.wave = nudge(s.wave, body, -0.15);
      s.drive = nudge(s.drive, punch, 0.25);
      s.ampAttack = nudge(s.ampAttack, punch, -0.08);
      s.ampDecay = nudge(s.ampDecay, punch, -0.2);
      s.ampSustain = nudge(s.ampSustain, punch, -0.1);
      n.density = nudge(n.density, click, 0.35);
      n.hp = nudge(n.hp, click, 0.2);
      n.lp = nudge(n.lp, click, 0.15);
      n.ampAttack = nudge(n.ampAttack, click, -0.05);
      s.duration = nudge(s.duration, length, 0.18);
      s.ampRelease = nudge(s.ampRelease, length, 0.2);
      n.duration = nudge(n.duration, length, 0.15);
      break;
    }
    case "snare": {
      const body = kn(m, "body");
      const snare = kn(m, "snare");
      const tone = kn(m, "tone");
      const length = kn(m, "length");
      s.fund = nudge(s.fund, body, 0.1);
      s.cutoff = nudge(s.cutoff, body, 0.08);
      s.drive = nudge(s.drive, body, 0.12);
      n.density = nudge(n.density, snare, 0.3);
      n.color = nudge(n.color, snare, -0.2);
      n.hp = nudge(n.hp, snare, 0.15);
      s.cutoff = nudge(s.cutoff, tone, 0.18);
      n.lp = nudge(n.lp, tone, 0.2);
      s.duration = nudge(s.duration, length, 0.16);
      n.duration = nudge(n.duration, length, 0.16);
      s.ampDecay = nudge(s.ampDecay, length, 0.15);
      n.ampDecay = nudge(n.ampDecay, length, 0.15);
      break;
    }
    case "hat": {
      const brightness = kn(m, "brightness");
      const open = kn(m, "open");
      const metal = kn(m, "metal");
      const length = kn(m, "length");
      n.lp = nudge(n.lp, brightness, 0.25);
      n.hp = nudge(n.hp, brightness, 0.12);
      n.color = nudge(n.color, brightness, -0.2);
      n.ampSustain = nudge(n.ampSustain, open, 0.2);
      n.ampRelease = nudge(n.ampRelease, open, 0.25);
      n.duration = nudge(n.duration, open, 0.2);
      n.density = nudge(n.density, metal, 0.15);
      n.hp = nudge(n.hp, metal, 0.1);
      n.duration = nudge(n.duration, length, 0.12);
      s.duration = nudge(s.duration, length, 0.1);
      break;
    }
    case "perc": {
      const tone = kn(m, "tone");
      const click = kn(m, "click");
      const decay = kn(m, "decay");
      const pitch = kn(m, "pitch");
      s.cutoff = nudge(s.cutoff, tone, 0.2);
      n.lp = nudge(n.lp, tone, 0.18);
      n.density = nudge(n.density, click, 0.25);
      n.hp = nudge(n.hp, click, 0.15);
      s.ampAttack = nudge(s.ampAttack, click, -0.06);
      s.ampDecay = nudge(s.ampDecay, decay, 0.22);
      n.ampDecay = nudge(n.ampDecay, decay, 0.2);
      s.duration = nudge(s.duration, decay, 0.15);
      s.fund = nudge(s.fund, pitch, 0.18);
      break;
    }
    case "bass": {
      const tone = kn(m, "tone");
      const growl = kn(m, "growl");
      const warmth = kn(m, "warmth");
      const length = kn(m, "length");
      s.cutoff = nudge(s.cutoff, tone, 0.2);
      f.index = nudge(f.index, tone, 0.15);
      f.index = nudge(f.index, growl, 0.25);
      f.ratio = nudge(f.ratio, growl, 0.12);
      s.drive = nudge(s.drive, growl, 0.2);
      s.wave = nudge(s.wave, growl, 0.15);
      s.cutoff = nudge(s.cutoff, warmth, -0.12);
      s.fund = nudge(s.fund, warmth, -0.06);
      s.duration = nudge(s.duration, length, 0.18);
      f.duration = nudge(f.duration, length, 0.18);
      s.ampRelease = nudge(s.ampRelease, length, 0.15);
      break;
    }
    case "pad": {
      const brightness = kn(m, "brightness");
      const space = kn(m, "space");
      const attack = kn(m, "attack");
      const warmth = kn(m, "warmth");
      s.cutoff = nudge(s.cutoff, brightness, 0.22);
      f.index = nudge(f.index, brightness, 0.12);
      a.partials = nudge(a.partials, brightness, 0.2);
      s.ampRelease = nudge(s.ampRelease, space, 0.2);
      s.duration = nudge(s.duration, space, 0.15);
      s.detune = nudge(s.detune, space, 0.2);
      s.ampAttack = nudge(s.ampAttack, attack, 0.25);
      f.ampAttack = nudge(f.ampAttack, attack, 0.22);
      s.cutoff = nudge(s.cutoff, warmth, -0.12);
      s.reso = nudge(s.reso, warmth, -0.08);
      p.damping = nudge(p.damping, warmth, 0.15);
      p.length = nudge(p.length, space, 0.1);
      break;
    }
    case "lead": {
      const bite = kn(m, "bite");
      const brightness = kn(m, "brightness");
      const glide = kn(m, "glide");
      const length = kn(m, "length");
      f.index = nudge(f.index, bite, 0.28);
      f.feedback = nudge(f.feedback, bite, 0.2);
      s.drive = nudge(s.drive, bite, 0.15);
      s.cutoff = nudge(s.cutoff, brightness, 0.2);
      f.ratio = nudge(f.ratio, brightness, 0.1);
      s.ampAttack = nudge(s.ampAttack, glide, 0.18);
      f.ampAttack = nudge(f.ampAttack, glide, 0.15);
      s.detune = nudge(s.detune, glide, 0.12);
      s.duration = nudge(s.duration, length, 0.16);
      f.duration = nudge(f.duration, length, 0.16);
      break;
    }
    case "arp": {
      const brightness = kn(m, "brightness");
      const gate = kn(m, "gate");
      const sparkle = kn(m, "sparkle");
      const length = kn(m, "length");
      s.cutoff = nudge(s.cutoff, brightness, 0.2);
      f.index = nudge(f.index, sparkle, 0.2);
      f.ratio = nudge(f.ratio, sparkle, 0.12);
      s.ampDecay = nudge(s.ampDecay, gate, -0.15);
      s.ampSustain = nudge(s.ampSustain, gate, -0.2);
      s.ampRelease = nudge(s.ampRelease, gate, -0.12);
      s.duration = nudge(s.duration, length, 0.12);
      f.duration = nudge(f.duration, length, 0.12);
      break;
    }
    case "fx": {
      const chaos = kn(m, "chaos");
      const brightness = kn(m, "brightness");
      const space = kn(m, "space");
      const length = kn(m, "length");
      f.index = nudge(f.index, chaos, 0.3);
      f.feedback = nudge(f.feedback, chaos, 0.25);
      f.ratio = nudge(f.ratio, chaos, 0.2);
      n.density = nudge(n.density, chaos, 0.2);
      n.lp = nudge(n.lp, brightness, 0.22);
      f.carrier = nudge(f.carrier, brightness, 0.12);
      n.duration = nudge(n.duration, space, 0.18);
      f.duration = nudge(f.duration, space, 0.15);
      s.duration = nudge(s.duration, length, 0.15);
      n.duration = nudge(n.duration, length, 0.12);
      break;
    }
    case "texture": {
      const breath = kn(m, "breath");
      const grain = kn(m, "grain");
      const space = kn(m, "space");
      const brightness = kn(m, "brightness");
      n.density = nudge(n.density, breath, 0.2);
      n.color = nudge(n.color, breath, 0.15);
      v.breath = nudge(v.breath, breath, 0.35);
      g.density = nudge(g.density, grain, 0.3);
      g.grainSize = nudge(g.grainSize, grain, -0.15);
      g.spray = nudge(g.spray, grain, 0.25);
      s.ampAttack = nudge(s.ampAttack, space, 0.15);
      s.duration = nudge(s.duration, space, 0.15);
      n.duration = nudge(n.duration, space, 0.15);
      s.cutoff = nudge(s.cutoff, brightness, 0.2);
      n.lp = nudge(n.lp, brightness, 0.2);
      a.partials = nudge(a.partials, brightness, 0.15);
      break;
    }
    default:
      break;
  }

  // Keep pitched companions loosely aligned with subtractive fund/duration.
  a.fund = s.fund;
  a.duration = s.duration;
  p.duration = s.duration;
  v.fund = s.fund;
  v.duration = s.duration;
  f.carrier = s.fund;
  f.duration = s.duration;

  return out;
}

/** All machine specs (Family roles). */
export const MACHINE_SPECS_LIST: readonly MachineSpec[] =
  Object.values(MACHINE_SPECS);
