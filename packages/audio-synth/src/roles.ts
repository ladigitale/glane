import {
  bakeMachine,
  clampMachineParams,
  defaultMachineParams,
  type MachineParams,
  type RolePivots,
} from "./machines.js";
import {
  defaultAdditiveRangesAround,
  defaultFmRangesAround,
  defaultGranularRangesAround,
  defaultNoiseRangesAround,
  defaultPhysicalRangesAround,
  defaultRangesAround,
  defaultVoiceRangesAround,
} from "./sample.js";
import type {
  AdditiveNorm,
  AdditiveRanges,
  FmNorm,
  FmRanges,
  GranularNorm,
  GranularRanges,
  NoiseNorm,
  NoiseRanges,
  PhysicalNorm,
  PhysicalRanges,
  SubtractiveNorm,
  SubtractiveRanges,
  SynthEngineId,
  SynthRoleId,
  VoiceNorm,
  VoiceRanges,
} from "./types.js";
import {
  DEFAULT_ADDITIVE_NORM,
  DEFAULT_FM_NORM,
  DEFAULT_GRANULAR_NORM,
  DEFAULT_NOISE_NORM,
  DEFAULT_PHYSICAL_NORM,
  DEFAULT_SUBTRACTIVE_NORM,
  DEFAULT_VOICE_NORM,
  FAMILY_ROLE_IDS,
} from "./types.js";

/** Editable role card (Family / Song / Variations). */
export type SynthRoleCard = {
  id: string;
  role: SynthRoleId;
  engines: SynthEngineId[];
  quantity: number;
  randomness: number;
  /** When true, UI shows pivot sliders; Family uses free min/max ranges. */
  usePivot: boolean;
  /** Semantic machine knobs (Family / Song); empty for pivot. */
  machine: MachineParams;
  /** Show raw engine param UI (advanced). */
  engineUi: boolean;
  pivot: SubtractiveNorm;
  pivotFm: FmNorm;
  pivotNoise: NoiseNorm;
  pivotGranular: GranularNorm;
  pivotAdditive: AdditiveNorm;
  pivotPhysical: PhysicalNorm;
  pivotVoice: VoiceNorm;
  ranges: SubtractiveRanges;
  rangesFm: FmRanges;
  rangesNoise: NoiseRanges;
  rangesGranular: GranularRanges;
  rangesAdditive: AdditiveRanges;
  rangesPhysical: PhysicalRanges;
  rangesVoice: VoiceRanges;
};

type RolePreset = {
  engines: SynthEngineId[];
  randomness: number;
  subtractive: Partial<SubtractiveNorm>;
  fm?: Partial<FmNorm>;
  noise?: Partial<NoiseNorm>;
};

const PRESETS: Record<Exclude<SynthRoleId, "pivot">, RolePreset> = {
  kick: {
    engines: ["subtractive", "noise"],
    randomness: 0.7,
    subtractive: {
      fund: 0.22,
      cutoff: 0.35,
      wave: 0.7,
      ampAttack: 0.02,
      ampDecay: 0.35,
      ampSustain: 0.12,
      ampRelease: 0.35,
      duration: 0.22,
      drive: 0.35,
    },
    noise: {
      color: 0.7,
      lp: 0.4,
      density: 0.55,
      ampAttack: 0.02,
      ampDecay: 0.4,
      ampSustain: 0.1,
      duration: 0.2,
    },
  },
  snare: {
    engines: ["noise", "subtractive"],
    randomness: 0.75,
    subtractive: {
      fund: 0.4,
      cutoff: 0.55,
      ampAttack: 0.02,
      ampDecay: 0.3,
      ampSustain: 0.15,
      duration: 0.25,
      drive: 0.25,
    },
    noise: {
      color: 0.25,
      lp: 0.65,
      hp: 0.25,
      density: 0.85,
      ampAttack: 0.02,
      duration: 0.22,
    },
  },
  hat: {
    engines: ["noise"],
    randomness: 0.8,
    subtractive: { duration: 0.12 },
    noise: {
      color: 0.1,
      lp: 0.85,
      hp: 0.45,
      density: 0.95,
      ampAttack: 0.01,
      ampDecay: 0.25,
      ampSustain: 0.05,
      ampRelease: 0.2,
      duration: 0.12,
    },
  },
  perc: {
    engines: ["subtractive", "noise"],
    randomness: 0.75,
    subtractive: {
      fund: 0.5,
      cutoff: 0.6,
      ampAttack: 0.03,
      ampDecay: 0.35,
      ampSustain: 0.2,
      duration: 0.28,
    },
    noise: { density: 0.7, lp: 0.7, duration: 0.25 },
  },
  bass: {
    engines: ["subtractive", "fm"],
    randomness: 0.65,
    subtractive: {
      fund: 0.28,
      cutoff: 0.4,
      wave: 0.7,
      ampAttack: 0.12,
      ampSustain: 0.7,
      ampRelease: 0.55,
      duration: 0.55,
    },
    fm: {
      carrier: 0.28,
      ratio: 0.35,
      index: 0.25,
      ampSustain: 0.65,
      duration: 0.55,
    },
  },
  pad: {
    engines: ["subtractive", "fm"],
    randomness: 0.7,
    subtractive: {
      fund: 0.42,
      cutoff: 0.5,
      ampAttack: 0.45,
      ampDecay: 0.4,
      ampSustain: 0.75,
      ampRelease: 0.7,
      duration: 0.75,
      reso: 0.2,
    },
    fm: {
      carrier: 0.42,
      ratio: 0.5,
      index: 0.3,
      ampAttack: 0.4,
      ampSustain: 0.7,
      duration: 0.75,
    },
  },
  lead: {
    engines: ["fm", "subtractive"],
    randomness: 0.7,
    subtractive: {
      fund: 0.55,
      cutoff: 0.65,
      ampAttack: 0.08,
      ampSustain: 0.55,
      duration: 0.45,
    },
    fm: {
      carrier: 0.55,
      ratio: 0.55,
      index: 0.45,
      feedback: 0.25,
      duration: 0.45,
    },
  },
  arp: {
    engines: ["subtractive", "fm"],
    randomness: 0.55,
    subtractive: {
      fund: 0.52,
      cutoff: 0.62,
      wave: 0.7,
      ampAttack: 0.04,
      ampDecay: 0.22,
      ampSustain: 0.3,
      ampRelease: 0.28,
      duration: 0.7,
      drive: 0.18,
    },
    fm: {
      carrier: 0.52,
      ratio: 0.45,
      index: 0.35,
      ampAttack: 0.04,
      ampSustain: 0.35,
      duration: 0.7,
    },
  },
  fx: {
    engines: ["noise", "fm"],
    randomness: 0.9,
    subtractive: { duration: 0.6 },
    fm: {
      carrier: 0.5,
      ratio: 0.7,
      index: 0.65,
      feedback: 0.45,
      duration: 0.65,
    },
    noise: {
      color: 0.5,
      density: 0.6,
      lp: 0.6,
      hp: 0.2,
      duration: 0.65,
    },
  },
  texture: {
    engines: ["subtractive", "noise"],
    randomness: 0.85,
    subtractive: {
      fund: 0.4,
      cutoff: 0.5,
      ampAttack: 0.35,
      ampSustain: 0.65,
      duration: 0.7,
    },
    noise: {
      color: 0.55,
      density: 0.5,
      lp: 0.55,
      duration: 0.7,
    },
  },
};

let roleSeq = 0;

function nextCardId(): string {
  roleSeq += 1;
  return `role-${roleSeq}-${Date.now().toString(36)}`;
}

function rangesFor(pivots: RolePivots, span: number) {
  return {
    ranges: defaultRangesAround(pivots.pivot, span),
    rangesFm: defaultFmRangesAround(pivots.pivotFm, span),
    rangesNoise: defaultNoiseRangesAround(pivots.pivotNoise, span),
    rangesGranular: defaultGranularRangesAround(pivots.pivotGranular, span),
    rangesAdditive: defaultAdditiveRangesAround(pivots.pivotAdditive, span),
    rangesPhysical: defaultPhysicalRangesAround(pivots.pivotPhysical, span),
    rangesVoice: defaultVoiceRangesAround(pivots.pivotVoice, span),
  };
}

/** Preset pivots before machine knobs (neutral = bake leaves them). */
export function rolePresetPivots(role: Exclude<SynthRoleId, "pivot">): RolePivots {
  const preset = PRESETS[role];
  const pivot: SubtractiveNorm = {
    ...DEFAULT_SUBTRACTIVE_NORM,
    ...preset.subtractive,
  };
  const pivotFm: FmNorm = { ...DEFAULT_FM_NORM, ...preset.fm };
  const pivotNoise: NoiseNorm = { ...DEFAULT_NOISE_NORM, ...preset.noise };
  const pivotGranular = { ...DEFAULT_GRANULAR_NORM };
  const pivotAdditive = {
    ...DEFAULT_ADDITIVE_NORM,
    fund: pivot.fund,
    duration: pivot.duration,
  };
  const pivotPhysical = {
    ...DEFAULT_PHYSICAL_NORM,
    length: pivot.fund,
    duration: pivot.duration,
  };
  const pivotVoice = {
    ...DEFAULT_VOICE_NORM,
    fund: pivot.fund,
    duration: pivot.duration,
  };
  return {
    pivot,
    pivotFm,
    pivotNoise,
    pivotGranular,
    pivotAdditive,
    pivotPhysical,
    pivotVoice,
  };
}

/**
 * Re-bake pivots + ranges from semantic machine knobs onto the role preset.
 * Preserves id / engines / quantity / randomness / engineUi.
 */
export function applyCardMachine(card: SynthRoleCard): SynthRoleCard {
  if (card.role === "pivot") return card;
  const machine = clampMachineParams(card.role, card.machine);
  const baked = bakeMachine(card.role, machine, rolePresetPivots(card.role));
  return {
    ...card,
    machine,
    ...baked,
    ...rangesFor(baked, card.randomness),
  };
}

/** Build a Family role card from a preset (wide ranges). */
export function createRoleCard(
  role: SynthRoleId,
  opts?: { quantity?: number; id?: string },
): SynthRoleCard {
  if (role === "pivot") {
    const randomness = 0.35;
    const pivot = { ...DEFAULT_SUBTRACTIVE_NORM };
    const pivotFm = { ...DEFAULT_FM_NORM };
    const pivotNoise = { ...DEFAULT_NOISE_NORM };
    const pivotGranular = { ...DEFAULT_GRANULAR_NORM };
    const pivotAdditive = { ...DEFAULT_ADDITIVE_NORM };
    const pivotPhysical = { ...DEFAULT_PHYSICAL_NORM };
    const pivotVoice = { ...DEFAULT_VOICE_NORM };
    const pivots: RolePivots = {
      pivot,
      pivotFm,
      pivotNoise,
      pivotGranular,
      pivotAdditive,
      pivotPhysical,
      pivotVoice,
    };
    return {
      id: opts?.id ?? nextCardId(),
      role: "pivot",
      engines: ["subtractive"],
      quantity: opts?.quantity ?? 8,
      randomness,
      usePivot: true,
      machine: {},
      engineUi: true,
      ...pivots,
      ...rangesFor(pivots, randomness),
    };
  }

  const preset = PRESETS[role];
  const randomness = Math.max(0.55, preset.randomness);
  const machine = defaultMachineParams(role);
  const baked = bakeMachine(role, machine, rolePresetPivots(role));
  return {
    id: opts?.id ?? nextCardId(),
    role,
    engines: [...preset.engines],
    quantity: opts?.quantity ?? 6,
    randomness,
    usePivot: false,
    machine,
    engineUi: false,
    ...baked,
    ...rangesFor(baked, randomness),
  };
}

/** Default Family kit: kick / snare / hat. */
export function defaultFamilyCards(quantityPerRole = 6): SynthRoleCard[] {
  return (["kick", "snare", "hat"] as const).map((role) =>
    createRoleCard(role, { quantity: quantityPerRole }),
  );
}

export function isFamilyRoleId(id: string): id is Exclude<SynthRoleId, "pivot"> {
  return (FAMILY_ROLE_IDS as readonly string[]).includes(id);
}
