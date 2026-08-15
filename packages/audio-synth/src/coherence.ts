import {
  fundNormToHz,
  hzToCutoffNorm,
  hzToFundNorm,
  logLerp,
  msToDurationNorm,
} from "./map.js";
import type { SynthRoleCard } from "./roles.js";
import type {
  AdditiveNorm,
  FmNorm,
  Norm01,
  PhysicalNorm,
  SubtractiveNorm,
  SynthRoleId,
  VoiceNorm,
} from "./types.js";

export type CoherenceKind = "parametric" | "musical";

export type ScaleMode = "major" | "minor";

export type CoherenceOpts = {
  kind: CoherenceKind;
  /** Pitch class 0=C … 11=B. */
  tonicPc: number;
  bpm: number;
  /** Default major. Used when kind === "musical". */
  scaleMode?: ScaleMode;
  /**
   * When true, FM ratios stay continuous (may be dissonant).
   * Default false → snap to harmonic carrier:mod ratios.
   */
  freeFmRatios?: boolean;
};

/** Ionian / Aeolian intervals from tonic. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

/**
 * Integer (and half) FM c:m ratios → harmonic sidebands of the carrier.
 * Note: 1.5 is intentionally omitted — it yields clangorous / inharmonic
 * spectra that clash with subtractive/additive engines at the same pitch.
 */
export const HARMONIC_FM_RATIOS = [0.5, 1, 2, 3, 4] as const;

function clamp01(n: number): Norm01 {
  return Math.min(1, Math.max(0, n));
}

/** MIDI note → Hz. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Hz → pitch class 0=C … 11=B (A4=440). */
export function hzToPitchClass(hz: number): number {
  const midi = 69 + 12 * Math.log2(Math.max(20, hz) / 440);
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** Tonic frequency at given octave (2 ≈ C2 bass region). */
export function tonicHz(pc: number, octave = 2): number {
  const p = ((Math.round(pc) % 12) + 12) % 12;
  const midi = (octave + 1) * 12 + p;
  return midiToHz(midi);
}

/** Beat duration in ms from BPM. */
export function beatMs(bpm: number): number {
  const b = Math.max(40, Math.min(240, bpm || 120));
  return 60_000 / b;
}

export function scaleIntervals(mode: ScaleMode = "major"): readonly number[] {
  return mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
}

/**
 * Pinch an existing range toward a center band.
 * If the intersection would be empty/inverted, recenter on the target
 * (do not keep the old off-key band — that caused out-of-tune pitches).
 */
function pinchRange(
  min: Norm01,
  max: Norm01,
  center: Norm01,
  width: Norm01,
): { min: Norm01; max: Norm01 } {
  const half = width / 2;
  const lo = clamp01(center - half);
  const hi = clamp01(Math.max(lo + 0.02, center + half));
  const nextMin = Math.max(min, lo);
  const nextMax = Math.min(max, hi);
  if (nextMin <= nextMax + 1e-9) {
    return { min: nextMin as Norm01, max: nextMax as Norm01 };
  }
  // Empty intersection → force coherent band around center
  return { min: lo, max: hi };
}

/** Replace range with a tight band around center (musical pitch lock). */
function centeredRange(
  center: Norm01,
  width: Norm01,
): { min: Norm01; max: Norm01 } {
  const half = width / 2;
  const lo = clamp01(center - half);
  const hi = clamp01(Math.max(lo + 0.015, center + half));
  return { min: lo, max: hi };
}

/**
 * Allowed intervals (semitones above tonic) for pitched roles.
 * Musical lock: tonic only — all tonal engines share the same pitch class
 * (octave varies by role). Noise-only roles return null.
 */
export function roleAllowedSemis(
  role: SynthRoleId,
  _scaleMode: ScaleMode = "major",
): number[] | null {
  switch (role) {
    case "kick":
    case "bass":
    case "pad":
    case "lead":
    case "arp":
    case "perc":
    case "fx":
    case "texture":
    case "pivot":
      return [0];
    case "snare":
    case "hat":
      return null;
  }
}

/** Preferred MIDI octave window for a role (scientific octave). */
function roleOctaveWindow(role: SynthRoleId): { min: number; max: number } {
  switch (role) {
    case "kick":
      return { min: 1, max: 2 };
    case "bass":
      return { min: 1, max: 3 };
    case "pad":
      return { min: 3, max: 5 };
    case "lead":
    case "arp":
      return { min: 3, max: 5 };
    case "perc":
      return { min: 3, max: 5 };
    default:
      return { min: 2, max: 4 };
  }
}

/** Primary target Hz for range centering / role synth pitch lock. */
export function roleFundTargetHz(
  role: SynthRoleId,
  tonicPc: number,
  scaleMode: ScaleMode,
): number | null {
  const semis = roleAllowedSemis(role, scaleMode);
  if (!semis || semis.length === 0) return null;
  const oct = roleOctaveWindow(role);
  const midOct =
    role === "kick" ? oct.min : Math.round((oct.min + oct.max) / 2);
  return midiToHz((midOct + 1) * 12 + tonicPc + (semis[0] ?? 0));
}

function roleCutoffTarget(role: SynthRoleId, tonic: number): number | null {
  switch (role) {
    case "kick":
      return Math.max(120, tonic * 3);
    case "bass":
      return Math.max(400, tonic * 6);
    case "snare":
      return 3500;
    case "hat":
      return 9000;
    case "perc":
      return 5000;
    case "pad":
      return 2500;
    case "lead":
    case "arp":
      return 4500;
    case "fx":
      return 6000;
    case "texture":
      return 3000;
    case "pivot":
      return null;
  }
}

/**
 * Snap Hz to nearest allowed scale degree in the role's octave window.
 */
export function snapHzToScale(
  hz: number,
  tonicPc: number,
  allowedSemis: readonly number[],
  octaveMin: number,
  octaveMax: number,
): number {
  const safeHz = Math.max(20, Math.min(4000, hz));
  let best = safeHz;
  let bestDist = Infinity;
  const pc = ((Math.round(tonicPc) % 12) + 12) % 12;
  for (let oct = octaveMin; oct <= octaveMax; oct++) {
    for (const semi of allowedSemis) {
      const midi = (oct + 1) * 12 + pc + semi;
      const f = midiToHz(midi);
      const dist = Math.abs(Math.log(f / safeHz));
      if (dist < bestDist) {
        bestDist = dist;
        best = f;
      }
    }
  }
  return best;
}

/** Map physical FM ratio → 0–1 norm (inverse of denormalizeFm). */
function ratioToNorm(ratio: number): Norm01 {
  const r = Math.max(0.25, Math.min(8, ratio));
  return clamp01(
    (Math.log(r) - Math.log(0.25)) / (Math.log(8) - Math.log(0.25)),
  );
}

function snapFmRatio(ratio: number): number {
  let best: number = HARMONIC_FM_RATIOS[0]!;
  let bestDist = Infinity;
  for (const cand of HARMONIC_FM_RATIOS) {
    const d = Math.abs(Math.log(cand / Math.max(1e-9, ratio)));
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

function snapFundField(
  fundNorm: Norm01,
  tonicPc: number,
  semis: readonly number[],
  oct: { min: number; max: number },
): Norm01 {
  return hzToFundNorm(
    snapHzToScale(fundNormToHz(fundNorm), tonicPc, semis, oct.min, oct.max),
  );
}

export type QuantizePitchBag = {
  sub?: SubtractiveNorm;
  fm?: FmNorm;
  additive?: AdditiveNorm;
  physical?: PhysicalNorm;
  voice?: VoiceNorm;
};

/**
 * Quantize pitched params onto the tonic after continuous sampling.
 * Musical: all tonal engines lock fund/carrier/length to the tonic pitch
 * class (octave by role). FM ratios snap to harmonics unless freeFmRatios.
 * Additive keeps integer harmonics; inharm is light phasing detune only.
 */
export function quantizePitchedParams(
  role: SynthRoleId | undefined,
  opts: CoherenceOpts,
  bag: QuantizePitchBag = {},
): QuantizePitchBag {
  const { sub, fm, additive, physical, voice } = bag;
  if (opts.kind !== "musical") return { sub, fm, additive, physical, voice };
  const scaleMode = opts.scaleMode ?? "major";
  // Always tonic — even when role is unset or noise-leaning, pitched engines
  // must not wander off-key after random sampling (esp. physical length).
  const semis = role ? (roleAllowedSemis(role, scaleMode) ?? [0]) : [0];
  const oct = role ? roleOctaveWindow(role) : { min: 2, max: 4 };
  const outSub = sub ? { ...sub } : undefined;
  const outFm = fm ? { ...fm } : undefined;
  const outAdd = additive ? { ...additive } : undefined;
  const outPhys = physical ? { ...physical } : undefined;
  const outVoice = voice ? { ...voice } : undefined;

  if (outSub) {
    outSub.fund = snapFundField(outSub.fund, opts.tonicPc, semis, oct);
    outSub.detune = 0.5;
  }
  if (outFm) {
    outFm.carrier = snapFundField(outFm.carrier, opts.tonicPc, semis, oct);
    if (!opts.freeFmRatios) {
      const physicalRatio = logLerp(0.25, 8, outFm.ratio);
      outFm.ratio = ratioToNorm(snapFmRatio(physicalRatio));
    }
  }
  if (outAdd) {
    outAdd.fund = snapFundField(outAdd.fund, opts.tonicPc, semis, oct);
    // inharm → micro-detune for phasing (see denormalizeAdditive), not stretch
    outAdd.inharm = Math.min(outAdd.inharm, 0.55);
  }
  if (outPhys) {
    outPhys.length = snapFundField(outPhys.length, opts.tonicPc, semis, oct);
    // High stiffness drifts KS pitch off the delay fundamental
    outPhys.stiffness = Math.min(outPhys.stiffness, 0.25);
  }
  if (outVoice) {
    outVoice.fund = snapFundField(outVoice.fund, opts.tonicPc, semis, oct);
  }

  return {
    sub: outSub,
    fm: outFm,
    additive: outAdd,
    physical: outPhys,
    voice: outVoice,
  };
}

/**
 * Apply inter-role coherence onto a card's ranges (returns a shallow clone).
 * Parametric: shared duration / envelope bias from BPM.
 * Musical: + scale-locked pitch bands around tonic (no continuous off-key drift).
 */
export function applyCoherence(
  card: SynthRoleCard,
  opts: CoherenceOpts,
): SynthRoleCard {
  const bpm = Math.max(40, Math.min(240, opts.bpm || 120));
  const beat = beatMs(bpm);
  const tonicPc = ((Math.round(opts.tonicPc) % 12) + 12) % 12;
  const scaleMode = opts.scaleMode ?? "major";
  const tonic = tonicHz(tonicPc, 2);

  const next: SynthRoleCard = {
    ...card,
    ranges: { ...card.ranges },
    rangesFm: { ...card.rangesFm },
    rangesNoise: { ...card.rangesNoise },
    rangesAdditive: { ...card.rangesAdditive },
    rangesPhysical: { ...card.rangesPhysical },
    rangesVoice: { ...card.rangesVoice },
    rangesGranular: { ...card.rangesGranular },
    pivot: { ...card.pivot },
    pivotFm: { ...card.pivotFm },
    pivotNoise: { ...card.pivotNoise },
    pivotAdditive: { ...card.pivotAdditive },
    pivotPhysical: { ...card.pivotPhysical },
    pivotVoice: { ...card.pivotVoice },
    pivotGranular: { ...card.pivotGranular },
  };

  // --- Parametric (always when coherence applied) ---
  let durMs = beat;
  if (card.role === "hat") durMs = beat * 0.35;
  else if (card.role === "kick" || card.role === "snare" || card.role === "perc")
    durMs = beat * 0.7;
  else if (card.role === "bass") durMs = beat * 2;
  else if (card.role === "pad" || card.role === "texture") durMs = beat * 4;
  else if (card.role === "lead") durMs = beat * 1.5;
  else if (card.role === "arp") durMs = beat * 4;
  else if (card.role === "fx") durMs = beat * 2.5;

  const durNorm = msToDurationNorm(durMs);
  next.ranges.duration = {
    ...next.ranges.duration,
    ...pinchRange(next.ranges.duration.min, next.ranges.duration.max, durNorm, 0.18),
  };
  next.rangesFm.duration = {
    ...next.rangesFm.duration,
    ...pinchRange(
      next.rangesFm.duration.min,
      next.rangesFm.duration.max,
      durNorm,
      0.18,
    ),
  };
  next.rangesNoise.duration = {
    ...next.rangesNoise.duration,
    ...pinchRange(
      next.rangesNoise.duration.min,
      next.rangesNoise.duration.max,
      durNorm,
      0.18,
    ),
  };

  const attackBias = clamp01(0.02 + (1 - Math.min(1, bpm / 160)) * 0.2);
  if (
    card.role === "kick" ||
    card.role === "snare" ||
    card.role === "hat" ||
    card.role === "perc"
  ) {
    next.ranges.ampAttack = {
      ...next.ranges.ampAttack,
      ...pinchRange(
        next.ranges.ampAttack.min,
        next.ranges.ampAttack.max,
        attackBias,
        0.12,
      ),
    };
  }

  if (opts.kind !== "musical") return next;

  // --- Musical complementarity (scale-locked) ---
  const fundHz = roleFundTargetHz(card.role, tonicPc, scaleMode);
  if (fundHz != null) {
    const fundN = hzToFundNorm(fundHz);
    // Wide enough to reach neighbour degrees; quantizePitchedParams snaps after sample
    const width = card.role === "lead" || card.role === "pad" ? 0.22 : 0.1;
    next.ranges.fund = {
      ...next.ranges.fund,
      ...centeredRange(fundN, width),
    };
    next.rangesFm.carrier = {
      ...next.rangesFm.carrier,
      ...centeredRange(fundN, width),
    };
    next.pivot.fund = fundN;
    next.pivotFm.carrier = fundN;
    next.pivotAdditive.fund = fundN;
    next.pivotPhysical.length = fundN;
    next.pivotVoice.fund = fundN;
    next.rangesAdditive.fund = {
      ...next.rangesAdditive.fund,
      ...centeredRange(fundN, width),
    };
    next.rangesPhysical.length = {
      ...next.rangesPhysical.length,
      ...centeredRange(fundN, width),
    };
    next.rangesVoice.fund = {
      ...next.rangesVoice.fund,
      ...centeredRange(fundN, width),
    };
    // Detune must stay at unison — continuous ±50¢ reads as false notes
    next.ranges.detune = {
      ...next.ranges.detune,
      ...centeredRange(0.5, 0.04),
    };
    next.pivot.detune = 0.5;
    if (opts.freeFmRatios) {
      next.rangesFm.ratio = {
        ...next.rangesFm.ratio,
        min: 0.15,
        max: 0.85,
      };
    } else {
      // Prefer harmonic FM ratios (~1:1 → norm ≈ 0.4)
      next.rangesFm.ratio = {
        ...next.rangesFm.ratio,
        ...centeredRange(ratioToNorm(1), 0.28),
      };
      next.pivotFm.ratio = ratioToNorm(1);
    }
    // Additive: integer harmonics + light phasing detune (not stretch)
    next.rangesAdditive.inharm = {
      ...next.rangesAdditive.inharm,
      ...centeredRange(0.22, 0.4),
    };
    next.pivotAdditive.inharm = 0.2;
    next.rangesGranular.pitchRand = {
      ...next.rangesGranular.pitchRand,
      ...centeredRange(0.02, 0.06),
    };
    next.pivotGranular.pitchRand = 0.02;
    // Keep physical stiffness low so KS delay pitch stays on tonic
    next.rangesPhysical.stiffness = {
      ...next.rangesPhysical.stiffness,
      ...centeredRange(0.12, 0.2),
    };
    next.pivotPhysical.stiffness = 0.12;
  }

  const cutHz = roleCutoffTarget(card.role, tonic);
  if (cutHz != null) {
    const cutN = hzToCutoffNorm(cutHz);
    next.ranges.cutoff = {
      ...next.ranges.cutoff,
      ...pinchRange(next.ranges.cutoff.min, next.ranges.cutoff.max, cutN, 0.2),
    };
    next.rangesNoise.lp = {
      ...next.rangesNoise.lp,
      ...pinchRange(next.rangesNoise.lp.min, next.rangesNoise.lp.max, cutN, 0.22),
    };
    if (card.role === "hat") {
      const hpN = hzToCutoffNorm(4000);
      next.rangesNoise.hp = {
        ...next.rangesNoise.hp,
        ...pinchRange(
          next.rangesNoise.hp.min,
          next.rangesNoise.hp.max,
          hpN,
          0.15,
        ),
      };
    }
    if (card.role === "kick" || card.role === "bass") {
      next.ranges.cutoff = {
        ...next.ranges.cutoff,
        max: Math.min(next.ranges.cutoff.max, cutN + 0.12),
      };
    }
    next.pivot.cutoff = cutN;
  }

  return next;
}

export function applyCoherenceToCards(
  cards: readonly SynthRoleCard[],
  opts: CoherenceOpts,
): SynthRoleCard[] {
  return cards.map((c) => applyCoherence(c, opts));
}
