/** Deterministic generative helpers — song-form motifs + expressive roles. */

import {
  compose,
  STYLE_GENERATOR_PROFILES,
  type AutomationLane,
  type ComposeLock,
  type ComposeSettings,
  type FormFamily,
  type GrooveFromSamples,
  type MasterPlan,
  type ModeId,
  type RhythmGene,
  type Score,
  type SpacePlan,
} from "@glane/composer";
import { mixcheckPlan } from "./generative-mixcheck.js";
import {
  DEFAULT_TRACK_ADSR,
  DEFAULT_TRACK_FX,
  ExprRoleSchema,
  PPQ as CORE_PPQ,
  normalizeTrackFx,
  parseExprRoleTag,
  TRACK_ATTACK_MS_MAX,
  TRACK_DECAY_MS_MAX,
  TRACK_HP_HZ_MAX,
  TRACK_HP_HZ_OPEN,
  TRACK_LP_HZ_MIN,
  TRACK_LP_HZ_OPEN,
  TRACK_RELEASE_MS_MAX,
  type ExprRole,
  type FadeCurve,
  type StretchMode,
  type TrackFx,
} from "@glane/core-model";
import { ensemble } from "./generative-ensemble";
import type {
  GenEnsembleRelation,
  VoiceRelation,
} from "./generative-ensemble";
import {
  buildSectionHarmonyTimeline,
  pickArpCell,
  pickMelodyCell,
  type ArpEvent,
  type ChordTone,
  type HarmonicPalette,
  type HarmonyBar,
  type MelodyEvent,
} from "./generative-refs";
import {
  mlScoreAdjust,
  roleHintFromStem,
  roleHintFromYamnet,
  withClapCohesion,
  type SampleMlCues,
} from "./generative-cues";
import {
  MUSIC_STYLE_PROFILES,
  buildStyleMotif,
  pickMusicStyle,
  resolveStyleBiasedSlider,
  type GenMusicStyleChoice,
  type GrooveKind,
  type MusicStyleId,
} from "./generative-styles";

export type { ExprRole };
export type { SampleMlCues };
export type {
  GenMusicStyleChoice,
  GrooveKind,
  MusicStyleId,
} from "./generative-styles";
export type { GenEnsembleRelation, VoiceRelation } from "./generative-ensemble";
export { MUSIC_STYLE_IDS, MUSIC_STYLE_PROFILES } from "./generative-styles";
export {
  styleSuggestedTempoBars,
  styleTempoBarsFit,
} from "./generative-styles";
export type {
  StyleBarsHint,
  StyleBpmHint,
  StyleTempoBarsFit,
} from "./generative-styles";
export {
  parseStemFromTags,
  parseYamnetSlugs,
  resolveYamnetSlugs,
  withClapCohesion,
} from "./generative-cues";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Explicit lock vs seed-driven pick. */
export type GenAuto = "auto";
export type GenTriState = GenAuto | "on" | "off";
export type GenScaleMode = GenAuto | "major" | "minor";
/** UI form choice — legacy aliases `song`/`ambient` + composer families. */
export type GenFormStyle =
  | GenAuto
  | "song"
  | "ambient"
  | "verse-chorus"
  | "aaba"
  | "build-drop"
  | "arch"
  | "rondo"
  | "loop-evolve";
export type GenEnergyShape =
  | GenAuto
  | "rise"
  | "arch"
  | "waves"
  | "plateau";
export type GenPaletteChoice = GenAuto | HarmonicPalette;
export type GenGrooveChoice = GenAuto | GrooveKind;

export type SequenceSampleIn = {
  id: string;
  durationMs: number;
  class: string;
  favorite: boolean;
  loopScore?: number;
  /** Detected seamless loop region on the sample (ms). */
  loopStartMs?: number;
  loopEndMs?: number;
  /** Crossfade length for seamless loop playback (ms). */
  loopXfadeMs?: number;
  pitchHz?: number;
  noteName?: string;
  harmonicity?: number;
  /** Pitch tracker confidence 0..1 (optional analysis). */
  pitchConfidence?: number;
  /** Pitch drift on sustain (cents stddev); high → treat as texture. */
  pitchDriftCents?: number;
  centroidHz?: number;
  transientDensity?: number;
  analysisBpm?: number;
  /** Integrated loudness (LUFS) from analysis. */
  lufs?: number;
  /** True-peak (dBTP) from analysis. */
  peakDbtp?: number;
  /** Soft classifier votes (sample.classScores). */
  classScores?: Record<string, number>;
  forceRole?: ExprRole | null;
  tags?: string[];
  /** T2 ML / library enrichment (YAMNet, Demucs, CLAP, interest). */
  subclass?: string;
  confidence?: number;
  interestScore?: number;
  rating?: number;
  parentSampleId?: string;
  stem?: SampleMlCues["stem"];
  yamnet?: string[];
  clapVector?: number[];
  clapCohesion?: number;
};

export type SequenceClipPlan = {
  trackId: string;
  sampleId: string;
  startTick: number;
  lengthTick: number;
  contentOffsetMs: number;
  gainDb: number;
  loopEnabled: boolean;
  /** When set with loopEnabled, only this window (from contentOffset) repeats. */
  loopLengthMs?: number;
  fadeInMs: number;
  fadeOutMs: number;
  fadeCurve: FadeCurve;
  pitchSemitones: number;
  stretchMode: StretchMode;
  reverse: boolean;
};

export type SequenceTrackPlan = {
  trackId: string;
  gainDb: number;
  pan: number;
  fx: TrackFx;
  sendA?: number;
  sendB?: number;
};

export type SequenceEnsembleSummary = {
  relationMode: GenEnsembleRelation;
  relations: VoiceRelation[];
  primaryLeadTrack: number | null;
};

export type SequencePlanResult = {
  clips: SequenceClipPlan[];
  tracks: SequenceTrackPlan[];
  ensemble?: SequenceEnsembleSummary;
  /** Optional composer outputs (step 8+) — ignored by legacy apply path. */
  automation?: AutomationLane[];
  sends?: Array<{ trackId: string; a: number; b: number }>;
  spaces?: SpacePlan;
  master?: MasterPlan;
  score?: Score;
  warnings?: string[];
};

type SectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro";

type SongSection = {
  kind: SectionKind;
  startBar: number;
  bars: number;
  densityMul: number;
  gainBiasDb: number;
  evolve: number;
  fillLastBar: boolean;
  altSample: boolean;
};

/**
 * Widen quiet↔loud contrast: energy still lifts overall, but sparse sections
 * stay sparse and choruses stay denser than a flat multiplier would allow.
 * Quiet bases must not climb into mid-density (flattens verse↔chorus).
 */
function sectionDensityBoost(base: number, energy: number): number {
  const e = clamp(energy, 0, 1);
  if (base < 0.55) {
    return clamp(base * (0.92 + e * 0.12), 0.12, 0.55);
  }
  if (base > 1) {
    // Peaks: push further with energy
    return clamp(base * (0.9 + e * 0.4), 0.95, 1.65);
  }
  return clamp(base * (0.8 + e * 0.4), 0.4, 1.25);
}

type SpectralBand = "sub" | "low" | "mid" | "high" | "air";

type SpectralOccupancy = {
  id: string;
  role: ExprRole;
  hz: number;
};

/** Centroid when analysed; else approximate from pitched MIDI. */
function sampleCentroidHz(s: SequenceSampleIn): number | null {
  if (s.centroidHz != null && s.centroidHz > 20 && s.centroidHz < 16_000) {
    return s.centroidHz;
  }
  const midi = sampleSourceMidi(s);
  if (midi != null) return 440 * Math.pow(2, (midi - 69) / 12);
  return null;
}

function bandFromHz(hz: number): SpectralBand {
  if (hz < 120) return "sub";
  if (hz < 400) return "low";
  if (hz < 1600) return "mid";
  if (hz < 4500) return "high";
  return "air";
}

/** Ideal centre + acceptable bands for a mix role (arrangement scaffolding). */
function roleSpectralTarget(role: ExprRole): {
  idealHz: number;
  bands: readonly SpectralBand[];
} {
  switch (role) {
    case "kick":
      return { idealHz: 85, bands: ["sub", "low"] };
    case "bass":
      return { idealHz: 120, bands: ["sub", "low"] };
    case "snare":
      return { idealHz: 1000, bands: ["mid", "high"] };
    case "hat":
      return { idealHz: 6500, bands: ["high", "air"] };
    case "perc":
      return { idealHz: 2200, bands: ["mid", "high"] };
    case "chord":
      return { idealHz: 480, bands: ["low", "mid"] };
    case "lead":
    case "arp":
      return { idealHz: 1600, bands: ["mid", "high"] };
    case "loop":
      return { idealHz: 650, bands: ["low", "mid"] };
    case "texture":
      return { idealHz: 1400, bands: ["mid", "high"] };
    case "fx":
      return { idealHz: 3800, bands: ["high", "air"] };
  }
}

/** Lower = better fit (same polarity as scoreSampleForRole). */
function spectralFitPenalty(s: SequenceSampleIn, role: ExprRole): number {
  const hz = sampleCentroidHz(s);
  if (hz == null) return 0.15;
  const { idealHz, bands } = roleSpectralTarget(role);
  const band = bandFromHz(hz);
  let pen = bands.includes(band) ? 0 : 1.35;
  const oct = Math.abs(Math.log2(hz / Math.max(20, idealHz)));
  pen += Math.min(2.2, oct * 0.6);
  return pen;
}

function spectralClashPenalty(
  s: SequenceSampleIn,
  role: ExprRole,
  occupied: readonly SpectralOccupancy[],
): number {
  const hz = sampleCentroidHz(s);
  if (hz == null || occupied.length === 0) return 0;
  let pen = 0;
  for (const o of occupied) {
    if (o.id === s.id) {
      pen += 1.6;
      continue;
    }
    const oct = Math.abs(Math.log2(hz / o.hz));
    if (oct >= 0.65) continue;
    const bothLow =
      (role === "kick" || role === "bass") &&
      (o.role === "kick" || o.role === "bass");
    // Kick+bass may share lows; other same-band stacks get carved apart.
    pen += bothLow ? 0.4 : 1.55 * (1 - oct / 0.65);
  }
  return pen;
}

function roleEqBands(
  role: ExprRole,
  rnd: () => number,
): { low: number; mid: number; high: number } {
  switch (role) {
    case "kick":
      return {
        low: 1.2 + rnd() * 0.2,
        mid: 0.8 + rnd() * 0.1,
        high: 0.62 + rnd() * 0.12,
      };
    case "bass":
      return {
        low: 1.12 + rnd() * 0.18,
        mid: 1.05 + rnd() * 0.1,
        high: 0.58 + rnd() * 0.14,
      };
    case "snare":
      return {
        low: 0.72 + rnd() * 0.1,
        mid: 1.12 + rnd() * 0.12,
        high: 1.15 + rnd() * 0.15,
      };
    case "hat":
      return {
        low: 0.42 + rnd() * 0.14,
        mid: 0.88 + rnd() * 0.1,
        high: 1.28 + rnd() * 0.22,
      };
    case "perc":
      return {
        low: 0.68 + rnd() * 0.12,
        mid: 1.05 + rnd() * 0.08,
        high: 1.15 + rnd() * 0.15,
      };
    case "chord":
      return {
        low: 0.82 + rnd() * 0.1,
        mid: 1.08 + rnd() * 0.1,
        high: 0.92 + rnd() * 0.1,
      };
    case "lead":
    case "arp":
      return {
        low: 0.68 + rnd() * 0.12,
        mid: 1.05 + rnd() * 0.1,
        high: 1.18 + rnd() * 0.15,
      };
    case "loop":
      return {
        low: 0.88 + rnd() * 0.08,
        mid: 1.05 + rnd() * 0.08,
        high: 0.92 + rnd() * 0.1,
      };
    case "texture":
      return {
        low: 0.78 + rnd() * 0.1,
        mid: 0.95 + rnd() * 0.08,
        high: 1.08 + rnd() * 0.14,
      };
    case "fx":
      return {
        low: 0.6 + rnd() * 0.14,
        mid: 0.9 + rnd() * 0.1,
        high: 1.22 + rnd() * 0.2,
      };
  }
}

/** Nudge EQ when the home sample sits off the role's spectral seat. */
function correctEqForSample(
  bands: { low: number; mid: number; high: number },
  role: ExprRole,
  sample: SequenceSampleIn | undefined,
): { low: number; mid: number; high: number } {
  const hz = sample ? sampleCentroidHz(sample) : null;
  if (hz == null) return bands;
  const ideal = roleSpectralTarget(role).idealHz;
  const ratio = hz / ideal;
  let { low, mid, high } = bands;
  if (ratio > 2.4) {
    high *= 0.72;
    mid *= 0.92;
    low *= 1.12;
  } else if (ratio > 1.6) {
    high *= 0.85;
    low *= 1.06;
  } else if (ratio < 0.4) {
    high *= 1.14;
    mid *= 0.9;
    low *= 0.88;
  } else if (ratio < 0.65) {
    high *= 1.08;
    low *= 0.94;
  }
  return {
    low: clamp(low, 0.35, 1.6),
    mid: clamp(mid, 0.45, 1.45),
    high: clamp(high, 0.35, 1.7),
  };
}

/**
 * Bake role spectral EQ onto a track FX when the wet insert is EQ / none.
 * Wet inserts keep their type — HP/LP in `withRoleFilters` carve the seat.
 */
function withSpectralTrackEq(
  fx: TrackFx,
  role: ExprRole,
  sample: SequenceSampleIn | undefined,
  rnd: () => number,
): TrackFx {
  const bands = correctEqForSample(roleEqBands(role, rnd), role, sample);
  if (fx.type === "eq" || fx.type === "none") {
    return normalizeTrackFx({
      ...fx,
      type: "eq",
      low: bands.low,
      mid: bands.mid,
      high: bands.high,
    });
  }
  return fx;
}

/**
 * Classic-song sample identity: each section kind keeps one home sample so
 * verse / chorus returns reuse the same voice. Contrast lives in bridge/outro.
 * Selection prefers role spectral seat + avoids stacking with other tracks.
 * `variety` 0 = greedy best (same samples across seeds); 1 = seed-weighted mix.
 */
function pickHomeSampleForKind(
  kind: SectionKind,
  role: ExprRole,
  pool: SequenceSampleIn[],
  assigned: Map<SectionKind, SequenceSampleIn>,
  occupied: readonly SpectralOccupancy[],
  rnd: () => number,
  variety: number,
): SequenceSampleIn {
  const cached = assigned.get(kind);
  if (cached) return cached;
  if (pool.length === 0) {
    throw new Error("pickHomeSampleForKind: empty pool");
  }

  if (kind === "prechorus" || kind === "intro") {
    const verse = assigned.get("verse");
    if (verse) {
      assigned.set(kind, verse);
      return verse;
    }
  }
  if (kind === "verse") {
    const intro = assigned.get("intro");
    if (intro) {
      assigned.set(kind, intro);
      return intro;
    }
  }
  if (kind === "outro") {
    const bridge = assigned.get("bridge");
    if (bridge) {
      assigned.set(kind, bridge);
      return bridge;
    }
  }

  const avoidIds = new Set<string>();
  if (kind === "chorus") {
    const verse = assigned.get("verse");
    if (verse) avoidIds.add(verse.id);
  }
  if (kind === "bridge" || kind === "outro") {
    for (const s of assigned.values()) avoidIds.add(s.id);
  }

  const scored = pool.map((s) => {
    let sc =
      scoreSampleForRole(s, role, variety) +
      spectralClashPenalty(s, role, occupied);
    // Soft penalty when alternatives exist; chorus hard-prefer below.
    if (avoidIds.has(s.id) && pool.length > 1) sc += 2.8;
    if (variety > 0) sc += (rnd() - 0.5) * variety * 4;
    return { item: s, score: sc };
  });
  // Chorus must sound distinct from verse when the pool has ≥2 samples.
  const chorusPool =
    kind === "chorus" && avoidIds.size > 0
      ? scored.filter((x) => !avoidIds.has(x.item.id))
      : scored;
  const pickFrom = chorusPool.length > 0 ? chorusPool : scored;
  const best = pickScored(pickFrom, rnd, variety);
  assigned.set(kind, best);
  return best;
}

/** Lower score = better. variety 0 = argmin; higher = softmax over the seed. */
function pickScored<T>(
  scored: Array<{ item: T; score: number }>,
  rnd: () => number,
  variety: number,
): T {
  const first = scored[0];
  if (!first) {
    throw new Error("pickScored: empty");
  }
  if (scored.length === 1 || variety <= 0) {
    let best = first;
    for (const x of scored) {
      if (x.score < best.score) best = x;
    }
    return best.item;
  }
  const temp = 0.35 + variety * 3.2;
  const weights = scored.map((x) => Math.exp(-x.score / temp));
  let sum = 0;
  for (const w of weights) sum += w;
  let r = rnd() * sum;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return scored[i]!.item;
  }
  return scored[scored.length - 1]!.item;
}

function registerSpectralOccupancy(
  occupied: SpectralOccupancy[],
  role: ExprRole,
  sample: SequenceSampleIn,
): void {
  const hz = sampleCentroidHz(sample);
  if (hz == null) return;
  if (occupied.some((o) => o.id === sample.id)) return;
  occupied.push({ id: sample.id, role, hz });
}

/**
 * Deterministic presence schedule for a role on a section bar.
 * Soft RNG (±5%) only at thresholds so form stays audible (anti-boue / anti-vide).
 */
export function sectionAllowsRole(
  role: ExprRole,
  section: Pick<SongSection, "kind" | "bars">,
  barInSection: number,
  energy: number,
  rnd: () => number,
): boolean {
  const { kind, bars } = section;
  const last = barInSection >= Math.max(0, bars - 1);
  const progress =
    bars <= 1 ? 0.5 : clamp(barInSection / Math.max(1, bars - 1), 0, 1);
  const e = clamp(energy, 0, 1);
  /** Soften a hard gate near the threshold only. */
  const soft = (hard: boolean, margin = 0.05): boolean => {
    if (hard) return rnd() >= margin * (1 - e * 0.5);
    return rnd() < margin * (0.5 + e * 0.5);
  };

  switch (kind) {
    case "intro": {
      // Beds from bar 0; kit enters mid; lead on last half
      if (role === "texture" || role === "loop") return soft(true);
      if (role === "chord") return soft(true);
      if (role === "bass") return soft(progress >= 0.08 || bars <= 2);
      if (role === "kick") return soft(progress >= 0.25);
      if (role === "perc") return soft(progress >= 0.35);
      if (role === "hat") return soft(progress >= 0.45);
      if (role === "snare") return soft(progress >= 0.55);
      if (role === "arp") return soft(progress >= 0.4);
      if (role === "lead") return soft(progress >= 0.5 || last);
      if (role === "fx") return soft(progress >= 0.6 && e > 0.4);
      return soft(progress >= 0.3);
    }
    case "verse": {
      if (role === "fx") return soft(false);
      if (role === "texture") return soft(barInSection % 2 === 0);
      if (role === "lead") return soft(true); // present but thinned in evolve
      if (role === "arp") return soft(barInSection % 2 === 0 || e > 0.55);
      if (role === "hat") return soft(true);
      return true;
    }
    case "prechorus": {
      if (role === "fx") return soft(progress >= 0.4);
      if (role === "lead") return soft(true);
      return true;
    }
    case "chorus":
      return true;
    case "bridge": {
      // Stable drop: silence kit on even bars; keep beds / colour
      const kitDrop = barInSection % 2 === 0;
      if (role === "kick" || role === "snare") return soft(!kitDrop && e > 0.55);
      if (role === "hat") return soft(!kitDrop);
      if (role === "perc") return soft(barInSection % 2 === 1);
      if (role === "bass") return soft(barInSection % 2 === 1 || e > 0.65);
      if (role === "chord") return soft(true);
      return true;
    }
    case "outro": {
      // Last bar: keep melodic / bed accents; kit mostly gone
      if (last) {
        if (role === "lead" || role === "bass" || role === "chord") return true;
        if (role === "texture" || role === "loop") return true;
        if (role === "arp") return soft(e > 0.45);
        if (role === "kick") return soft(false);
        if (isDrumRole(role)) return soft(false);
        if (role === "fx") return soft(false);
        return soft(true);
      }
      const keep = 1 - progress * 0.85;
      if (isDrumRole(role)) return soft(progress < 0.45 && keep > 0.4);
      if (role === "lead") return soft(progress < 0.75);
      if (role === "arp") return soft(progress < 0.65);
      if (role === "bass" || role === "chord") return soft(progress < 0.85);
      if (role === "fx") return soft(progress < 0.5);
      return soft(progress < 0.9);
    }
    default:
      return true;
  }
}

type MotifHit = {
  tickInBar: number;
  gainDb: number;
  accent: boolean;
  /** Lead cell degree (chord-relative); survives hit filtering. */
  melodyDegree?: number;
};

const ROLE_TRACK_ORDER: ExprRole[] = [
  "kick",
  "snare",
  "hat",
  "bass",
  "chord",
  "lead",
  "arp",
  "texture",
  "loop",
  "perc",
  "fx",
];

const DRUM_ROLES: readonly ExprRole[] = ["kick", "snare", "hat", "perc"];
const TEXTURE_ROLES: readonly ExprRole[] = [
  "texture",
  "loop",
  "fx",
  "chord",
  "lead",
  "arp",
  "bass",
];

const ROLE_FALLBACKS: Record<ExprRole, ExprRole[]> = {
  kick: ["perc", "bass", "loop"],
  snare: ["perc", "hat", "fx"],
  hat: ["perc", "fx", "texture"],
  perc: ["hat", "snare", "kick"],
  bass: ["chord", "lead", "loop"],
  chord: ["lead", "texture", "bass"],
  lead: ["arp", "chord", "loop", "fx"],
  arp: ["lead", "chord", "bass"],
  texture: ["fx", "chord", "loop"],
  loop: ["texture", "perc", "chord"],
  fx: ["texture", "perc", "hat"],
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

const NOTE_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const FADE_CURVES: FadeCurve[] = [
  "linear",
  "equal-power",
  "exponential",
  "s-curve",
];

function msToLengthTick(durationMs: number, bpm: number, ppq: number): number {
  return Math.max(
    Math.floor(ppq / 4),
    Math.round(((durationMs / 1000) * bpm * ppq) / 60),
  );
}

/** Continuous MIDI from Hz (A4=440 → 69). Never round — justesse §5bis. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Exact retune so sounding = targetMidi + tuningOffset (equal-tempered). */
export function exactPitchSemitones(
  targetMidi: number,
  sourceMidi: number,
  stretchPitchSemis = 0,
  tuningOffsetCents = 0,
): number {
  return (
    targetMidi + tuningOffsetCents / 100 - sourceMidi - stretchPitchSemis
  );
}

/**
 * Melodic eligibility: needs a fundamental, enough confidence, low drift.
 * Near ±50¢ with weak confidence → exclude (class flip risk).
 */
export function isMelodicPitchReliable(s: SequenceSampleIn): boolean {
  const midi = sampleSourceMidi(s);
  if (midi == null) return false;
  const conf =
    s.pitchConfidence ??
    s.confidence ??
    (s.harmonicity != null && Number.isFinite(s.harmonicity)
      ? Math.min(1, Math.max(0, s.harmonicity))
      : 0.55);
  const drift = s.pitchDriftCents ?? 0;
  if (!(conf >= 0.45) || drift > 25) return false;
  const centsFromEt = (midi - Math.round(midi)) * 100;
  if (Math.abs(centsFromEt) > 45 && conf < 0.6) return false;
  return true;
}

/** Weighted median cents-from-ET of reliable tonal samples (library tuning). */
export function estimateLibraryTuningOffsetCents(
  samples: readonly SequenceSampleIn[],
): { offsetCents: number; dispersionCents: number } {
  const rows: { c: number; w: number }[] = [];
  for (const s of samples) {
    if (!isMelodicPitchReliable(s)) continue;
    const midi = sampleSourceMidi(s);
    if (midi == null) continue;
    const w =
      s.pitchConfidence ??
      s.confidence ??
      (s.harmonicity != null ? Math.min(1, Math.max(0.1, s.harmonicity)) : 0.5);
    rows.push({ c: (midi - Math.round(midi)) * 100, w });
  }
  if (rows.length === 0) return { offsetCents: 0, dispersionCents: 0 };
  rows.sort((a, b) => a.c - b.c);
  const totalW = rows.reduce((s, r) => s + r.w, 0);
  let acc = 0;
  let median = rows[0]!.c;
  for (const r of rows) {
    acc += r.w;
    if (acc >= totalW / 2) {
      median = r.c;
      break;
    }
  }
  const mean =
    rows.reduce((s, r) => s + r.c * r.w, 0) / Math.max(1e-9, totalW);
  const variance =
    rows.reduce((s, r) => s + r.w * (r.c - mean) ** 2, 0) /
    Math.max(1e-9, totalW);
  return { offsetCents: median, dispersionCents: Math.sqrt(variance) };
}

export type TuningRefMode = "440" | "library" | "auto";

/** Resolve global tuning offset (cents vs A440 equal temperament). */
export function resolveTuningOffsetCents(
  mode: TuningRefMode,
  samples: readonly SequenceSampleIn[],
): number {
  if (mode === "440") return 0;
  const { offsetCents, dispersionCents } =
    estimateLibraryTuningOffsetCents(samples);
  if (mode === "library") return offsetCents;
  if (Math.abs(offsetCents) > 15 && dispersionCents < 20) return offsetCents;
  return 0;
}

/** Sounding MIDI after transpose + resample stretch. */
export function soundingMidi(
  sourceMidi: number,
  pitchSemitones: number,
  stretchPitchSemis = 0,
): number {
  return sourceMidi + pitchSemitones + stretchPitchSemis;
}

/** Parse note names like `A4`, `C#3`, `Bb2` → MIDI, or null. */
export function noteNameToMidi(name: string): number | null {
  const m = name.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const oct = Number(m[3]);
  let pc = NOTE_PC[letter];
  if (pc == null || !Number.isFinite(oct)) return null;
  if (acc === "#") pc += 1;
  if (acc === "b") pc -= 1;
  return (oct + 1) * 12 + (((pc % 12) + 12) % 12);
}

export function sampleSourceMidi(s: SequenceSampleIn): number | null {
  if (s.pitchHz != null && s.pitchHz > 20 && s.pitchHz < 5000) {
    return hzToMidi(s.pitchHz);
  }
  if (s.noteName) return noteNameToMidi(s.noteName);
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pickInt(rnd: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

function pickGroove(rnd: () => number, styleGroove?: GrooveKind): GrooveKind {
  if (styleGroove) {
    // Keep style lean most of the time; rare seed variation.
    if (rnd() < 0.82) return styleGroove;
  }
  const r = rnd();
  if (r < 0.55) return "straight";
  if (r < 0.8) return "shuffle";
  return "half-time";
}

const KEY_NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export function keyPcLabel(pc: number): string {
  return KEY_NOTE_NAMES[((pc % 12) + 12) % 12] ?? "C";
}

function isDrumRole(role: ExprRole): boolean {
  return role === "kick" || role === "snare" || role === "hat" || role === "perc";
}

function isMelodicRole(role: ExprRole): boolean {
  return (
    role === "bass" || role === "chord" || role === "lead" || role === "arp"
  );
}

function dominantSampleClass(s: SequenceSampleIn): string {
  const scores = s.classScores;
  if (!scores) return s.class;
  let best = s.class;
  let bestW = -1;
  for (const [k, v] of Object.entries(scores)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v > bestW) {
      bestW = v;
      best = k;
    }
  }
  // Only override stored class when the soft vote is clearly ahead.
  if (bestW >= 0.45 && best !== s.class) {
    const stored = scores[s.class] ?? 0;
    if (bestW >= stored + 0.12) return best;
  }
  return s.class;
}

/**
 * Map library sample → kit / instrument role from class + analysis cues.
 * Conservative on field captures: prefer texture/loop/fx unless cues are strong.
 */
export function inferExprRole(s: SequenceSampleIn): ExprRole {
  const dur = s.durationMs;
  const cent = s.centroidHz ?? 0;
  const harm = s.harmonicity ?? 0;
  const td = s.transientDensity ?? 0;
  const midi = sampleSourceMidi(s);
  const cls = dominantSampleClass(s);
  const short = dur > 0 && dur < 220;
  const midShort = dur > 0 && dur < 420;
  const long = dur >= 900;
  const veryLong = dur >= 2500;

  // Long beds → texture / loop / fx (field-recording bias)
  if (veryLong && harm < 0.55 && td < 0.35) {
    if (cls === "rhythmic" || (s.loopScore ?? 0) > 0.45) return "loop";
    if (td > 0.2 && cent > 2800) return "fx";
    return "texture";
  }

  if (cls === "texture" || (cls === "noise" && long)) {
    if (dur < 350 && (td > 0.4 || cent > 2800)) return "fx";
    if ((s.loopScore ?? 0) > 0.5) return "loop";
    return "texture";
  }

  if (cls === "rhythmic") {
    if (long) return "loop";
    if (midShort && td > 0.3) return "perc";
    return "loop";
  }

  if (cls === "voice") {
    if (long) return "texture";
    if (midi != null && midi < 52) return "bass";
    return harm > 0.4 ? "lead" : "fx";
  }

  if (cls === "tonal") {
    if (midi != null && midi < 48) return "bass";
    if (harm > 0.5 && dur > 500) return "chord";
    if (dur < 600) return "lead";
    return harm > 0.35 ? "chord" : "texture";
  }

  // Percussive / noise shorts — need stronger cues for kick/snare/hat
  if (cls === "percussive" || (cls === "noise" && midShort)) {
    const strongKick =
      midShort &&
      cent > 0 &&
      cent < 320 &&
      harm < 0.4 &&
      (td > 0.15 || short);
    const strongHat =
      short &&
      (cent >= 3500 || (cent === 0 && td > 0.35)) &&
      harm < 0.35;
    const strongSnare =
      midShort &&
      cent >= 500 &&
      cent < 2800 &&
      td > 0.2 &&
      harm < 0.45;

    if (strongKick) return "kick";
    if (strongHat) return "hat";
    if (strongSnare) return "snare";
    // Soft percussive field hits → perc / fx, not kit
    if (short && td > 0.25) return "perc";
    if (long) return "texture";
    return "perc";
  }

  if (cls === "unclassified") {
    if (veryLong) return "texture";
    if (midi != null && midi < 50 && harm > 0.3) return "bass";
    if (harm > 0.5 && dur > 400) return "chord";
    if (short && td > 0.3) return "perc";
    if (long) return "texture";
    return "fx";
  }

  if (dur >= 1200) return "texture";
  if (midi != null && midi < 50) return "bass";
  if (harm > 0.45 && dur > 400) return "chord";
  return "perc";
}

/**
 * Manual forceRole → tag `role:*` → Demucs stem → YAMNet → DSP inference.
 */
export function resolveExprRole(s: SequenceSampleIn): ExprRole {
  if (s.forceRole) {
    const p = ExprRoleSchema.safeParse(s.forceRole);
    if (p.success) return p.data;
  }
  const fromTag = parseExprRoleTag(s.tags);
  if (fromTag) return fromTag;
  const fromStem = roleHintFromStem(s.stem, s.yamnet, s.subclass);
  if (fromStem) return fromStem;
  const fromYamnet = roleHintFromYamnet(s.yamnet, s.subclass);
  if (fromYamnet) return fromYamnet;
  return inferExprRole(s);
}

/**
 * Classical pop/rock song schemas, scaled to `bars`.
 * Texture-leaning mix → sparser ambient form.
 */
export function planSongForm(
  bars: number,
  rnd: () => number,
  opts?: {
    drumsVsTexture?: number;
    energy?: number;
    formStyle?: GenFormStyle;
    formLean?: "song" | "ambient";
  },
): SongSection[] {
  if (bars < 1) return [];
  const dvt = opts?.drumsVsTexture ?? 0.55;
  const energy = opts?.energy ?? 0.55;
  const form = opts?.formStyle ?? "auto";
  const ambient =
    form === "ambient"
      ? true
      : form === "song"
        ? false
        : opts?.formLean === "ambient"
          ? true
          : opts?.formLean === "song"
            ? false
            : dvt < 0.4;

  type Unit = {
    kind: SectionKind;
    weight: number;
    densityMul: number;
    gainBiasDb: number;
    evolve: number;
    fillLastBar: boolean;
    altSample: boolean;
  };

  const eBoost = (base: number) => sectionDensityBoost(base, energy);

  let units: Unit[];
  if (ambient) {
    if (bars <= 8) {
      units = [
        {
          kind: "intro",
          weight: 2,
          densityMul: eBoost(0.22),
          gainBiasDb: -5.5,
          evolve: 0.12,
          fillLastBar: false,
          altSample: false,
        },
        {
          kind: "verse",
          weight: 4,
          densityMul: eBoost(0.5),
          gainBiasDb: -1.5,
          evolve: 0.3,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "chorus",
          weight: 3,
          densityMul: eBoost(0.85),
          gainBiasDb: 1.5,
          evolve: 0.4,
          fillLastBar: false,
          altSample: false,
        },
        {
          kind: "outro",
          weight: 2,
          densityMul: eBoost(0.2),
          gainBiasDb: -5,
          evolve: 0.45,
          fillLastBar: false,
          altSample: true,
        },
      ];
    } else if (bars <= 48) {
      units = [
        {
          kind: "intro",
          weight: 3,
          densityMul: eBoost(0.18),
          gainBiasDb: -6.5,
          evolve: 0.1,
          fillLastBar: false,
          altSample: false,
        },
        {
          kind: "verse",
          weight: 5,
          densityMul: eBoost(0.45),
          gainBiasDb: -2,
          evolve: 0.28,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "bridge",
          weight: 4,
          densityMul: eBoost(0.28),
          gainBiasDb: -3.5,
          evolve: 0.55,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "chorus",
          weight: 4,
          densityMul: eBoost(0.9),
          gainBiasDb: 2,
          evolve: 0.45,
          fillLastBar: true,
          altSample: false,
        },
        {
          kind: "outro",
          weight: 3,
          densityMul: eBoost(0.18),
          gainBiasDb: -5.5,
          evolve: 0.5,
          fillLastBar: false,
          altSample: true,
        },
      ];
    } else {
      // Long ambient: slow arc with space for kinship / sparse dialogue
      units = [
        {
          kind: "intro",
          weight: 4,
          densityMul: eBoost(0.15),
          gainBiasDb: -7,
          evolve: 0.08,
          fillLastBar: false,
          altSample: false,
        },
        {
          kind: "verse",
          weight: 6,
          densityMul: eBoost(0.4),
          gainBiasDb: -2.2,
          evolve: 0.22,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "bridge",
          weight: 5,
          densityMul: eBoost(0.25),
          gainBiasDb: -3.8,
          evolve: 0.5,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "chorus",
          weight: 5,
          densityMul: eBoost(0.85),
          gainBiasDb: 1.8,
          evolve: 0.4,
          fillLastBar: true,
          altSample: false,
        },
        {
          kind: "verse",
          weight: 5,
          densityMul: eBoost(0.42),
          gainBiasDb: -2,
          evolve: 0.35,
          fillLastBar: false,
          altSample: true,
        },
        {
          kind: "outro",
          weight: 4,
          densityMul: eBoost(0.15),
          gainBiasDb: -6,
          evolve: 0.55,
          fillLastBar: false,
          altSample: true,
        },
      ];
    }
  } else if (bars <= 4) {
    units = [
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.65),
        gainBiasDb: -2,
        evolve: 0.12,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.15),
        gainBiasDb: 2.2,
        evolve: 0.28,
        fillLastBar: true,
        altSample: false,
      },
    ];
  } else if (bars <= 8) {
    units = [
      {
        kind: "intro",
        weight: 1,
        densityMul: eBoost(0.28),
        gainBiasDb: -5.5,
        evolve: 0.08,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.7),
        gainBiasDb: -1.2,
        evolve: 0.18,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.2),
        gainBiasDb: 2.4,
        evolve: 0.32,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 1,
        densityMul: eBoost(0.75),
        gainBiasDb: -0.5,
        evolve: 0.3,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.28),
        gainBiasDb: 2.8,
        evolve: 0.4,
        fillLastBar: true,
        altSample: false,
      },
    ];
  } else if (bars <= 16) {
    units = [
      {
        kind: "intro",
        weight: 2,
        densityMul: eBoost(0.25),
        gainBiasDb: -6,
        evolve: 0.08,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.68),
        gainBiasDb: -1.5,
        evolve: 0.16,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.95),
        gainBiasDb: 0.6,
        evolve: 0.38,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.22),
        gainBiasDb: 2.6,
        evolve: 0.3,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.72),
        gainBiasDb: -0.8,
        evolve: 0.35,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.3),
        gainBiasDb: 3,
        evolve: 0.45,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "outro",
        weight: 2,
        densityMul: eBoost(0.32),
        gainBiasDb: -4.5,
        evolve: 0.45,
        fillLastBar: false,
        altSample: true,
      },
    ];
  } else if (bars <= 48) {
    // Mid-length song: classic two-chorus + bridge return
    units = [
      {
        kind: "intro",
        weight: 2,
        densityMul: eBoost(0.22),
        gainBiasDb: -6.5,
        evolve: 0.06,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.65),
        gainBiasDb: -1.8,
        evolve: 0.14,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.95),
        gainBiasDb: 0.8,
        evolve: 0.35,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.2),
        gainBiasDb: 2.5,
        evolve: 0.28,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.7),
        gainBiasDb: -1,
        evolve: 0.35,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.28),
        gainBiasDb: 2.8,
        evolve: 0.4,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "bridge",
        weight: 4,
        densityMul: eBoost(0.32),
        gainBiasDb: -3.5,
        evolve: 0.55,
        fillLastBar: false,
        altSample: true,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.35),
        gainBiasDb: 3.2,
        evolve: 0.5,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "outro",
        weight: 2,
        densityMul: eBoost(0.28),
        gainBiasDb: -5,
        evolve: 0.5,
        fillLastBar: false,
        altSample: true,
      },
    ];
    if (rnd() < 0.35) {
      units = units.filter((u) => u.kind !== "prechorus");
    }
  } else {
    // Long song (≥49 bars): room for dialogue + recall without crushing sections
    units = [
      {
        kind: "intro",
        weight: 3,
        densityMul: eBoost(0.2),
        gainBiasDb: -6.5,
        evolve: 0.05,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 5,
        densityMul: eBoost(0.62),
        gainBiasDb: -1.8,
        evolve: 0.12,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.92),
        gainBiasDb: 0.6,
        evolve: 0.32,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 5,
        densityMul: eBoost(1.18),
        gainBiasDb: 2.4,
        evolve: 0.25,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 5,
        densityMul: eBoost(0.68),
        gainBiasDb: -1.2,
        evolve: 0.32,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.98),
        gainBiasDb: 0.9,
        evolve: 0.38,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 5,
        densityMul: eBoost(1.26),
        gainBiasDb: 2.8,
        evolve: 0.38,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "bridge",
        weight: 4,
        densityMul: eBoost(0.3),
        gainBiasDb: -3.8,
        evolve: 0.55,
        fillLastBar: false,
        altSample: true,
      },
      {
        kind: "chorus",
        weight: 6,
        densityMul: eBoost(1.38),
        gainBiasDb: 3.3,
        evolve: 0.52,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "outro",
        weight: 3,
        densityMul: eBoost(0.25),
        gainBiasDb: -5.5,
        evolve: 0.55,
        fillLastBar: false,
        altSample: true,
      },
    ];
  }

  // Song form: widen verse↔chorus, handoff intro, clearer outro (anti-flat form).
  if (!ambient) {
    for (const u of units) {
      if (u.kind === "intro") {
        u.fillLastBar = true;
        u.densityMul = clamp(u.densityMul * 1.3, 0.22, 0.48);
      } else if (u.kind === "verse") {
        u.densityMul = clamp(u.densityMul * 0.82, 0.35, 0.72);
        u.gainBiasDb -= 0.7;
      } else if (u.kind === "chorus") {
        u.densityMul = clamp(u.densityMul * 1.12, 1.05, 1.65);
        u.gainBiasDb += 0.7;
      } else if (u.kind === "outro") {
        u.fillLastBar = false;
        u.gainBiasDb -= 1.2;
        u.densityMul = clamp(u.densityMul * 0.9, 0.15, 0.4);
      }
    }
  }

  const totalW = units.reduce((s, u) => s + u.weight, 0);
  const raw = units.map((u) => ({
    ...u,
    bars: Math.max(1, Math.round((u.weight / totalW) * bars)),
  }));
  let sum = raw.reduce((s, u) => s + u.bars, 0);
  while (sum > bars && raw.length > 0) {
    const last = raw[raw.length - 1]!;
    if (last.bars > 1) {
      last.bars -= 1;
      sum -= 1;
    } else if (raw.length > 1) {
      raw.pop();
      sum -= 1;
    } else break;
  }
  while (sum < bars) {
    const host =
      raw.find((u) => u.kind === "chorus") ?? raw[raw.length - 1]!;
    host.bars += 1;
    sum += 1;
  }

  let startBar = 0;
  return raw.map((u) => {
    const sec: SongSection = {
      kind: u.kind,
      startBar,
      bars: u.bars,
      densityMul: u.densityMul,
      gainBiasDb: u.gainBiasDb,
      evolve: u.evolve,
      fillLastBar: u.fillLastBar,
      altSample: u.altSample,
    };
    startBar += u.bars;
    return sec;
  });
}

function scoreSampleForRole(
  s: SequenceSampleIn,
  role: ExprRole,
  variety = 0,
): number {
  const inferred = resolveExprRole(s);
  const popScale = 1 - clamp(variety, 0, 1) * 0.85;
  let score = inferred === role ? 0 : 8;
  const fb = ROLE_FALLBACKS[role] ?? [];
  const fi = fb.indexOf(inferred);
  if (inferred !== role && fi >= 0) score = 2 + fi;
  if (s.forceRole === role) score -= 4;
  if (s.favorite) score -= 1.5 * popScale;
  if (isDrumRole(role)) {
    if (s.durationMs < 600) score -= 1;
    if ((s.transientDensity ?? 0) > 0.2) score -= 0.5;
  }
  if (role === "texture" || role === "loop") {
    if ((s.loopScore ?? 0) > 0.4) score -= 1.5;
    if (s.durationMs > 800) score -= 0.5;
    if (s.loopStartMs != null && s.loopEndMs != null) score -= 0.6;
  }
  if (role === "bass" && (sampleSourceMidi(s) ?? 60) < 52) score -= 1;
  if (role === "chord" && (s.harmonicity ?? 0) > 0.35) score -= 1;
  if (role === "lead" && (s.harmonicity ?? 0) > 0.4) score -= 0.6;
  if (role === "arp") {
    // Duration irrelevant — long takes are gated + ADSR (preserve dest pitch).
    if ((s.harmonicity ?? 0) > 0.4) score -= 1;
    if (sampleSourceMidi(s) != null) score -= 1.2;
    if (isMelodicClass(s.class, s.harmonicity)) score -= 0.8;
  }
  // Melodic placement always retunes from recorded fundamental — require it.
  if (
    (role === "arp" ||
      role === "lead" ||
      role === "bass" ||
      role === "chord") &&
    sampleSourceMidi(s) == null
  ) {
    score += 6;
  } else if (
    (role === "arp" || role === "lead" || role === "bass" || role === "chord") &&
    sampleSourceMidi(s) != null
  ) {
    score -= 1.5;
  }
  // Seat the voice in the mix: prefer samples whose centroid matches the role band
  score += spectralFitPenalty(s, role);
  // Loudness / peak: prefer controlled levels for sustained roles
  if (s.lufs != null && Number.isFinite(s.lufs)) {
    if (role === "texture" || role === "loop" || role === "chord") {
      if (s.lufs > -12) score += 0.4;
      else if (s.lufs < -35) score += 0.25;
      else score -= 0.35;
    }
  }
  if (s.peakDbtp != null && Number.isFinite(s.peakDbtp)) {
    if (isDrumRole(role) && s.peakDbtp > -1) score -= 0.35;
    if ((role === "texture" || role === "fx") && s.peakDbtp > -0.5) score += 0.4;
  }
  // Soft class vote agreement
  const scores = s.classScores;
  if (scores) {
    const want =
      isDrumRole(role)
        ? scores.percussive
        : role === "texture" || role === "loop"
          ? Math.max(scores.texture ?? 0, scores.rhythmic ?? 0)
          : role === "lead" || role === "bass" || role === "chord" || role === "arp"
            ? Math.max(scores.tonal ?? 0, scores.voice ?? 0)
            : undefined;
    if (want != null && want > 0.4) score -= want;
  }
  score += mlScoreAdjust(s, role, inferred, popScale);
  return score;
}

function rankSamplesForRole(
  pool: SequenceSampleIn[],
  role: ExprRole,
  rnd: () => number,
  variety: number,
): SequenceSampleIn[] {
  const scored = pool.map((s) => ({
    s,
    sc:
      scoreSampleForRole(s, role, variety) +
      (variety > 0 ? (rnd() - 0.5) * variety * 6 : 0),
  }));
  scored.sort((a, b) => a.sc - b.sc || a.s.id.localeCompare(b.s.id));
  return scored.map((x) => x.s);
}

function assignTrackRoles(
  trackCount: number,
  pool: SequenceSampleIn[],
  rnd: () => number,
  drumsVsTexture: number,
): ExprRole[] {
  const available = new Map<ExprRole, number>();
  for (const s of pool) {
    const r = resolveExprRole(s);
    available.set(r, (available.get(r) ?? 0) + 1);
  }

  // Tonal pitched samples can drive an arp track (any length — gated at place time).
  let melodicOneshots = 0;
  for (const s of pool) {
    const r = resolveExprRole(s);
    if (
      (r === "lead" || r === "chord" || r === "bass" || r === "arp") &&
      s.durationMs > 40 &&
      (isMelodicClass(s.class, s.harmonicity) || sampleSourceMidi(s) != null)
    ) {
      melodicOneshots += 1;
    }
  }
  if (melodicOneshots >= 2) {
    available.set("arp", Math.max(available.get("arp") ?? 0, melodicOneshots));
  }

  const preferDrums = drumsVsTexture >= 0.5;
  const order = preferDrums
    ? [...ROLE_TRACK_ORDER]
    : [
        ...TEXTURE_ROLES,
        ...DRUM_ROLES.filter((r) => !TEXTURE_ROLES.includes(r)),
      ];

  const roles: ExprRole[] = [];
  const used = new Set<ExprRole>();

  // Soft quota: when texture-leaning, skip early drum slots if no strong inventory
  for (const preferred of order) {
    if (roles.length >= trackCount) break;
    const n = available.get(preferred) ?? 0;
    if (isDrumRole(preferred) && drumsVsTexture < 0.35 && n === 0) continue;
    if (
      (preferred === "texture" || preferred === "loop" || preferred === "fx") &&
      drumsVsTexture > 0.8 &&
      n === 0 &&
      roles.length < 3
    ) {
      continue;
    }
    if (n > 0 || preferred === "perc" || preferred === "fx") {
      if (n > 0 || roles.length >= 3) {
        roles.push(preferred);
        used.add(preferred);
      }
    }
  }

  const leftovers = order.filter((r) => !used.has(r));
  while (roles.length < trackCount) {
    let best: ExprRole | null = null;
    let bestN = -1;
    for (const r of leftovers) {
      const n = available.get(r) ?? 0;
      if (n > bestN) {
        bestN = n;
        best = r;
      }
    }
    if (best && bestN > 0) {
      roles.push(best);
      leftovers.splice(leftovers.indexOf(best), 1);
    } else {
      const fallbackOrder =
        drumsVsTexture < 0.4 ? TEXTURE_ROLES : ROLE_TRACK_ORDER;
      roles.push(fallbackOrder[roles.length % fallbackOrder.length]!);
    }
  }

  if (rnd() < 0.3 && roles.length > 4) {
    const i = pickInt(rnd, 3, roles.length - 1);
    const j = pickInt(rnd, 3, roles.length - 1);
    const tmp = roles[i]!;
    roles[i] = roles[j]!;
    roles[j] = tmp;
  }
  return roles.slice(0, trackCount);
}

function isMelodicClass(cls: string, harmonicity?: number): boolean {
  if (cls === "tonal" || cls === "voice") return true;
  if (cls === "rhythmic" && (harmonicity ?? 0) > 0.45) return true;
  return (harmonicity ?? 0) > 0.6;
}

/**
 * Consecutive bars that share the same chord (degree + voicing).
 * Used to keep pads / holds from ringing across a harmony change.
 */
export function chordRunBars(
  timeline: readonly HarmonyBar[],
  startBar: number,
  maxBars: number,
): number {
  const max = Math.max(1, Math.floor(maxBars));
  const start = timeline[startBar];
  if (!start || max <= 1) return 1;
  let n = 1;
  while (n < max) {
    const next = timeline[startBar + n];
    if (!next || next.degree !== start.degree) break;
    if (next.tones.length !== start.tones.length) break;
    if (!next.tones.every((t, i) => t === start.tones[i])) break;
    n++;
  }
  return n;
}

/**
 * True when an exact retune of `fromMidi` by `semis` (+ stretch) lands on an
 * integer target pitch-class in `allowedRels` (membership on the **target**,
 * never on Math.round(source)).
 */
function isScaleCompatibleTranspose(
  fromMidi: number,
  semis: number,
  rootPc: number,
  allowedRels: readonly number[],
  stretchSemis = 0,
  tuningOffsetCents = 0,
): boolean {
  const sounding = soundingMidi(fromMidi, semis, stretchSemis);
  const target = sounding - tuningOffsetCents / 100;
  // Exact retune ⇒ target is integer; tolerate 0.5¢ float noise.
  if (Math.abs(target - Math.round(target)) > 0.005) return false;
  const pc = (((Math.round(target) % 12) + 12) % 12);
  const rel = (pc - rootPc + 12) % 12;
  return allowedRels.includes(rel);
}

/**
 * Exact float transposes in [-maxDown, maxUp] that land on allowed degree
 * targets (partition integers). Compensates stretch + library tuning.
 */
export function scaleCompatibleTransposes(
  fromMidi: number,
  rootPc: number,
  scale: readonly number[],
  maxUp: number,
  maxDown: number,
  stretchSemis = 0,
  allowedRels?: readonly number[],
  tuningOffsetCents = 0,
): number[] {
  const rels = allowedRels && allowedRels.length > 0 ? allowedRels : scale;
  const up = Math.max(0, maxUp);
  const down = Math.max(0, maxDown);
  const collect = (hi: number, lo: number): number[] => {
    const out: number[] = [];
    const seen = new Set<string>();
    const midiLo = Math.floor(fromMidi + stretchSemis - lo - 2);
    const midiHi = Math.ceil(fromMidi + stretchSemis + hi + 2);
    for (let target = midiLo; target <= midiHi; target++) {
      const pc = ((target % 12) + 12) % 12;
      const rel = (pc - rootPc + 12) % 12;
      if (!rels.includes(rel)) continue;
      const semis = exactPitchSemitones(
        target,
        fromMidi,
        stretchSemis,
        tuningOffsetCents,
      );
      if (semis < -lo - 1e-9 || semis > hi + 1e-9) continue;
      if (
        !isScaleCompatibleTranspose(
          fromMidi,
          semis,
          rootPc,
          rels,
          stretchSemis,
          tuningOffsetCents,
        )
      ) {
        continue;
      }
      const key = semis.toFixed(6);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(semis);
    }
    return out;
  };
  const inWindow = collect(up, down);
  if (inWindow.length > 0) return inWindow;
  const expanded = collect(24, 24);
  if (expanded.length > 0) return expanded;
  return [0];
}

/** Snap chord-relative cell degree to triad/7th/octave (anti false-notes). */
export function snapChordRelativeDegree(degree: number, accent: boolean): number {
  const tones = accent ? [0, 2, 4, 7] : [0, 2, 4, 5, 7];
  let best = 0;
  let bestDist = Infinity;
  for (const t of tones) {
    const d = Math.abs(degree - t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** Roles / samples that must stay on the song scale. */
function shouldEnforceScale(
  role: ExprRole,
  sample: SequenceSampleIn,
): boolean {
  if (isMelodicRole(role)) return isMelodicPitchReliable(sample);
  if (role === "chord") return isMelodicPitchReliable(sample);
  if (role === "texture" || role === "loop") {
    return (
      isMelodicPitchReliable(sample) ||
      (isMelodicClass(sample.class, sample.harmonicity) &&
        sampleSourceMidi(sample) != null)
    );
  }
  // Pitched drums / fx still read as notes when analysis found a fundamental.
  if (
    (isDrumRole(role) || role === "fx") &&
    isMelodicPitchReliable(sample)
  ) {
    return true;
  }
  return false;
}

/** Resample rate-pitches continuously — kills scale tuning on melodic parts. */
function forbidsResamplePitch(
  role: ExprRole,
  sample: SequenceSampleIn,
): boolean {
  return shouldEnforceScale(role, sample);
}

/** Nearest allowed transpose to `preferred` (ties → prefer smaller |semis|). */

/** Folded pitch-class distance into 0…6 (continuous). */

/**
 * Dominants conflict when they form a minor 2nd (±30¢), not rounded classes.
 */

/**
 * Two length ratios used by stretch / pitch math (must not be swapped):
 * - `fitFactor` = clip / natural — playback stretch amount; resample pitch.
 * - `artisticFactor` = clip / (natural × bpmLengthFactor) — stretch beyond
 *   tempo sync. Duration caps use this so BPM sync itself is not blocked.
 */
export function clipStretchFactors(
  lengthTick: number,
  naturalTick: number,
  bpmLengthFactor = 1,
): { fitFactor: number; artisticFactor: number } {
  const natural = Math.max(1, naturalTick);
  const bpmLf =
    Number.isFinite(bpmLengthFactor) && bpmLengthFactor > 0
      ? bpmLengthFactor
      : 1;
  const fitFactor = lengthTick / natural;
  return {
    fitFactor,
    artisticFactor: lengthTick / Math.max(1, natural * bpmLf),
  };
}

/**
 * Pitch shift (semitones) from stretch mode `resample` when fitting the
 * sample's natural duration into the clip.
 * `fitFactor` = clipTicks / naturalTicks (same as playback frames/target inverse).
 * Must NOT use the bpm-relative length factor (natural × bpmLengthFactor) —
 * that cancels the tempo-sync pitch and lets resample exceed the window.
 */
export function resampleStretchPitchSemis(fitFactor: number): number {
  if (!(fitFactor > 0) || !Number.isFinite(fitFactor)) return 0;
  return -12 * Math.log2(fitFactor);
}

function tempoAlignedForLoop(
  sample: SequenceSampleIn,
  projectBpm: number,
): boolean {
  const src = sample.analysisBpm;
  if (src == null || src < 40 || src > 240) {
    return (sample.loopScore ?? 0) > 0.55;
  }
  const ratio = projectBpm / src;
  if (Math.abs(ratio - 1) < 0.08) return true;
  // Half-time / double-time / … also count as grid-aligned.
  return nearTempoPow2(ratio);
}

/**
 * For tempo-matched loops: pick a musical sub-window to repeat instead of
 * always looping the whole file (or never looping a long take).
 */
function pickLoopContent(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  lengthMs: number;
  bpm: number;
  beatsPerBar: number;
  loopEnabled: boolean;
  stretchMode: StretchMode;
  energy: number;
  variation: number;
  rnd: () => number;
}): { contentOffsetMs: number; loopEnabled: boolean; loopLengthMs?: number } {
  const {
    sample,
    role,
    lengthMs,
    bpm,
    beatsPerBar,
    stretchMode,
    energy,
    variation,
    rnd,
  } = opts;
  let loopEnabled = opts.loopEnabled;

  const beatMs = 60_000 / Math.max(1, bpm);
  const barMs = beatMs * Math.max(1, beatsPerBar);
  const loopish =
    (sample.loopScore ?? 0) > 0.4 ||
    (sample.loopStartMs != null && sample.loopEndMs != null);
  const roleOk =
    role === "loop" ||
    role === "texture" ||
    role === "chord" ||
    role === "perc" ||
    role === "hat";
  const canPartial =
    stretchMode === "off" &&
    loopish &&
    roleOk &&
    tempoAlignedForLoop(sample, bpm) &&
    sample.durationMs > barMs * 1.15;

  if (canPartial && rnd() < 0.5 + variation * 0.3 + energy * 0.1) {
    const regionStart = sample.loopStartMs ?? 0;
    const regionEnd =
      sample.loopEndMs != null && sample.loopEndMs > regionStart
        ? sample.loopEndMs
        : sample.durationMs;
    const regionLen = Math.max(beatMs, regionEnd - regionStart);

    const sliceChoices = [barMs, barMs * 2, beatMs * 2, beatMs]
      .map((ms) => Math.round(ms))
      .filter((ms) => ms >= beatMs * 0.85 && ms <= regionLen * 0.98);
    const loopLengthMs =
      sliceChoices[pickInt(rnd, 0, Math.max(0, sliceChoices.length - 1))] ??
      Math.min(Math.round(barMs), Math.floor(regionLen));

    const maxOffset = Math.max(0, regionLen - loopLengthMs);
    const grid = Math.max(1, Math.floor(maxOffset / beatMs) + 1);
    const beatIndex = pickInt(rnd, 0, grid - 1);
    const contentOffsetMs = Math.round(
      regionStart + Math.min(maxOffset, beatIndex * beatMs),
    );

    // Only loop when the clip on the timeline is longer than the slice.
    if (lengthMs > loopLengthMs * 1.05) {
      return { contentOffsetMs, loopEnabled: true, loopLengthMs };
    }
    // Shorter/equal: play that window once (still a useful partial take).
    return {
      contentOffsetMs,
      loopEnabled: false,
      loopLengthMs: undefined,
    };
  }

  if (
    stretchMode === "off" &&
    !loopEnabled &&
    sample.durationMs > lengthMs + 40 &&
    !isDrumRole(role)
  ) {
    const window = Math.max(0, sample.durationMs - lengthMs);
    return {
      contentOffsetMs: Math.round(
        rnd() * window * (0.35 + energy * 0.5) * (0.4 + variation * 0.8),
      ),
      loopEnabled,
    };
  }

  // Existing full-file loop: prefer sample loop region length when present.
  if (
    loopEnabled &&
    sample.loopStartMs != null &&
    sample.loopEndMs != null &&
    sample.loopEndMs > sample.loopStartMs + 40
  ) {
    return {
      contentOffsetMs: sample.loopStartMs,
      loopEnabled: true,
      loopLengthMs: sample.loopEndMs - sample.loopStartMs,
    };
  }

  return { contentOffsetMs: 0, loopEnabled };
}

function stretchWithoutPitchShift(mode: StretchMode): StretchMode {
  return mode === "resample" ? "preserve-pitch" : mode;
}

/** Allowed tempo-rate multiples when pow2 lock is on. */
const TEMPO_POW2_RATIOS = [0.25, 0.5, 1, 2, 4, 8] as const;

/** Snap a tempo ratio (projectBpm / sampleBpm) to the nearest power of two. */
function snapTempoRatioPow2(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  let best: number = 1;
  let bestDist = Infinity;
  for (const p of TEMPO_POW2_RATIOS) {
    const d = Math.abs(Math.log2(ratio / p));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** True when ratio is already near a pow2 multiple (within ~6%). */
function nearTempoPow2(ratio: number, tolLog2 = 0.08): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  const snapped = snapTempoRatioPow2(ratio);
  return Math.abs(Math.log2(ratio / snapped)) <= tolLog2;
}

/**
 * Stretch toward project BPM when sample has `analysisBpm`.
 * Always `preserve-pitch` — tempo lock must not rate-pitch the sample.
 */
export function bpmSyncStretch(
  sample: SequenceSampleIn,
  projectBpm: number,
  role: ExprRole,
  rnd: () => number,
  mode: GenTriState = "auto",
  lockTempoPow2 = false,
): { stretchMode: "preserve-pitch"; lengthFactor: number } | null {
  if (mode === "off") return null;
  // Arp gates ignore sample tempo — length is cell-driven, pitch via semis.
  if (role === "arp") return null;
  const src = sample.analysisBpm;
  if (src == null || src < 40 || src > 240) return null;
  let ratio = projectBpm / src;
  if (lockTempoPow2) {
    ratio = snapTempoRatioPow2(ratio);
  }
  if (Math.abs(ratio - 1) < 0.04) return null;
  const synced = {
    stretchMode: "preserve-pitch" as const,
    lengthFactor: 1 / ratio,
  };
  // Forced sync: every role with usable BPM metadata.
  if (mode === "on") return synced;
  if (isDrumRole(role) && Math.abs(ratio - 1) > 0.25 && rnd() < 0.5) {
    // Drums (auto): prefer one-shot at native feel unless close
    return null;
  }
  if (
    role === "loop" ||
    role === "texture" ||
    role === "chord" ||
    isMelodicRole(role)
  ) {
    return synced;
  }
  return rnd() < 0.4 ? synced : null;
}

function pickStretchMode(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  lengthFactor: number;
  pitchSemitones: number;
  bpmSync: { stretchMode: StretchMode; lengthFactor: number } | null;
  energy: number;
  stutter: boolean;
  lockPitch: boolean;
  /** When false, never choose resample (pitch window forbids rate-pitch). */
  allowResamplePitch: boolean;
  rnd: () => number;
}): StretchMode {
  const {
    sample,
    role,
    lengthFactor,
    pitchSemitones,
    bpmSync,
    energy,
    stutter,
    lockPitch,
    allowResamplePitch,
    rnd,
  } = opts;
  const noResample =
    lockPitch || !allowResamplePitch || forbidsResamplePitch(role, sample);
  if (stutter) {
    const mode =
      rnd() < 0.6 || noResample ? "copy" : "resample";
    return noResample ? stretchWithoutPitchShift(mode) : mode;
  }
  // Arp: gate/truncate only — destination pitch is pitchSemitones, never
  // rate-pitch or time-stretch from note length vs sample duration.
  if (role === "arp") return "off";
  if (bpmSync) {
    // Tempo lock is always preserve-pitch (never resample / rate-pitch).
    return "preserve-pitch";
  }

  const loopish = (sample.loopScore ?? 0) > 0.45;
  if (Math.abs(pitchSemitones) >= 1) {
    if (lengthFactor > 1.15 && loopish)
      return rnd() < 0.6 ? "copy" : "preserve-pitch";
    if (Math.abs(lengthFactor - 1) > 0.12) return "preserve-pitch";
    return "off";
  }
  if (isDrumRole(role)) {
    if (
      !noResample &&
      rnd() < 0.08 + energy * 0.1 &&
      lengthFactor < 0.85
    ) {
      return "resample";
    }
    return "off";
  }
  if (loopish && lengthFactor > 1.2) {
    return rnd() < 0.55 ? "copy" : "preserve-pitch";
  }
  if (Math.abs(lengthFactor - 1) > 0.18) {
    if (role === "texture" || role === "loop") {
      return rnd() < 0.7 ? "preserve-pitch" : "copy";
    }
    if (noResample) return "preserve-pitch";
    return rnd() < 0.35 + energy * 0.15 ? "resample" : "preserve-pitch";
  }
  if (!noResample && rnd() < 0.08 + energy * 0.06) {
    return "resample";
  }
  return "off";
}

function pickLengthTick(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  startTick: number;
  nextTick: number | null;
  barTick: number;
  ticksPerBar: number;
  bpm: number;
  ppq: number;
  section: SongSection;
  bpmLengthFactor: number;
  stutter: boolean;
  energy: number;
  rnd: () => number;
}): number {
  const {
    sample,
    role,
    startTick,
    nextTick,
    barTick,
    ticksPerBar,
    bpm,
    ppq,
    bpmLengthFactor,
    stutter,
    energy,
    rnd,
  } = opts;
  const natural = Math.max(
    Math.floor(ppq / 4),
    Math.round(msToLengthTick(sample.durationMs, bpm, ppq) * bpmLengthFactor),
  );
  const minLen = Math.floor(ppq / 4);

  if (stutter) {
    const slice = Math.max(minLen, Math.floor(ppq / (rnd() < 0.5 ? 4 : 2)));
    return nextTick != null
      ? Math.min(slice, Math.max(minLen, nextTick - startTick - 1))
      : slice;
  }

  let lengthTick: number;
  if (isDrumRole(role) || role === "fx") {
    lengthTick = Math.min(natural, Math.max(minLen, Math.floor(ppq * 0.9)));
    if (role === "hat") lengthTick = Math.min(lengthTick, Math.floor(ppq / 2));
    // Energy: shorter attacks when hot
    if (energy > 0.65 && rnd() < 0.35) {
      lengthTick = Math.min(lengthTick, Math.floor(ppq * (0.35 + rnd() * 0.4)));
    }
    if (nextTick != null) {
      lengthTick = Math.min(
        lengthTick,
        Math.max(minLen, nextTick - startTick - 1),
      );
    }
  } else if (role === "bass") {
    const hold = nextTick != null ? nextTick - startTick : ticksPerBar;
    lengthTick = Math.max(
      minLen,
      Math.min(natural * (0.8 + rnd() * 0.5), hold),
    );
  } else if (role === "chord") {
    // Hold = caller window (ticksPerBar already = realTpb × harmony-safe stride).
    lengthTick = ticksPerBar;
    if (nextTick != null) {
      lengthTick = Math.min(
        lengthTick,
        Math.max(minLen, nextTick - startTick),
      );
    }
  } else if (role === "arp") {
    // Gate to the next cell step — sample length must not drive the note.
    // Longer takes are truncated (`stretchMode: off`) + track ADSR.
    const gap = Math.floor(ppq / 32);
    const untilNext =
      nextTick != null
        ? Math.max(minLen, nextTick - startTick - gap)
        : Math.max(minLen, Math.floor(ppq / 2));
    lengthTick = untilNext;
  } else if (role === "lead") {
    lengthTick = Math.max(
      minLen,
      Math.round(natural * (0.35 + rnd() * (0.8 + energy * 0.5))),
    );
    if (nextTick != null) {
      lengthTick = Math.min(
        lengthTick,
        Math.max(minLen, nextTick - startTick - Math.floor(ppq / 16)),
      );
    }
  } else if (role === "loop") {
    lengthTick = Math.max(ticksPerBar, Math.round(natural));
    lengthTick = Math.round(lengthTick / ticksPerBar) * ticksPerBar;
  } else {
    lengthTick = Math.max(
      ticksPerBar,
      Math.round(natural * (0.9 + rnd() * (1.2 + energy))),
    );
    lengthTick = Math.round(lengthTick / ppq) * ppq;
  }

  if (
    (role === "texture" || role === "loop" || role === "chord") &&
    lengthTick >= ticksPerBar
  ) {
    const end = startTick + lengthTick;
    const barEnd =
      barTick + ticksPerBar * Math.ceil((end - barTick) / ticksPerBar);
    if (barEnd - startTick > lengthTick * 0.7) lengthTick = barEnd - startTick;
  }

  return Math.max(minLen, lengthTick);
}

/**
 * Attack / decay / curve from role + accent + energy (maps to fadeIn/fadeOut).
 */
function pickFades(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  lengthMs: number;
  stretchMode: StretchMode;
  accent: boolean;
  energy: number;
  stutter: boolean;
  rnd: () => number;
}): { fadeInMs: number; fadeOutMs: number; fadeCurve: FadeCurve } {
  const { sample, role, lengthMs, stretchMode, accent, energy, stutter, rnd } =
    opts;
  const maxFade = Math.max(4, lengthMs * 0.45);
  let inLo = 2;
  let inHi = 12;
  let outLo = 8;
  let outHi = 40;

  if (isDrumRole(role)) {
    // Attack: snappy on accents; softer ghosts
    inLo = accent ? 0 : 1;
    inHi = accent ? 3 : 8;
    outLo = accent ? 6 : 12;
    outHi = accent ? 22 : 45;
  } else if (role === "bass" || role === "chord" || role === "lead") {
    inLo = accent ? 4 : 10;
    inHi = accent ? 28 : 55;
    outLo = 18;
    outHi = 40 + energy * 80;
  } else if (role === "arp") {
    // Snappy gate — track ADSR does the body; clip fades stay short.
    inLo = accent ? 0 : 1;
    inHi = accent ? 4 : 10;
    outLo = 8;
    outHi = 22 + energy * 18;
  } else if (role === "texture" || role === "loop" || sample.class === "noise") {
    inLo = 30 + (1 - energy) * 40;
    inHi = 80 + (1 - energy) * 100;
    outLo = 50;
    outHi = 120 + (1 - energy) * 140;
  } else {
    // fx
    inLo = 5;
    inHi = 40;
    outLo = 30;
    outHi = 160;
  }

  if (stutter) {
    inLo = 0;
    inHi = 2;
    outLo = 2;
    outHi = 12;
  }

  if (stretchMode === "preserve-pitch" || stretchMode === "copy") {
    inHi *= 1.25;
    outHi *= 1.35;
  }

  // Soft attack when low energy
  if (energy < 0.4 && !isDrumRole(role)) {
    inLo *= 1.4;
    inHi *= 1.5;
  }

  const fadeInMs = Math.round(clamp(inLo + rnd() * (inHi - inLo), 0, maxFade));
  const fadeOutMs = Math.round(
    clamp(outLo + rnd() * (outHi - outLo), 0, maxFade),
  );

  let fadeCurve: FadeCurve;
  if (isDrumRole(role) && accent) fadeCurve = "exponential";
  else if (role === "texture" || role === "loop")
    fadeCurve = rnd() < 0.5 ? "equal-power" : "s-curve";
  else
    fadeCurve =
      FADE_CURVES[Math.floor(rnd() * FADE_CURVES.length)] ?? "equal-power";

  return { fadeInMs, fadeOutMs, fadeCurve };
}

/** Beat duration in ms for tempo-synced FX. */
function beatMs(bpm: number): number {
  return 60_000 / Math.max(1, bpm);
}

/**
 * Reverb decay tuned so impulse length ≈ N beats.
 * Engine: durationSec = 0.6 + decay * 2.4 (track-insert).
 */

/** Style-driven FX envelope — damping, wetness, modulation lean. */
type StyleFxBias = {
  /** Center for echo/reverb HF damping (0 bright … 1 dark). */
  dampCenter: number;
  dampSpread: number;
  /** How often wet inserts win over dry/EQ. */
  wetness: number;
  /** Prefer echo over reverb when choosing space. */
  echoBias: number;
  /** Prefer chorus / tremolo / vibrato. */
  modBias: number;
  /** Longer delay/feedback (dub, ambient beds). */
  longEcho: boolean;
  /** Longer reverb beat fractions. */
  longReverb: boolean;
};

function styleFxBias(style: MusicStyleId): StyleFxBias {
  switch (style) {
    case "dub":
      return {
        dampCenter: 0.55,
        dampSpread: 0.25,
        wetness: 0.9,
        echoBias: 0.85,
        modBias: 0.15,
        longEcho: true,
        longReverb: true,
      };
    case "reggae":
      return {
        dampCenter: 0.45,
        dampSpread: 0.25,
        wetness: 0.7,
        echoBias: 0.65,
        modBias: 0.2,
        longEcho: true,
        longReverb: false,
      };
    case "ambient":
    case "triphop":
      return {
        dampCenter: 0.6,
        dampSpread: 0.25,
        wetness: 0.85,
        echoBias: 0.35,
        modBias: 0.45,
        longEcho: true,
        longReverb: true,
      };
    case "classical":
    case "folk":
    case "jazz":
    case "blues":
      return {
        dampCenter: 0.4,
        dampSpread: 0.2,
        wetness: 0.55,
        echoBias: 0.2,
        modBias: 0.45,
        longEcho: false,
        longReverb: true,
      };
    case "disco":
    case "funk":
    case "house":
    case "pop":
      return {
        dampCenter: 0.3,
        dampSpread: 0.2,
        wetness: 0.55,
        echoBias: 0.35,
        modBias: 0.55,
        longEcho: false,
        longReverb: false,
      };
    case "techno":
    case "dnb":
    case "breakbeat":
    case "garage":
      return {
        dampCenter: 0.35,
        dampSpread: 0.25,
        wetness: 0.5,
        echoBias: 0.55,
        modBias: 0.4,
        longEcho: false,
        longReverb: false,
      };
    case "metal":
    case "punk":
    case "rock":
      return {
        dampCenter: 0.25,
        dampSpread: 0.2,
        wetness: 0.3,
        echoBias: 0.25,
        modBias: 0.2,
        longEcho: false,
        longReverb: false,
      };
    case "hiphop":
    case "latin":
    case "afrobeat":
      return {
        dampCenter: 0.4,
        dampSpread: 0.25,
        wetness: 0.5,
        echoBias: 0.45,
        modBias: 0.3,
        longEcho: false,
        longReverb: false,
      };
    default:
      return {
        dampCenter: 0.35,
        dampSpread: 0.25,
        wetness: 0.5,
        echoBias: 0.4,
        modBias: 0.35,
        longEcho: false,
        longReverb: false,
      };
  }
}

/** Log-uniform Hz pick (musical for cutoffs). */
function rndHz(rnd: () => number, lo: number, hi: number): number {
  const a = Math.max(1, lo);
  const b = Math.max(a, hi);
  return Math.exp(Math.log(a) + rnd() * (Math.log(b) - Math.log(a)));
}

/**
 * Role + style + sample HP/LP seating (independent of wet insert).
 * Dark / wet styles lean LP; bright / energetic styles lean open air + HP carve.
 */
function pickRoleTone(
  role: ExprRole,
  bias: StyleFxBias,
  energy: number,
  sample: SequenceSampleIn | undefined,
  rnd: () => number,
): Pick<TrackFx, "hpHz" | "lpHz"> {
  const dark = bias.dampCenter;
  const brightPush = clamp(1 - dark + energy * 0.25, 0.15, 1.15);
  const muffPush = clamp(dark * 0.85 + (1 - energy) * 0.35, 0.1, 1.1);
  let hp = TRACK_HP_HZ_OPEN;
  let lp = TRACK_LP_HZ_OPEN;

  const maybeHp = (p: number, lo: number, hi: number) => {
    if (rnd() < clamp(p, 0, 0.92)) {
      hp = clamp(rndHz(rnd, lo, hi), TRACK_HP_HZ_OPEN, TRACK_HP_HZ_MAX);
    }
  };
  const maybeLp = (p: number, lo: number, hi: number) => {
    if (rnd() < clamp(p, 0, 0.92)) {
      lp = clamp(rndHz(rnd, lo, hi), TRACK_LP_HZ_MIN, TRACK_LP_HZ_OPEN);
    }
  };

  switch (role) {
    case "kick":
      maybeHp(0.12 + dark * 0.08, 28, 55);
      maybeLp(0.28 + muffPush * 0.25, 3_500, 9_000);
      break;
    case "bass":
      maybeHp(0.22 + brightPush * 0.1, 40, 95);
      maybeLp(0.4 + muffPush * 0.3, 1_800, 5_500);
      break;
    case "snare":
      maybeHp(0.28 + brightPush * 0.12, 80, 220);
      maybeLp(0.18 + muffPush * 0.28, 5_000, 12_000);
      break;
    case "hat":
      maybeHp(0.55 + brightPush * 0.15, 500, 1_900);
      maybeLp(0.12 + muffPush * 0.2, 9_000, 16_000);
      break;
    case "perc":
      maybeHp(0.32 + brightPush * 0.12, 120, 520);
      maybeLp(0.22 + muffPush * 0.25, 4_000, 12_000);
      break;
    case "chord":
      maybeHp(0.48 + brightPush * 0.1, 60, 190);
      maybeLp(0.28 + muffPush * 0.35, 5_000, 14_000);
      break;
    case "lead":
    case "arp":
      maybeHp(0.3 + brightPush * 0.12, 100, 380);
      maybeLp(0.18 + muffPush * 0.28, 6_000, 16_000);
      break;
    case "loop":
      maybeHp(0.38 + brightPush * 0.1, 70, 210);
      maybeLp(0.32 + muffPush * 0.3, 4_500, 12_000);
      break;
    case "texture":
      maybeHp(0.55 + dark * 0.12, 80, 380);
      maybeLp(0.48 + muffPush * 0.35, 3_000, 10_000);
      break;
    case "fx":
    default:
      maybeHp(0.42 + brightPush * 0.15, 140, 900);
      maybeLp(0.38 + muffPush * 0.3, 2_500, 12_000);
      break;
  }

  // Sample centroid vs role seat → engage / nudge cutoffs.
  const hz = sample ? sampleCentroidHz(sample) : null;
  if (hz != null) {
    const ideal = roleSpectralTarget(role).idealHz;
    const oct = Math.log2(hz / Math.max(20, ideal));
    if (oct > 0.85) {
      // Too bright for the seat → darker LP
      const target = clamp(
        ideal * (2.8 + rnd() * 2.2),
        TRACK_LP_HZ_MIN,
        TRACK_LP_HZ_OPEN,
      );
      lp =
        lp < TRACK_LP_HZ_OPEN - 0.5
          ? Math.min(lp, target)
          : target;
    } else if (oct < -0.85) {
      // Too dark / muddy → raise HP
      const target = clamp(
        Math.min(TRACK_HP_HZ_MAX, ideal * (0.35 + rnd() * 0.35)),
        TRACK_HP_HZ_OPEN,
        TRACK_HP_HZ_MAX,
      );
      hp =
        hp > TRACK_HP_HZ_OPEN + 0.5
          ? Math.max(hp, target)
          : target;
    }
  }

  return { hpHz: hp, lpHz: lp };
}

/**
 * One-shot / pad ADSR by role. Style darkness lengthens A/R; energy shortens.
 */
function pickRoleEnvelope(
  role: ExprRole,
  bias: StyleFxBias,
  energy: number,
  rnd: () => number,
): Pick<TrackFx, "attackMs" | "decayMs" | "sustain" | "releaseMs"> {
  const linger = clamp(bias.dampCenter * 0.5 + bias.wetness * 0.35, 0, 1);
  const snap = clamp(energy * 0.55 + (1 - bias.wetness) * 0.25, 0, 1);
  const scaleMs = (lo: number, hi: number) =>
    lo + rnd() * (hi - lo) * (0.65 + linger * 0.7);

  const envelope = (
    attackMs: number,
    decayMs: number,
    sustain: number,
    releaseMs: number,
  ): Pick<TrackFx, "attackMs" | "decayMs" | "sustain" | "releaseMs"> => ({
    attackMs: clamp(attackMs, 0, TRACK_ATTACK_MS_MAX),
    decayMs: clamp(decayMs, 0, TRACK_DECAY_MS_MAX),
    sustain: clamp(sustain, 0, 1),
    releaseMs: clamp(releaseMs, 0, TRACK_RELEASE_MS_MAX),
  });

  let p = 0.35;
  switch (role) {
    case "kick":
      p = 0.55;
      break;
    case "snare":
      p = 0.5;
      break;
    case "hat":
      p = 0.4;
      break;
    case "perc":
      p = 0.45;
      break;
    case "bass":
      p = 0.35;
      break;
    case "chord":
      p = 0.42 + linger * 0.15;
      break;
    case "lead":
      p = 0.35 + bias.modBias * 0.15;
      break;
    case "arp":
      // Always on — gates long samples into plucked notes.
      p = 1;
      break;
    case "loop":
      p = 0.4 + linger * 0.1;
      break;
    case "texture":
      p = 0.62 + linger * 0.2;
      break;
    case "fx":
      p = 0.5;
      break;
  }
  if (rnd() >= clamp(p, 0.08, 0.9) && role !== "arp") {
    return { ...DEFAULT_TRACK_ADSR };
  }

  switch (role) {
    case "kick":
      return envelope(
        scaleMs(0, 8) * (1 - snap * 0.4),
        scaleMs(30, 110),
        0.35 + rnd() * 0.35,
        scaleMs(35, 130),
      );
    case "snare":
      return envelope(
        scaleMs(0, 12) * (1 - snap * 0.35),
        scaleMs(40, 130),
        0.4 + rnd() * 0.35,
        scaleMs(45, 170),
      );
    case "hat":
      return envelope(
        scaleMs(0, 5),
        scaleMs(18, 65),
        0.22 + rnd() * 0.35,
        scaleMs(20, 85),
      );
    case "perc":
      return envelope(
        scaleMs(0, 10),
        scaleMs(25, 100),
        0.3 + rnd() * 0.4,
        scaleMs(30, 140),
      );
    case "bass":
      return envelope(
        scaleMs(0, 22),
        scaleMs(40, 160),
        0.7 + rnd() * 0.28,
        scaleMs(55, 220),
      );
    case "chord":
      return envelope(
        scaleMs(12, 95),
        scaleMs(50, 220),
        0.75 + rnd() * 0.24,
        scaleMs(90, 420),
      );
    case "arp":
      // Pluck gate: short A/D, low sustain, release fits note tails.
      return envelope(
        scaleMs(1, 10) * (1 - snap * 0.55),
        scaleMs(18, 75),
        0.18 + rnd() * 0.28,
        scaleMs(28, 110),
      );
    case "lead":
      return envelope(
        scaleMs(4, 55),
        scaleMs(35, 160),
        0.58 + rnd() * 0.38,
        scaleMs(70, 320),
      );
    case "loop":
      return envelope(
        scaleMs(8, 85),
        scaleMs(40, 190),
        0.8 + rnd() * 0.2,
        scaleMs(70, 360),
      );
    case "texture":
      return envelope(
        scaleMs(25, 220),
        scaleMs(70, 320),
        0.85 + rnd() * 0.15,
        scaleMs(140, 720),
      );
    case "fx":
    default:
      return envelope(
        scaleMs(8, 160),
        scaleMs(45, 260),
        0.5 + rnd() * 0.4,
        scaleMs(90, 520),
      );
  }
}

/** Layer independent HP/LP + ADSR on top of a wet/EQ insert. */
function withRoleFilters(
  fx: TrackFx,
  role: ExprRole,
  style: MusicStyleId,
  energy: number,
  sample: SequenceSampleIn | undefined,
  rnd: () => number,
): TrackFx {
  const bias = styleFxBias(style);
  const tone = pickRoleTone(role, bias, energy, sample, rnd);
  const env = pickRoleEnvelope(role, bias, energy, rnd);
  return normalizeTrackFx({
    ...normalizeTrackFx(fx),
    ...tone,
    ...env,
  });
}

/**
 * Plan a full multi-track sequence over `bars`, drawing from the library.
 * Facade: UI opts → ComposeSettings → compose() → realizeComposerScore().
 */
export function planSequence(opts: {
  bars: number;
  beatsPerBar: number;
  ppq: number;
  bpm: number;
  seed: number;
  tracks: Array<{ id: string; index: number }>;
  samples: SequenceSampleIn[];
  musicStyle?: GenMusicStyleChoice;
  keyRootPc?: number | GenAuto;
  density?: number | GenAuto;
  energy?: number | GenAuto;
  drumsVsTexture?: number | GenAuto;
  groove?: GenGrooveChoice;
  scaleMode?: GenScaleMode;
  palette?: GenPaletteChoice;
  formStyle?: GenFormStyle;
  energyShape?: GenEnergyShape;
  humanize?: number | GenAuto;
  variation?: number | GenAuto;
  life?: number | GenAuto;
  space?: number | GenAuto;
  sampleVariety?: number | GenAuto;
  bpmSync?: GenTriState;
  reverse?: GenTriState;
  stutter?: GenTriState;
  callResponse?: GenTriState;
  ensembleRelation?: GenEnsembleRelation;
  lockPitch?: GenTriState;
  pitchUpSemitones?: number | GenAuto;
  pitchDownSemitones?: number | GenAuto;
  lockTempoPow2?: GenTriState;
  forbidPitchStretch?: GenTriState;
  stretchUpRatio?: number | GenAuto;
  stretchDownRatio?: number | GenAuto;
  tuningRef?: TuningRefMode;
  /** Precomputed onset→grid genes (async extract outside). */
  sampleGenes?: RhythmGene[];
  grooveFromSamples?: GrooveFromSamples;
  locks?: ComposeLock[];
  regenSalt?: string;
}): SequencePlanResult {
  return planSequenceComposer(opts);
}

function mapFormFamily(formStyle: GenFormStyle): FormFamily | "auto" {
  if (formStyle === "auto") return "auto";
  if (formStyle === "song") return "verse-chorus";
  if (formStyle === "ambient") return "loop-evolve";
  return formStyle;
}

function mapMode(scaleMode: GenScaleMode): ModeId | "auto" {
  if (scaleMode === "major") return "ionian";
  if (scaleMode === "minor") return "aeolian";
  return "auto";
}

function grooveToSwing(groove: GrooveKind): number {
  if (groove === "shuffle") return 0.58;
  if (groove === "half-time") return 0.2;
  return 0.05;
}

/** Map composer section kinds onto classic-song home-sample buckets. */
function mapComposerSectionKind(kind: string): SectionKind {
  if (kind === "build") return "prechorus";
  if (kind === "drop") return "chorus";
  if (kind === "break") return "bridge";
  if (
    kind === "intro" ||
    kind === "verse" ||
    kind === "prechorus" ||
    kind === "chorus" ||
    kind === "bridge" ||
    kind === "outro"
  ) {
    return kind;
  }
  return "verse";
}

/**
 * Realize a composer Score with the legacy sample / stretch / fade stack
 * (home sample per section kind, spectral seat, exact float pitch).
 */
function realizeComposerScore(
  score: Score,
  opts: {
    tracks: Array<{ id: string; index: number }>;
    samples: SequenceSampleIn[];
    ppq: number;
    bpm: number;
    beatsPerBar: number;
    lockPitch: boolean;
    pitchUpSemitones: number;
    pitchDownSemitones: number;
    tuningOffsetCents: number;
    sampleVariety: number;
    energy: number;
    variation: number;
    musicStyle: MusicStyleId;
  },
): SequencePlanResult {
  const {
    tracks,
    samples,
    ppq,
    bpm,
    beatsPerBar,
    lockPitch,
    pitchUpSemitones: maxUp,
    pitchDownSemitones: maxDown,
    tuningOffsetCents,
    sampleVariety,
    energy,
    variation,
    musicStyle,
  } = opts;
  const rnd = mulberry32(score.dna.seed ^ 0x5eed5a17);
  const srcPpq = CORE_PPQ;
  const tickScale = ppq / srcPpq;
  const toProjectTick = (t: number) => Math.max(0, Math.round(t * tickScale));
  const tpbSrc = srcPpq * 4;

  const tracksByIndex = [...tracks].sort((a, b) => a.index - b.index);
  const trackIdFor = (trackIndex: number): string => {
    const byIndex = tracks.find((t) => t.index === trackIndex);
    if (byIndex) return byIndex.id;
    return tracksByIndex[trackIndex % tracksByIndex.length]?.id ?? tracks[0]!.id;
  };

  const spectralOccupied: SpectralOccupancy[] = [];
  const homeByRoleKind = new Map<string, Map<SectionKind, SequenceSampleIn>>();
  const warnings = [...score.warnings];

  const mixByIndex = new Map(score.mix.tracks.map((t) => [t.trackIndex, t]));
  const trackPlans: SequenceTrackPlan[] = [];
  const seenTrack = new Set<string>();

  for (const part of score.parts) {
    const id = trackIdFor(part.trackIndex);
    if (seenTrack.has(id)) continue;
    seenTrack.add(id);
    const mix = mixByIndex.get(part.trackIndex);
    const pool = rankSamplesForRole(samples, part.role, rnd, sampleVariety);
    const homeKind = mapComposerSectionKind(
      score.sections[0]?.kind ?? "verse",
    );
    const homeMap =
      homeByRoleKind.get(part.role) ?? new Map<SectionKind, SequenceSampleIn>();
    homeByRoleKind.set(part.role, homeMap);
    let home: SequenceSampleIn | undefined;
    if (pool.length > 0) {
      home = pickHomeSampleForKind(
        homeKind,
        part.role,
        pool,
        homeMap,
        spectralOccupied,
        rnd,
        sampleVariety,
      );
      registerSpectralOccupancy(spectralOccupied, part.role, home);
    }
    let fx = (mix?.insert as TrackFx) ?? { ...DEFAULT_TRACK_FX };
    fx = withSpectralTrackEq(fx, part.role, home, rnd);
    fx = withRoleFilters(fx, part.role, musicStyle, energy, home, rnd);
    trackPlans.push({
      trackId: id,
      gainDb: mix?.levelDb ?? 0,
      pan: mix?.pan ?? 0,
      fx: normalizeTrackFx(fx),
      sendA: mix?.sendA ?? 0,
      sendB: mix?.sendB ?? 0,
    });
  }
  for (const tr of tracks) {
    if (seenTrack.has(tr.id)) continue;
    trackPlans.push({
      trackId: tr.id,
      gainDb: 0,
      pan: 0,
      fx: normalizeTrackFx({ ...DEFAULT_TRACK_FX }),
    });
  }

  const sectionAt = (tick: number) => {
    const bar = Math.floor(tick / tpbSrc);
    for (const s of score.sections) {
      if (bar >= s.startBar && bar < s.startBar + s.bars) return s;
    }
    return score.sections[score.sections.length - 1];
  };

  const clips: SequenceClipPlan[] = [];
  for (const part of score.parts) {
    const pool = rankSamplesForRole(samples, part.role, rnd, sampleVariety);
    if (pool.length === 0) continue;
    const homeMap =
      homeByRoleKind.get(part.role) ?? new Map<SectionKind, SequenceSampleIn>();
    homeByRoleKind.set(part.role, homeMap);
    const trackId = trackIdFor(part.trackIndex);
    const mix = mixByIndex.get(part.trackIndex);
    const events = [...part.events].sort((a, b) => a.tick - b.tick);

    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei]!;
      const sec = sectionAt(ev.tick);
      const kind = mapComposerSectionKind(sec?.kind ?? "verse");
      const homeWasNew = !homeMap.has(kind);
      const sample = pickHomeSampleForKind(
        kind,
        part.role,
        pool,
        homeMap,
        spectralOccupied,
        rnd,
        sampleVariety,
      );
      if (homeWasNew) {
        registerSpectralOccupancy(spectralOccupied, part.role, sample);
      }

      let pitchSemitones = 0;
      let stretchPitch = 0;
      if (!lockPitch && ev.midi != null) {
        const source = sampleSourceMidi(sample);
        if (source != null) {
          pitchSemitones = exactPitchSemitones(
            ev.midi,
            source,
            0,
            tuningOffsetCents,
          );
          if (pitchSemitones > maxUp || pitchSemitones < -maxDown) {
            let folded = pitchSemitones;
            while (folded > maxUp) folded -= 12;
            while (folded < -maxDown) folded += 12;
            if (folded > maxUp || folded < -maxDown) {
              warnings.push(
                `render: drop note ${part.role}@${ev.tick} (pitch window)`,
              );
              continue;
            }
            pitchSemitones = folded;
          }
        }
      }

      const nextTick = events[ei + 1]?.tick ?? null;
      const startTick = toProjectTick(ev.tick);
      const barTick = toProjectTick(
        Math.floor(ev.tick / tpbSrc) * tpbSrc,
      );
      const durScaled = Math.max(
        Math.floor(ppq / 8),
        toProjectTick(ev.durTick),
      );
      // Length from partition duration, refined by role helpers.
      const lengthTick = pickLengthTick({
        sample,
        role: part.role,
        startTick,
        nextTick: nextTick != null ? toProjectTick(nextTick) : null,
        barTick,
        ticksPerBar: ppq * beatsPerBar,
        bpm,
        ppq,
        section: {
          kind,
          startBar: sec?.startBar ?? 0,
          bars: sec?.bars ?? 4,
          densityMul: 1,
          gainBiasDb: 0,
          evolve: 0,
          fillLastBar: ev.tag === "fill",
          altSample: false,
        },
        bpmLengthFactor: 1,
        stutter: false,
        energy: sec?.energy ?? energy,
        rnd,
      });
      // Prefer partition duration when it is tighter than the role heuristic.
      const useLen = Math.min(durScaled, lengthTick);
      const natural = Math.max(
        Math.floor(ppq / 4),
        Math.round(msToLengthTick(sample.durationMs, bpm, ppq)),
      );
      const lengthFactor = useLen / Math.max(1, natural);
      const stretchMode = pickStretchMode({
        sample,
        role: part.role,
        lengthFactor,
        pitchSemitones,
        bpmSync: null,
        energy: sec?.energy ?? energy,
        stutter: false,
        lockPitch,
        allowResamplePitch: !lockPitch && Math.abs(pitchSemitones) < 0.01,
        rnd,
      });
      if (stretchMode === "resample") {
        stretchPitch = resampleStretchPitchSemis(lengthFactor);
        if (!lockPitch && ev.midi != null) {
          const source = sampleSourceMidi(sample);
          if (source != null) {
            pitchSemitones = exactPitchSemitones(
              ev.midi,
              source,
              stretchPitch,
              tuningOffsetCents,
            );
          }
        }
      }

      const lengthMs = (useLen / ppq) * (60_000 / Math.max(1, bpm));
      const fades = pickFades({
        sample,
        role: part.role,
        lengthMs,
        stretchMode,
        accent: ev.accent,
        energy: sec?.energy ?? energy,
        stutter: false,
        rnd,
      });
      const loop = pickLoopContent({
        sample,
        role: part.role,
        lengthMs,
        bpm,
        beatsPerBar,
        loopEnabled:
          part.role === "loop" ||
          part.role === "texture" ||
          (sample.loopScore ?? 0) > 0.55,
        stretchMode,
        energy: sec?.energy ?? energy,
        variation,
        rnd,
      });

      const gainDb = Math.min(
        6,
        Math.max(
          -24,
          (ev.accent ? 0.5 : 0) +
            20 * Math.log10(Math.max(0.05, ev.vel)),
        ),
      );

      clips.push({
        trackId,
        sampleId: sample.id,
        startTick,
        lengthTick: Math.max(Math.floor(ppq / 8), useLen),
        contentOffsetMs: loop.contentOffsetMs,
        gainDb,
        loopEnabled: loop.loopEnabled,
        loopLengthMs: loop.loopLengthMs,
        fadeInMs: fades.fadeInMs,
        fadeOutMs: fades.fadeOutMs,
        fadeCurve: fades.fadeCurve,
        pitchSemitones,
        stretchMode,
        reverse: ev.tag === "riser",
      });
    }
  }

  const primary = score.parts.find((p) => p.role === "lead");
  const ensembleSummary: SequenceEnsembleSummary | undefined = primary
    ? {
        relationMode: "auto",
        relations: score.parts.map((p) => p.relation ?? "independent"),
        primaryLeadTrack: primary.trackIndex,
      }
    : undefined;

  return {
    clips,
    tracks: trackPlans,
    ensemble: ensembleSummary,
    automation: score.automation.map((lane) => ({
      ...lane,
      points: lane.points.map((p) => ({
        ...p,
        tick: toProjectTick(p.tick),
      })),
    })),
    sends: score.mix.tracks.map((t) => ({
      trackId: trackIdFor(t.trackIndex),
      a: t.sendA,
      b: t.sendB,
    })),
    spaces: score.mix.spaces as SpacePlan,
    master: score.mix.master as MasterPlan,
    score,
    warnings,
  };
}

/** UI → compose + render (hierarchical composer). */
export function planSequenceComposer(opts: {
  bars: number;
  beatsPerBar: number;
  ppq: number;
  bpm: number;
  seed: number;
  tracks: Array<{ id: string; index: number }>;
  samples: SequenceSampleIn[];
  musicStyle?: GenMusicStyleChoice;
  keyRootPc?: number | GenAuto;
  density?: number | GenAuto;
  energy?: number | GenAuto;
  drumsVsTexture?: number | GenAuto;
  groove?: GenGrooveChoice;
  scaleMode?: GenScaleMode;
  formStyle?: GenFormStyle;
  energyShape?: GenEnergyShape;
  humanize?: number | GenAuto;
  variation?: number | GenAuto;
  life?: number | GenAuto;
  space?: number | GenAuto;
  sampleVariety?: number | GenAuto;
  ensembleRelation?: GenEnsembleRelation;
  lockPitch?: GenTriState;
  pitchUpSemitones?: number | GenAuto;
  pitchDownSemitones?: number | GenAuto;
  tuningRef?: TuningRefMode;
  sampleGenes?: RhythmGene[];
  grooveFromSamples?: GrooveFromSamples;
  locks?: ComposeLock[];
  regenSalt?: string;
}): SequencePlanResult {
  const { bars, ppq, bpm, seed, tracks, samples } = opts;
  if (bars < 1 || tracks.length === 0 || samples.length === 0) {
    return { clips: [], tracks: [] };
  }

  const rnd = mulberry32(seed);
  const sampleVariety = resolveStyleBiasedSlider(
    opts.sampleVariety,
    rnd,
    0,
    1,
    0.45,
    0.45,
  );
  const enriched = withClapCohesion(
    samples,
    sampleVariety > 0.2 ? rnd : undefined,
  );
  const yamnetPool = enriched.flatMap((s) => s.yamnet ?? []);
  const musicStyle = pickMusicStyle(opts.musicStyle, rnd, yamnetPool);
  const styleProfile = MUSIC_STYLE_PROFILES[musicStyle];
  const genProfile = STYLE_GENERATOR_PROFILES[musicStyle];

  const density = resolveStyleBiasedSlider(
    opts.density,
    rnd,
    0.35,
    1.5,
    1,
    genProfile.densityCenter,
  );
  const energy = resolveStyleBiasedSlider(
    opts.energy,
    rnd,
    0,
    1,
    0.55,
    genProfile.energyCenter,
  );
  const drumsVsTexture = resolveStyleBiasedSlider(
    opts.drumsVsTexture,
    rnd,
    0,
    1,
    0.55,
    genProfile.drumsCenter,
  );
  const groove: GrooveKind =
    opts.groove === "auto"
      ? pickGroove(rnd, genProfile.grooveFeel)
      : (opts.groove ?? styleProfile.groove);
  const humanize =
    opts.humanize === undefined
      ? genProfile.humanizeCenter
      : resolveStyleBiasedSlider(
          opts.humanize,
          rnd,
          0,
          1,
          genProfile.humanizeCenter,
          genProfile.humanizeCenter,
        );
  const variation = resolveStyleBiasedSlider(
    opts.variation,
    rnd,
    0,
    1,
    0.32,
    0.32,
  );
  const spaceCenter = clamp(
    genProfile.spaceCenter * 0.65 + (1 - drumsVsTexture) * 0.35,
    0,
    1,
  );
  const life = resolveStyleBiasedSlider(
    opts.life,
    rnd,
    0,
    1,
    genProfile.lifeCenter,
    genProfile.lifeCenter,
  );
  const space = resolveStyleBiasedSlider(
    opts.space,
    rnd,
    0,
    1,
    spaceCenter,
    spaceCenter,
  );
  const scaleMode: GenScaleMode =
    opts.scaleMode && opts.scaleMode !== "auto"
      ? opts.scaleMode
      : styleProfile.scaleBias && rnd() < 0.75
        ? styleProfile.scaleBias
        : (opts.scaleMode ?? "auto");
  const formStyle: GenFormStyle = opts.formStyle ?? "auto";
  const energyShape: GenEnergyShape = opts.energyShape ?? "auto";
  const lockPitch = opts.lockPitch === "on";
  const resolvePitchBound = (v: number | GenAuto | undefined): number => {
    if (v === "auto" || v == null || !Number.isFinite(v)) return 12;
    return Math.round(clamp(v, 0, 24));
  };
  const pitchUpSemitones = lockPitch ? 0 : resolvePitchBound(opts.pitchUpSemitones);
  const pitchDownSemitones = lockPitch
    ? 0
    : resolvePitchBound(opts.pitchDownSemitones);

  const keyPc: number | "auto" =
    opts.keyRootPc === "auto" || opts.keyRootPc == null
      ? "auto"
      : clamp(Math.round(opts.keyRootPc), 0, 11);

  const tuningRef = opts.tuningRef ?? "auto";
  const tuningOffsetCents = resolveTuningOffsetCents(tuningRef, enriched);

  let trackRoles = assignTrackRoles(
    tracks.length,
    enriched,
    rnd,
    drumsVsTexture,
  );
  // Always keep ≥1 bed layer when ≥4 tracks so intro/outro are not empty shells.
  const hasBed = trackRoles.some(
    (r) =>
      r === "texture" || r === "loop" || r === "fx" || r === "chord",
  );
  if (!hasBed && trackRoles.length >= 4) {
    trackRoles = [...trackRoles];
    const swapAt = Math.max(1, trackRoles.length - 1);
    trackRoles[swapAt] = "texture";
  }

  const settings: ComposeSettings = {
    seed,
    style: musicStyle,
    targetBars: bars,
    formFamily: mapFormFamily(formStyle),
    energyShape,
    energy,
    density,
    drumsVsTexture,
    variation,
    life,
    space,
    swing:
      opts.groove === "auto" || opts.groove == null
        ? genProfile.swing
        : grooveToSwing(groove),
    humanize,
    keyPc,
    mode: mapMode(scaleMode),
    tuningRef,
    targetLufs: -14,
    lockPitch,
    trackRoles,
    sampleGenes: opts.sampleGenes,
    grooveFromSamples: opts.grooveFromSamples ?? "auto",
    locks: opts.locks,
    regenSalt: opts.regenSalt,
  };

  const { score } = compose(settings);
  score.dna.bpm = bpm;
  score.dna.meter = [opts.beatsPerBar, 4];
  score.dna.tuningOffsetCents = tuningOffsetCents;
  score.dna.groove = {
    swing: settings.swing,
    feel: groove === "shuffle" ? "shuffle" : groove === "half-time" ? "half-time" : "straight",
    humanizeMs: humanize * 20,
  };

  const result = realizeComposerScore(score, {
    tracks,
    samples: enriched,
    ppq,
    bpm,
    beatsPerBar: opts.beatsPerBar,
    lockPitch,
    pitchUpSemitones,
    pitchDownSemitones,
    tuningOffsetCents,
    sampleVariety,
    energy,
    variation,
    musicStyle,
  });

  if (result.ensemble) {
    result.ensemble = {
      ...result.ensemble,
      relationMode: opts.ensembleRelation ?? "auto",
    };
  }
  const mixWarnings = mixcheckPlan(result);
  if (mixWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...mixWarnings];
  }
  return result;
}

