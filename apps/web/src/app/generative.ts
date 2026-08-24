/** Deterministic generative helpers — song-form motifs + expressive roles. */

import {
  DEFAULT_TRACK_ADSR,
  ExprRoleSchema,
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
import {
  buildSectionHarmonyTimeline,
  pickArpCell,
  pickMelodyCell,
  type ArpEvent,
  type ChordTone,
  type HarmonicPalette,
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
export { MUSIC_STYLE_IDS, MUSIC_STYLE_PROFILES } from "./generative-styles";
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

export type ProbPlacement = { tick: number; gainDb: number };

/** Legacy beat-grid placer (kept for callers / experiments). */
export function probabilisticPlacement(opts: {
  bars: number;
  beatsPerBar?: number;
  ppq: number;
  density: number;
  seed: number;
  humanizeMs: number;
  bpm: number;
}): ProbPlacement[] {
  const rnd = mulberry32(opts.seed);
  const beatsPerBar = Math.max(1, opts.beatsPerBar ?? 4);
  const ticksPerBar = opts.ppq * beatsPerBar;
  const out: ProbPlacement[] = [];
  for (let bar = 0; bar < opts.bars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const strong = beat === 0;
      const p = opts.density * (strong ? 1.2 : 0.7);
      if (rnd() < p) {
        const humanTicks =
          ((rnd() * 2 - 1) * opts.humanizeMs * opts.bpm * opts.ppq) / 60_000;
        out.push({
          tick: Math.round(bar * ticksPerBar + beat * opts.ppq + humanTicks),
          gainDb: (rnd() * 2 - 1) * 1.5,
        });
      }
    }
  }
  return out;
}

/** Explicit lock vs seed-driven pick. */
export type GenAuto = "auto";
export type GenTriState = GenAuto | "on" | "off";
export type GenScaleMode = GenAuto | "major" | "minor";
export type GenFormStyle = GenAuto | "song" | "ambient";
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
};

export type SequencePlanResult = {
  clips: SequenceClipPlan[];
  tracks: SequenceTrackPlan[];
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
 */
function sectionDensityBoost(base: number, energy: number): number {
  const e = clamp(energy, 0, 1);
  if (base < 0.55) {
    // Quiet sections: mild lift only
    return clamp(base * (0.85 + e * 0.25), 0.12, 0.7);
  }
  if (base > 1) {
    // Peaks: push further with energy
    return clamp(base * (0.9 + e * 0.35), 0.9, 1.55);
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
    if (avoidIds.has(s.id) && pool.length > 1) sc += 2.8;
    if (variety > 0) sc += (rnd() - 0.5) * variety * 4;
    return { item: s, score: sc };
  });
  const best = pickScored(scored, rnd, variety);
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
 * Soft gate: should this role place hits on this bar of the section?
 * Creates audible silence / strip-downs (intro entrance, bridge drop, outro fade).
 */
function sectionAllowsRole(
  role: ExprRole,
  section: SongSection,
  barInSection: number,
  energy: number,
  rnd: () => number,
): boolean {
  const { kind, bars } = section;
  const progress =
    bars <= 1 ? 0.5 : clamp(barInSection / Math.max(1, bars - 1), 0, 1);
  const e = clamp(energy, 0, 1);

  switch (kind) {
    case "intro": {
      // Progressive entrance — space first, kit & lead later
      if (role === "fx") return rnd() < 0.2 + e * 0.15;
      if (role === "snare") return progress > 0.55 && rnd() < 0.25 + e * 0.2;
      if (role === "hat") return progress > 0.35 && rnd() < 0.3 + e * 0.25;
      if (role === "kick" || role === "perc")
        return progress > 0.15 || rnd() < 0.35 + e * 0.2;
      if (role === "lead") return progress > 0.6 && rnd() < 0.28 + e * 0.22;
      if (role === "arp") return progress > 0.35 && rnd() < 0.4 + e * 0.25;
      if (role === "chord") return rnd() < 0.4 + e * 0.15;
      if (role === "bass") return progress > 0.1 || rnd() < 0.55;
      // texture / loop: often present but thinned by density + stride
      return rnd() < 0.7 + e * 0.15;
    }
    case "verse": {
      if (role === "lead") return rnd() < 0.45 + e * 0.3;
      if (role === "arp") return rnd() < 0.55 + e * 0.25;
      if (role === "fx") return rnd() < 0.3 + e * 0.2;
      if (role === "hat") return rnd() < 0.75 + e * 0.15;
      return true;
    }
    case "prechorus": {
      // Build: almost full, lead still restrained
      if (role === "lead") return rnd() < 0.55 + e * 0.3;
      if (role === "arp") return rnd() < 0.7 + e * 0.2;
      if (role === "fx") return rnd() < 0.4 + e * 0.25;
      return true;
    }
    case "chorus":
      return true;
    case "bridge": {
      // Breakdown / drop: strip kit & bass, keep beds + colour
      if (role === "kick" || role === "snare")
        return rnd() < 0.12 + e * 0.12;
      if (role === "hat") return rnd() < 0.18 + e * 0.15;
      if (role === "perc") return rnd() < 0.3 + e * 0.2;
      if (role === "bass") return rnd() < 0.35 + e * 0.2;
      if (role === "chord") return rnd() < 0.55 + e * 0.2;
      return true;
    }
    case "outro": {
      // Progressive exit — more silence toward the end
      const keep = 1 - progress * 0.9;
      if (isDrumRole(role)) return rnd() < keep * (0.35 + e * 0.2);
      if (role === "lead") return rnd() < keep * 0.35;
      if (role === "arp") return rnd() < keep * 0.4;
      if (role === "bass" || role === "chord")
        return rnd() < keep * 0.55 + 0.1;
      if (role === "fx") return rnd() < keep * 0.4;
      return rnd() < keep + 0.2;
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

function lengthTickToMs(ticks: number, bpm: number, ppq: number): number {
  return (ticks / ppq) * (60 / bpm) * 1000;
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
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

/** True when we can safely retune from a recorded fundamental. */
function sampleHasFundamental(s: SequenceSampleIn): boolean {
  return sampleSourceMidi(s) != null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pickInt(rnd: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

function resolveSlider(
  value: number | GenAuto | undefined,
  rnd: () => number,
  lo: number,
  hi: number,
  fallback: number,
): number {
  if (value === "auto") return lo + rnd() * (hi - lo);
  if (value == null || !Number.isFinite(value)) return fallback;
  return clamp(value, lo, hi);
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

/** Infer tonic pitch-class from analysed samples; default C. */
export function inferKeyRootPc(samples: SequenceSampleIn[]): number {
  const counts = new Array<number>(12).fill(0);
  for (const s of samples) {
    const midi = sampleSourceMidi(s);
    if (midi == null) continue;
    const w =
      (s.favorite ? 2 : 1) *
      (s.class === "tonal" || s.class === "voice" ? 2 : 1) *
      (1 + (s.harmonicity ?? 0));
    counts[((Math.round(midi) % 12) + 12) % 12]! += w;
  }
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < 12; i++) {
    const w = counts[i] ?? 0;
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  return best;
}

function pickScale(
  samples: SequenceSampleIn[],
  rootPc: number,
  rnd: () => number,
  mode: GenScaleMode = "auto",
): readonly number[] {
  if (mode === "major") return MAJOR_SCALE;
  if (mode === "minor") return MINOR_SCALE;
  let majorish = 0;
  let minorish = 0;
  for (const s of samples) {
    const midi = sampleSourceMidi(s);
    if (midi == null) continue;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    const rel = (pc - rootPc + 12) % 12;
    if (rel === 4) majorish += 1;
    if (rel === 3) minorish += 1;
  }
  if (majorish === minorish) return rnd() < 0.55 ? MAJOR_SCALE : MINOR_SCALE;
  return majorish > minorish ? MAJOR_SCALE : MINOR_SCALE;
}

function paletteFromMix(
  drumsVsTexture: number,
  rnd: () => number,
  forced?: GenPaletteChoice,
  stylePalette?: HarmonicPalette,
): HarmonicPalette {
  if (forced && forced !== "auto") return forced;
  if (stylePalette && rnd() < 0.78) return stylePalette;
  if (drumsVsTexture < 0.35) return rnd() < 0.7 ? "ambient" : "modal";
  if (drumsVsTexture > 0.7) return rnd() < 0.55 ? "pop" : "mixed";
  if (rnd() < 0.25) return "jazz";
  if (rnd() < 0.45) return "modal";
  return "mixed";
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
    units =
      bars <= 8
        ? [
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
          ]
        : [
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
  } else {
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

/** Apply shuffle / half-time feel to a tick within a bar. */
function applyGroove(
  tickInBar: number,
  groove: GrooveKind,
  beatsPerBar: number,
  ppq: number,
): number {
  const tpb = beatsPerBar * ppq;
  let t = ((tickInBar % tpb) + tpb) % tpb;
  if (groove === "straight") return t;

  if (groove === "half-time") {
    // Compress activity toward beats 1 and 3 (or 1 only in 3/4)
    const beat = t / ppq;
    if (beatsPerBar >= 4) {
      if (beat >= 1 && beat < 2) t = Math.round((beat - 1) * 0.35 * ppq);
      else if (beat >= 3 && beat < 4)
        t = Math.round(2 * ppq + (beat - 3) * 0.35 * ppq);
    }
    return ((t % tpb) + tpb) % tpb;
  }

  // shuffle: delay off-beats toward swing (≈66% of the way to next beat)
  const beatFloor = Math.floor(t / ppq);
  const within = t - beatFloor * ppq;
  const eighth = ppq / 2;
  if (within > eighth * 0.85 && within < eighth * 1.15) {
    // on the off-eighth → push later
    t = beatFloor * ppq + Math.round(eighth * (2 / 3) + eighth);
  } else if (within > 0 && within < eighth) {
    // keep on-beat
  } else if (within >= eighth) {
    const sub = within - eighth;
    t = beatFloor * ppq + eighth + Math.round(sub * 0.55 + eighth * 0.15);
  }
  return ((t % tpb) + tpb) % tpb;
}

function buildMotif(
  role: ExprRole,
  beatsPerBar: number,
  ppq: number,
  rnd: () => number,
  groove: GrooveKind,
  musicStyle: MusicStyleId,
): MotifHit[] {
  return buildStyleMotif(musicStyle, role, beatsPerBar, ppq, rnd, groove);
}

/** Call–response: shift hits by half-bar relative to partner motif. */
function callResponseShift(
  hits: MotifHit[],
  ppq: number,
  beatsPerBar: number,
  respond: boolean,
): MotifHit[] {
  if (!respond) return hits;
  const shift = Math.floor((beatsPerBar * ppq) / 2);
  const tpb = beatsPerBar * ppq;
  return hits.map((h) => ({
    ...h,
    tickInBar: (h.tickInBar + shift) % tpb,
    gainDb: h.gainDb - 0.5,
  }));
}

function melodyCellToHits(
  cell: readonly MelodyEvent[],
  ppq: number,
  beatsPerBar: number,
  groove: GrooveKind,
): MotifHit[] {
  const tpb = beatsPerBar * ppq;
  const ticksPer16 = ppq / 4;
  let t = 0;
  const hits: MotifHit[] = [];
  for (const ev of cell) {
    if (t >= tpb) break;
    hits.push({
      tickInBar: applyGroove(Math.round(t), groove, beatsPerBar, ppq),
      gainDb: ev.accent ? 0.5 : -1,
      accent: !!ev.accent,
      melodyDegree: ev.degree,
    });
    t += ev.sixteenths * ticksPer16;
  }
  return hits.length > 0
    ? hits
    : [{ tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 }];
}

/** Arp cell → hits; skips rests (`degree: null`). Degrees are chord-relative. */
function arpCellToHits(
  cell: readonly ArpEvent[],
  ppq: number,
  beatsPerBar: number,
  groove: GrooveKind,
): MotifHit[] {
  const tpb = beatsPerBar * ppq;
  const ticksPer16 = ppq / 4;
  let t = 0;
  const hits: MotifHit[] = [];
  for (const ev of cell) {
    if (t >= tpb) break;
    if (ev.degree != null) {
      hits.push({
        tickInBar: applyGroove(Math.round(t), groove, beatsPerBar, ppq),
        gainDb: ev.accent ? 0.5 : -0.5,
        accent: !!ev.accent,
        melodyDegree: ev.degree,
      });
    }
    t += ev.sixteenths * ticksPer16;
  }
  return hits.length > 0
    ? hits
    : [{ tickInBar: 0, gainDb: 0, accent: true, melodyDegree: 0 }];
}

function evolveMotifHits(
  motif: MotifHit[],
  opts: {
    role: ExprRole;
    section: SongSection;
    barInSection: number;
    beatsPerBar: number;
    ppq: number;
    density: number;
    energy: number;
    rnd: () => number;
    /** When true, empty kit motifs stay empty (classical / ambient). */
    allowEmptyKit?: boolean;
  },
): MotifHit[] {
  const {
    role,
    section,
    barInSection,
    beatsPerBar,
    ppq,
    density,
    energy,
    rnd,
    allowEmptyKit,
  } = opts;
  const tpb = beatsPerBar * ppq;
  const last = barInSection === section.bars - 1;
  let hits = motif.map((h) => ({ ...h }));
  const dens = section.densityMul * density;

  if (allowEmptyKit && motif.length === 0 && isDrumRole(role)) {
    return [];
  }

  hits = hits.filter((h) => {
    // Accents stay reliable only in denser sections — quiet sections can drop them
    if (h.accent) {
      if (dens >= 0.7) return true;
      if (dens >= 0.45) return rnd() < dens + 0.35;
      return rnd() < dens + 0.15;
    }
    return rnd() < dens;
  });

  if (section.kind === "intro") {
    if (role === "hat")
      hits = hits.filter((h) => h.tickInBar % ppq === 0 || rnd() < 0.18);
    if (role === "snare") hits = hits.filter((h) => h.accent && rnd() < 0.4);
    if (role === "kick")
      hits = hits.filter((h) => h.accent || rnd() < 0.25 + energy * 0.15);
    if (role === "lead" || role === "chord") {
      hits = hits.filter((h) => h.accent || rnd() < 0.22);
    }
    if (role === "perc" || role === "fx") {
      hits = hits.filter(() => rnd() < 0.35);
    }
  }

  if (section.kind === "verse") {
    if (role === "hat" && dens < 0.85) {
      hits = hits.filter((h) => h.accent || h.tickInBar % ppq === 0 || rnd() < 0.45);
    }
    if (role === "lead") {
      hits = hits.filter((h) => h.accent || rnd() < 0.4 + energy * 0.2);
    }
  }

  if (section.kind === "prechorus") {
    hits = hits.map((h) => ({
      ...h,
      gainDb: h.gainDb + 0.55 * (barInSection + 1) * energy,
    }));
    // Rising hats / perc toward chorus
    if ((role === "hat" || role === "perc") && rnd() < 0.35 + energy * 0.3) {
      const step = Math.floor(ppq / 2);
      for (let t = 0; t < tpb; t += Math.max(1, step)) {
        if (!hits.some((h) => Math.abs(h.tickInBar - t) < 2)) {
          hits.push({ tickInBar: t, gainDb: -3.5, accent: false });
        }
      }
    }
  }

  if (section.kind === "chorus") {
    if (role === "hat" && rnd() < 0.5 + energy * 0.35) {
      const step = Math.floor(ppq / 4);
      for (let t = 0; t < tpb; t += step) {
        if (!hits.some((h) => Math.abs(h.tickInBar - t) < 2)) {
          hits.push({ tickInBar: t, gainDb: -3.5, accent: false });
        }
      }
    }
    if (role === "kick" && section.evolve > 0.3 && rnd() < 0.4 + energy * 0.25) {
      hits.push({
        tickInBar: Math.floor(3.5 * ppq) % tpb,
        gainDb: -1,
        accent: false,
      });
    }
    if (role === "perc" && rnd() < 0.3 + energy * 0.2) {
      hits.push({
        tickInBar: Math.floor(1.75 * ppq) % tpb,
        gainDb: -2,
        accent: false,
      });
    }
  }

  if (section.kind === "bridge") {
    // Hard strip kit — leave accents rarely
    if (role === "kick" || role === "snare" || role === "hat") {
      hits = hits.filter((h) => h.accent && rnd() < 0.25 + energy * 0.15);
    }
    if (role === "bass") {
      hits = hits.filter((h) => h.accent || rnd() < 0.3);
    }
    if (role === "lead" || role === "chord") {
      hits = hits.filter((h) => h.accent || rnd() < 0.45);
      if (rnd() < 0.35) {
        hits.push({
          tickInBar: Math.floor(1.5 * ppq) % tpb,
          gainDb: -1.5,
          accent: false,
        });
      }
    }
    if (role === "texture" || role === "loop") {
      hits = hits.filter((h) => h.accent || rnd() < 0.55);
    }
  }

  if (section.kind === "outro") {
    const keep = 1 - (barInSection / Math.max(1, section.bars)) * 0.85;
    hits = hits.filter((h) => h.accent || rnd() < keep * 0.7);
    if (isDrumRole(role)) {
      hits = hits.filter((h) => h.accent && rnd() < keep);
    }
  }

  if (last && section.fillLastBar && isDrumRole(role) && energy > 0.35) {
    // Fills only into active sections — not into quiet outros/bridges
    if (
      section.kind === "chorus" ||
      section.kind === "prechorus" ||
      section.kind === "verse"
    ) {
      const fillStep =
        role === "hat" ? Math.floor(ppq / 4) : Math.floor(ppq / 2);
      const from = Math.floor(tpb * 0.5);
      for (let t = from; t < tpb; t += Math.max(1, fillStep)) {
        if (rnd() < 0.45 + section.evolve * 0.3 + energy * 0.15) {
          hits.push({ tickInBar: t, gainDb: -1.5 + rnd(), accent: false });
        }
      }
    }
  }

  if (section.evolve > 0.2 && rnd() < section.evolve * density) {
    if (rnd() < 0.55 && hits.length > 1) {
      const i = pickInt(rnd, 0, hits.length - 1);
      if (!hits[i]!.accent) hits.splice(i, 1);
    } else if (
      isDrumRole(role) &&
      (section.kind === "chorus" || section.kind === "prechorus")
    ) {
      hits.push({
        tickInBar: Math.floor(rnd() * tpb),
        gainDb: -3,
        accent: false,
      });
    }
  }

  // Foundation roles: only force a hit in active sections — silence is intentional elsewhere
  if (
    hits.length === 0 &&
    (role === "kick" || role === "bass" || role === "loop" || role === "texture")
  ) {
    const forceFoundation =
      (section.kind === "verse" ||
        section.kind === "chorus" ||
        section.kind === "prechorus") &&
      dens >= 0.4;
    if (forceFoundation) {
      hits.push({ tickInBar: 0, gainDb: section.gainBiasDb, accent: true });
    }
  }

  hits.sort((a, b) => a.tickInBar - b.tickInBar);
  const deduped: MotifHit[] = [];
  for (const h of hits) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.tickInBar - h.tickInBar) < Math.floor(ppq / 16)) {
      if (h.accent || h.gainDb > prev.gainDb) deduped[deduped.length - 1] = h;
      continue;
    }
    deduped.push(h);
  }
  return deduped;
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

function chordToneSemis(
  scale: readonly number[],
  rootDegree: number,
  tone: ChordTone,
): number {
  const deg = (rootDegree + tone) % scale.length;
  const oct = Math.floor((rootDegree + tone) / scale.length);
  return (scale[deg] ?? 0) + oct * 12;
}

/** True when sounding pitch-class (source + transpose) is in allowed rels. */
function isScaleCompatibleTranspose(
  fromMidi: number,
  semis: number,
  rootPc: number,
  allowedRels: readonly number[],
): boolean {
  const pc = (((Math.round(fromMidi) + semis) % 12) + 12) % 12;
  const rel = (pc - rootPc + 12) % 12;
  return allowedRels.includes(rel);
}

/**
 * True when perceived pitch (transpose + continuous stretch offset) lands on
 * an allowed degree. Fractional stretch is rounded for PC membership — callers
 * should avoid large stretch offsets on melodic parts (see pickStretchMode).
 */
function isScaleCompatibleSounding(
  fromMidi: number,
  semis: number,
  stretchSemis: number,
  rootPc: number,
  allowedRels: readonly number[],
): boolean {
  const sounding = Math.round(fromMidi) + semis + stretchSemis;
  const pc = (((Math.round(sounding) % 12) + 12) % 12);
  const rel = (pc - rootPc + 12) % 12;
  return allowedRels.includes(rel);
}

/**
 * Transposes in [-maxDown, maxUp] that land on an allowed degree (vs tonic).
 * `allowedRels` defaults to the full scale; pass chord-tone rels for tighter
 * harmonic lock. If the window is empty, expands to ±24 — never falls back
 * to bare `[0]` when unison is off-key (that produced false notes).
 */
export function scaleCompatibleTransposes(
  fromMidi: number,
  rootPc: number,
  scale: readonly number[],
  maxUp: number,
  maxDown: number,
  stretchSemis = 0,
  allowedRels?: readonly number[],
): number[] {
  const rels = allowedRels && allowedRels.length > 0 ? allowedRels : scale;
  const up = Math.max(0, maxUp);
  const down = Math.max(0, maxDown);
  const collect = (hi: number, lo: number): number[] => {
    const out: number[] = [];
    for (let semis = -lo; semis <= hi; semis++) {
      if (
        stretchSemis === 0
          ? isScaleCompatibleTranspose(fromMidi, semis, rootPc, rels)
          : isScaleCompatibleSounding(
              fromMidi,
              semis,
              stretchSemis,
              rootPc,
              rels,
            )
      ) {
        out.push(semis);
      }
    }
    return out;
  };
  const inWindow = collect(up, down);
  if (inWindow.length > 0) return inWindow;
  const expanded = collect(24, 24);
  if (expanded.length > 0) return expanded;
  // Pathological (empty scale): keep unison rather than throw.
  return [0];
}

/**
 * Pitch-classes (semitones above tonic) allowed for this hit.
 * Bass/chord stay on the chord; lead accents too; weak lead beats may pass.
 */
function harmonicAllowedRels(
  role: ExprRole,
  scale: readonly number[],
  chordDegree: number,
  chordTones: readonly ChordTone[],
  accent: boolean,
): readonly number[] {
  const toneRels = (tones: readonly ChordTone[]): number[] => {
    const out: number[] = [];
    for (const tone of tones) {
      const semis = chordToneSemis(scale, chordDegree, tone);
      const rel = ((semis % 12) + 12) % 12;
      if (!out.includes(rel)) out.push(rel);
    }
    return out.length > 0 ? out : [...scale];
  };

  if (role === "bass") {
    // Root on accents; root + fifth on weak beats (no random scale wander).
    return accent
      ? toneRels([0])
      : toneRels([0, 4]);
  }
  if (role === "chord") {
    return toneRels(chordTones.length > 0 ? chordTones : [0, 2, 4]);
  }
  if (role === "arp") {
    // Strict chord tones (incl. octave / 7th via cell degree → snap window).
    return toneRels(chordTones.length > 0 ? chordTones : [0, 2, 4]);
  }
  if (role === "lead") {
    if (accent) {
      return toneRels(chordTones.length > 0 ? chordTones : [0, 2, 4]);
    }
    return scale;
  }
  return scale;
}

/** Roles / samples that must stay on the song scale. */
function shouldEnforceScale(
  role: ExprRole,
  sample: SequenceSampleIn,
): boolean {
  if (isMelodicRole(role)) return true;
  if (role === "chord") return true;
  if (role === "texture" || role === "loop") {
    return (
      isMelodicClass(sample.class, sample.harmonicity) ||
      sampleSourceMidi(sample) != null
    );
  }
  // Pitched drums / fx still read as notes when analysis found a fundamental.
  if (
    (isDrumRole(role) || role === "fx") &&
    sampleSourceMidi(sample) != null &&
    isMelodicClass(sample.class, sample.harmonicity)
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
function nearestAllowedTranspose(
  preferred: number,
  allowed: readonly number[],
): number {
  if (allowed.length === 0) return 0;
  let best = allowed[0]!;
  let bestDist = Infinity;
  let bestAbs = Infinity;
  for (const semis of allowed) {
    const dist = Math.abs(semis - preferred);
    const abs = Math.abs(semis);
    if (dist < bestDist || (dist === bestDist && abs < bestAbs)) {
      bestDist = dist;
      bestAbs = abs;
      best = semis;
    }
  }
  return best;
}

function pickPitchSemitones(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  rootPc: number;
  scale: readonly number[];
  degreeHint: number;
  chordTones?: readonly ChordTone[];
  toneIndex?: number;
  melodyDegree?: number;
  accent?: boolean;
  section: SongSection;
  energy: number;
  rnd: () => number;
  /** Max transpose upward (semitones). */
  maxUp: number;
  /** Max transpose downward (semitones, positive). */
  maxDown: number;
}): number {
  const {
    sample,
    role,
    rootPc,
    scale,
    degreeHint,
    chordTones,
    toneIndex,
    melodyDegree,
    accent,
    section,
    energy,
    rnd,
    maxUp,
    maxDown,
  } = opts;
  const up = Math.max(0, maxUp);
  const down = Math.max(0, maxDown);
  const clampPitch = (semis: number) => clamp(semis, -down, up);
  const source = sampleSourceMidi(sample);
  // Melodic roles must retune from the recorded fundamental — never assume MIDI 60.
  if (
    source == null &&
    (role === "arp" ||
      role === "lead" ||
      role === "bass" ||
      role === "chord")
  ) {
    return 0;
  }
  const enforce = shouldEnforceScale(role, sample);
  const tones = chordTones ?? ([0, 2, 4] as const);
  const allowedRels = enforce
    ? harmonicAllowedRels(
        role,
        scale,
        degreeHint,
        tones,
        accent ?? true,
      )
    : scale;

  if (up <= 0 && down <= 0) {
    // No retune budget: if we must stay on-scale, still snap via expanded search.
    if (!enforce || source == null) return 0;
    const allowed = scaleCompatibleTransposes(
      source,
      rootPc,
      scale,
      0,
      0,
      0,
      allowedRels,
    );
    return nearestAllowedTranspose(0, allowed);
  }

  if (isDrumRole(role) || role === "fx") {
    if (rnd() > 0.2 + energy * 0.15) {
      if (!enforce || source == null) return 0;
      return nearestAllowedTranspose(
        0,
        scaleCompatibleTransposes(
          source,
          rootPc,
          scale,
          up,
          down,
          0,
          allowedRels,
        ),
      );
    }
    const lim =
      section.kind === "bridge" || section.kind === "chorus" ? 7 : 4;
    const hi = Math.min(up, lim);
    const lo = Math.min(down, lim);
    if (hi <= 0 && lo <= 0) return 0;
    const raw = clampPitch(pickInt(rnd, -lo, hi));
    if (!enforce || source == null) return raw;
    return nearestAllowedTranspose(
      raw,
      scaleCompatibleTransposes(
        source,
        rootPc,
        scale,
        up,
        down,
        0,
        allowedRels,
      ),
    );
  }

  if (role === "texture" || role === "loop") {
    if (!isMelodicClass(sample.class, sample.harmonicity)) {
      if (rnd() >= 0.25 + energy * 0.2) {
        if (!enforce || source == null) return 0;
        return nearestAllowedTranspose(
          0,
          scaleCompatibleTransposes(
            source,
            rootPc,
            scale,
            up,
            down,
            0,
            allowedRels,
          ),
        );
      }
      const hi = Math.min(7, up);
      const lo = Math.min(7, down);
      const raw =
        hi > 0 || lo > 0 ? clampPitch(pickInt(rnd, -lo, hi)) : 0;
      if (!enforce || source == null) return raw;
      return nearestAllowedTranspose(
        raw,
        scaleCompatibleTransposes(
          source,
          rootPc,
          scale,
          up,
          down,
          0,
          allowedRels,
        ),
      );
    }
  }

  let degree = scale[degreeHint % scale.length] ?? 0;
  if (role === "chord" && tones.length > 0) {
    const tone = tones[(toneIndex ?? 0) % tones.length]!;
    degree = chordToneSemis(scale, degreeHint, tone);
  } else if (
    (role === "lead" || role === "arp") &&
    melodyDegree != null
  ) {
    // Cell degrees are chord-relative: transpose onto current chord root.
    const md = melodyDegree + degreeHint;
    const oct = Math.floor(md / scale.length);
    degree =
      (scale[((md % scale.length) + scale.length) % scale.length] ?? 0) +
      oct * 12;
  } else if (role === "bass") {
    // Prefer chord root; weak beats may target the fifth via allowedRels snap.
    const tone: ChordTone = accent === false && rnd() < 0.35 ? 4 : 0;
    degree = chordToneSemis(scale, degreeHint, tone);
  }

  let octave = 0;
  if (role === "bass") octave = pickInt(rnd, -1, 0);
  else if (role === "lead" || role === "arp") {
    octave = pickInt(rnd, 0, 1);
    if (
      role === "lead" &&
      section.kind === "chorus" &&
      rnd() < 0.35 * energy
    ) {
      octave += 1;
    }
  } else if (role === "chord") octave = toneIndex && toneIndex > 1 ? 1 : 0;

  // Prefer an octave that keeps the transpose inside the allowed window,
  // always snapping to a harmony-compatible interval (never a hard min/max).
  const baseOctave =
    source != null
      ? Math.floor(Math.round(source) / 12) - 1
      : role === "bass"
        ? 2
        : 4;
  const fromMidi = source != null ? source : 60;
  const allowed = scaleCompatibleTransposes(
    fromMidi,
    rootPc,
    scale,
    up,
    down,
    0,
    allowedRels,
  );
  const octCandidates = [octave, 0, -1, 1, -2, 2].filter(
    (o, i, a) => a.indexOf(o) === i,
  );
  let bestSemis = nearestAllowedTranspose(0, allowed);
  let bestDist = Infinity;
  for (const oct of octCandidates) {
    const targetMidi = (baseOctave + oct + 1) * 12 + rootPc + degree;
    const raw = Math.round(targetMidi - fromMidi);
    const semis = nearestAllowedTranspose(raw, allowed);
    const dist = Math.abs(raw - semis) + Math.abs(oct - octave) * 0.01;
    if (dist < bestDist) {
      bestDist = dist;
      bestSemis = semis;
    }
  }
  let semis = bestSemis;

  // Melodic ornament only for lead on weak beats — never wander bass/chord off harmony.
  if (
    role === "lead" &&
    accent === false &&
    semis === 0 &&
    section.evolve > 0.3 &&
    rnd() < section.evolve * energy
  ) {
    const step = scale[pickInt(rnd, 1, scale.length - 1)] ?? 2;
    const evolved = rnd() < 0.5 ? step : -step;
    semis = nearestAllowedTranspose(evolved, allowed);
  }
  return semis;
}

/** Sounding pitch-class occupancy for cross-track dominant-note clash avoidance. */
type PitchOccupancy = {
  startTick: number;
  endTick: number;
  pc: number;
};

/**
 * Dominant note for clash checks: analysed fundamental when present,
 * else spectral centroid (works for pitched and unpitched samples).
 */
function sampleDominantMidi(s: SequenceSampleIn): number | null {
  const pitched = sampleSourceMidi(s);
  if (pitched != null) return pitched;
  if (s.centroidHz != null && s.centroidHz > 20 && s.centroidHz < 8000) {
    return hzToMidi(s.centroidHz);
  }
  return null;
}

function pitchClassOf(midi: number, semis: number): number {
  return (((Math.round(midi) + Math.round(semis)) % 12) + 12) % 12;
}

/** Pitch-class distance folded into 0…6. */
function pcInterval(a: number, b: number): number {
  const d = Math.abs((((a - b) % 12) + 12) % 12);
  return Math.min(d, 12 - d);
}

/**
 * Dominants conflict when they form a minor 2nd / major 7th (interval 1).
 * Unison / octave and other intervals are allowed.
 */
function fundamentalsConflict(a: number, b: number): boolean {
  return pcInterval(a, b) === 1;
}

function overlappingPitchClasses(
  occupied: readonly PitchOccupancy[],
  startTick: number,
  endTick: number,
): number[] {
  const pcs: number[] = [];
  for (const o of occupied) {
    if (o.startTick < endTick && o.endTick > startTick) pcs.push(o.pc);
  }
  return pcs;
}

/**
 * Retune within the scale window so the sounding dominant does not clash
 * with other clips that overlap in time (pitched or not). Prefers the
 * original target; falls back to unison with an occupant, then nearest allowed.
 * Always stays on-scale when `enforceScale` (never returns an off-key preferred).
 */
function avoidFundamentalClash(opts: {
  sample: SequenceSampleIn;
  preferredSemis: number;
  /** Extra pitch from stretch mode `resample` (semitones). */
  stretchSemis: number;
  startTick: number;
  endTick: number;
  occupied: readonly PitchOccupancy[];
  rootPc: number;
  scale: readonly number[];
  maxUp: number;
  maxDown: number;
  enforceScale: boolean;
  /** Tighter than scale (chord tones). */
  allowedRels?: readonly number[];
}): number {
  const {
    sample,
    preferredSemis,
    stretchSemis,
    startTick,
    endTick,
    occupied,
    rootPc,
    scale,
    maxUp,
    maxDown,
    enforceScale,
    allowedRels,
  } = opts;
  const fromMidi = sampleDominantMidi(sample);
  if (fromMidi == null) return preferredSemis;

  const allowed = scaleCompatibleTransposes(
    fromMidi,
    rootPc,
    scale,
    maxUp,
    maxDown,
    stretchSemis,
    allowedRels,
  );
  const onScalePreferred = enforceScale
    ? nearestAllowedTranspose(preferredSemis, allowed)
    : preferredSemis;

  const others = overlappingPitchClasses(occupied, startTick, endTick);
  if (others.length === 0) return onScalePreferred;

  const sounding = (semis: number) =>
    pitchClassOf(fromMidi, semis + stretchSemis);
  const preferredPc = sounding(onScalePreferred);
  if (!others.some((pc) => fundamentalsConflict(preferredPc, pc))) {
    return onScalePreferred;
  }

  const free = allowed.filter(
    (semis) => !others.some((pc) => fundamentalsConflict(sounding(semis), pc)),
  );
  if (free.length > 0) return nearestAllowedTranspose(onScalePreferred, free);

  // No clash-free degree: land on an already-sounding dominant (unison).
  const unison = allowed.filter((semis) => others.includes(sounding(semis)));
  if (unison.length > 0) {
    return nearestAllowedTranspose(onScalePreferred, unison);
  }

  return onScalePreferred;
}

/**
 * After stretch is final: drop rate-pitch if it breaks the scale, then snap
 * transpose so perceived pitch stays on an allowed degree.
 */
function finalizeScalePitch(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  pitchSemitones: number;
  stretchMode: StretchMode;
  fitFactor: number;
  rootPc: number;
  scale: readonly number[];
  maxUp: number;
  maxDown: number;
  allowedRels?: readonly number[];
}): { pitchSemitones: number; stretchMode: StretchMode; stretchPitch: number } {
  const { sample, role, rootPc, scale, maxUp, maxDown, allowedRels } = opts;
  let { pitchSemitones, stretchMode } = opts;
  // Melodic / chord: only the recorded fundamental (never spectral centroid guess).
  const fromMidi =
    isMelodicRole(role) || role === "chord"
      ? sampleSourceMidi(sample)
      : (sampleSourceMidi(sample) ?? sampleDominantMidi(sample));
  const enforce = shouldEnforceScale(role, sample);

  if (!enforce || fromMidi == null) {
    const stretchPitch =
      stretchMode === "resample"
        ? resampleStretchPitchSemis(opts.fitFactor)
        : 0;
    return { pitchSemitones, stretchMode, stretchPitch };
  }

  let stretchPitch =
    stretchMode === "resample"
      ? resampleStretchPitchSemis(opts.fitFactor)
      : 0;

  // Continuous rate-pitch > ~35¢ reads as out-of-tune even if PC rounds OK.
  if (stretchMode === "resample" && Math.abs(stretchPitch) >= 0.35) {
    stretchMode = "preserve-pitch";
    stretchPitch = 0;
  }

  const allowed = scaleCompatibleTransposes(
    fromMidi,
    rootPc,
    scale,
    maxUp,
    maxDown,
    stretchPitch,
    allowedRels,
  );
  pitchSemitones = nearestAllowedTranspose(pitchSemitones, allowed);
  return { pitchSemitones, stretchMode, stretchPitch };
}

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

/** Keep total perceived pitch (transpose + resample) inside maxUp / maxDown. */
function constrainStretchToPitchBounds(
  stretchMode: StretchMode,
  pitchSemitones: number,
  /** clip length / natural sample length (ticks), not bpm-adjusted. */
  fitFactor: number,
  maxUp: number,
  maxDown: number,
  opts: {
    forbidPitchStretch: boolean;
    loopish: boolean;
  },
): StretchMode {
  if (stretchMode !== "resample") return stretchMode;
  const fromStretch = resampleStretchPitchSemis(fitFactor);
  if (Math.abs(fromStretch) < 0.35) return stretchMode;
  const total = pitchSemitones + fromStretch;
  const up = Math.max(0, maxUp);
  const down = Math.max(0, maxDown);
  if (total <= up + 0.05 && total >= -down - 0.05) return stretchMode;
  // Resample would break the pitch window — fall back without rate-pitching.
  if (!opts.forbidPitchStretch) return "preserve-pitch";
  if (opts.loopish || fitFactor > 1.08) return "copy";
  return "off";
}

/**
 * Cap time-stretch vs sample duration (`fitFactor` = clip / natural).
 * Beyond max enlarge → copy (tile) or off; beyond max shorten → native
 * (truncated). `maxEnlarge` = Infinity / `maxShorten` = 0 means no cap.
 */
function constrainStretchToDurationRatio(
  stretchMode: StretchMode,
  fitFactor: number,
  maxEnlarge: number,
  maxShorten: number,
  loopish: boolean,
): StretchMode {
  if (stretchMode === "off" || stretchMode === "copy") return stretchMode;
  if (!(fitFactor > 0) || !Number.isFinite(fitFactor)) return stretchMode;
  if (Number.isFinite(maxEnlarge) && fitFactor > maxEnlarge * 1.05) {
    return loopish || fitFactor > 1.08 ? "copy" : "off";
  }
  if (maxShorten > 0 && fitFactor < maxShorten / 1.05) return "off";
  return stretchMode;
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

/**
 * Drop `preserve-pitch` (UI label "pitch") when forbidden.
 * With pitch lock → `copy` (keep height); else → `resample` (tempo via rate).
 */
function withoutPreservePitchStretch(
  mode: StretchMode,
  lockPitch: boolean,
): StretchMode {
  if (mode !== "preserve-pitch") return mode;
  return lockPitch ? "copy" : "resample";
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
    section,
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
    const barsHold = section.kind === "chorus" ? 2 : 1;
    lengthTick = Math.max(ticksPerBar, barsHold * ticksPerBar);
    if (nextTick != null) lengthTick = Math.min(lengthTick, nextTick - startTick);
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

function pickBeatFrac(rnd: () => number, beatFracs: readonly number[]): number {
  return beatFracs[Math.floor(rnd() * beatFracs.length)] ?? 1;
}

/**
 * Reverb decay tuned so impulse length ≈ N beats.
 * Engine: durationSec = 0.6 + decay * 2.4 (track-insert).
 */
function bpmSyncedReverbDecay(
  bpm: number,
  rnd: () => number,
  beatFracs: readonly number[],
): number {
  const beatSec = beatMs(bpm) / 1000;
  const frac = beatFracs[Math.floor(rnd() * beatFracs.length)] ?? 2;
  const targetSec = beatSec * frac;
  return clamp((targetSec - 0.6) / 2.4, 0.05, 1);
}

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

function styleDamping(bias: StyleFxBias, rnd: () => number): number {
  return clamp(
    bias.dampCenter + (rnd() - 0.5) * 2 * bias.dampSpread,
    0.05,
    0.95,
  );
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

function fxEq(
  low: number,
  mid: number,
  high: number,
): TrackFx {
  return normalizeTrackFx({ type: "eq", low, mid, high });
}

function fxReverb(
  bpm: number,
  rnd: () => number,
  bias: StyleFxBias,
  mixLo: number,
  mixHi: number,
  beatFracs: readonly number[],
): TrackFx {
  const fracs = bias.longReverb
    ? beatFracs.map((f) => f * 1.35)
    : beatFracs;
  return normalizeTrackFx({
    type: "reverb",
    mix: mixLo + rnd() * (mixHi - mixLo),
    decay: bpmSyncedReverbDecay(bpm, rnd, fracs),
    damping: styleDamping(bias, rnd),
  });
}

function fxEcho(
  bpm: number,
  rnd: () => number,
  bias: StyleFxBias,
  mixLo: number,
  mixHi: number,
  delayChoices: readonly number[],
  feedbackLo: number,
  feedbackHi: number,
): TrackFx {
  const delays = bias.longEcho
    ? [...delayChoices, 1.5, 2, 3].filter((d, i, a) => a.indexOf(d) === i)
    : delayChoices;
  const fbBoost = bias.longEcho ? 0.12 : 0;
  return normalizeTrackFx({
    type: "echo",
    mix: mixLo + rnd() * (mixHi - mixLo),
    delayBeats: pickBeatFrac(rnd, delays),
    feedback: clamp(
      feedbackLo + rnd() * (feedbackHi - feedbackLo) + fbBoost,
      0,
      0.9,
    ),
    damping: styleDamping(bias, rnd),
  });
}

function fxChorus(rnd: () => number, bias: StyleFxBias, wet: boolean): TrackFx {
  const slow = bias.longReverb || bias.dampCenter >= 0.5;
  return normalizeTrackFx({
    type: "chorus",
    mix: (wet ? 0.28 : 0.2) + rnd() * 0.3,
    rateHz: slow ? 0.25 + rnd() * 1.1 : 0.5 + rnd() * 2.2,
    depth: 0.3 + rnd() * 0.45,
  });
}

function fxTremolo(rnd: () => number, energetic: boolean): TrackFx {
  return normalizeTrackFx({
    type: "tremolo",
    rateHz: energetic ? 4 + rnd() * 6 : 1.5 + rnd() * 4,
    depth: 0.25 + rnd() * 0.45,
  });
}

function fxVibrato(rnd: () => number, lyrical: boolean): TrackFx {
  return normalizeTrackFx({
    type: "vibrato",
    rateHz: lyrical ? 4.5 + rnd() * 3.5 : 3 + rnd() * 5,
    depth: lyrical ? 0.35 + rnd() * 0.4 : 0.2 + rnd() * 0.35,
  });
}

function pickSpaceFx(
  bpm: number,
  rnd: () => number,
  bias: StyleFxBias,
  mixLo: number,
  mixHi: number,
  reverbBeats: readonly number[],
  echoDelays: readonly number[],
  echoFb: readonly [number, number],
): TrackFx {
  if (rnd() < bias.echoBias) {
    return fxEcho(
      bpm,
      rnd,
      bias,
      mixLo,
      mixHi,
      echoDelays,
      echoFb[0],
      echoFb[1],
    );
  }
  return fxReverb(bpm, rnd, bias, mixLo, mixHi, reverbBeats);
}

function pickRoleFx(
  role: ExprRole,
  bpm: number,
  energy: number,
  style: MusicStyleId,
  rnd: () => number,
): TrackFx {
  const bias = styleFxBias(style);
  const wetP = clamp(bias.wetness * (0.75 + energy * 0.35), 0.08, 0.95);
  const modP = clamp(bias.modBias * (0.7 + energy * 0.4), 0.05, 0.85);
  const lyrical =
    style === "jazz" ||
    style === "blues" ||
    style === "folk" ||
    style === "classical" ||
    style === "ambient";

  switch (role) {
    case "kick": {
      const b = roleEqBands(role, rnd);
      return fxEq(b.low, b.mid, b.high);
    }
    case "hat": {
      const b = roleEqBands(role, rnd);
      return fxEq(b.low, b.mid, b.high);
    }
    case "bass":
      // Rare chorus on disco/funk bass; else EQ
      if (modP > 0.45 && rnd() < 0.22) {
        return fxChorus(rnd, bias, false);
      }
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    case "snare":
      if (rnd() < wetP * 0.85) {
        return pickSpaceFx(
          bpm,
          rnd,
          bias,
          0.14,
          0.32,
          [0.75, 1, 1.5],
          [0.5, 0.75, 1],
          [0.15, 0.35],
        );
      }
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    case "chord": {
      const r = rnd();
      if (r < modP * 0.55) return fxChorus(rnd, bias, true);
      if (r < wetP * 0.85) {
        return fxReverb(bpm, rnd, bias, 0.22, 0.45, [1.5, 2, 3]);
      }
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    }
    case "lead":
    case "arp": {
      const r = rnd();
      if (r < wetP * bias.echoBias * 0.85) {
        return fxEcho(
          bpm,
          rnd,
          bias,
          0.18,
          0.4,
          [0.5, 0.75, 1, 1.5],
          0.2,
          0.45,
        );
      }
      if (r < wetP * bias.echoBias * 0.85 + modP * 0.4) {
        return lyrical || rnd() < 0.55
          ? fxVibrato(rnd, lyrical)
          : fxTremolo(rnd, energy > 0.6);
      }
      if (r < wetP * bias.echoBias * 0.85 + modP * 0.85) {
        return fxChorus(rnd, bias, true);
      }
      if (r < wetP * 0.9 + modP * 0.25) {
        return fxReverb(bpm, rnd, bias, 0.16, 0.38, [1, 1.5, 2]);
      }
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    }
    case "texture": {
      const r = rnd();
      // Prefer mild EQ seat more often so beds don't all occupy the same band.
      if (r < 0.32) {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
      if (r < 0.32 + modP * 0.45) return fxChorus(rnd, bias, true);
      if (r < 0.32 + modP * 0.45 + wetP * 0.22) {
        return fxEcho(
          bpm,
          rnd,
          bias,
          0.22,
          0.45,
          [1, 1.5, 2, 3],
          0.25,
          0.5,
        );
      }
      return fxReverb(bpm, rnd, bias, 0.35, 0.65, [3, 4, 6]);
    }
    case "loop": {
      const r = rnd();
      if (r < 0.38) {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
      if (r < 0.38 + modP * 0.4) return fxTremolo(rnd, energy > 0.55);
      if (r < 0.38 + modP * 0.4 + wetP * 0.35) {
        return pickSpaceFx(
          bpm,
          rnd,
          bias,
          0.15,
          0.35,
          [1, 1.5, 2.5],
          [0.5, 1, 1.5],
          [0.15, 0.35],
        );
      }
      if (r < 0.38 + modP * 0.4 + wetP * 0.35 + modP * 0.2) {
        return fxChorus(rnd, bias, false);
      }
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    }
    case "perc":
      if (rnd() < wetP * 0.45) {
        return fxEcho(
          bpm,
          rnd,
          bias,
          0.12,
          0.3,
          [0.25, 0.5, 0.75],
          0.15,
          0.35,
        );
      }
      if (rnd() < modP * 0.2) return fxTremolo(rnd, true);
      {
        const b = roleEqBands(role, rnd);
        return fxEq(b.low, b.mid, b.high);
      }
    case "fx":
    default: {
      const r = rnd();
      if (r < 0.28) {
        const b = roleEqBands("fx", rnd);
        return fxEq(b.low, b.mid, b.high);
      }
      if (r < 0.28 + wetP * bias.echoBias) {
        return fxEcho(
          bpm,
          rnd,
          bias,
          0.25,
          0.55,
          [1, 1.5, 2, 3],
          0.28,
          0.55,
        );
      }
      if (r < 0.28 + wetP * bias.echoBias + modP * 0.5) {
        const m = rnd();
        if (m < 0.45) return fxChorus(rnd, bias, true);
        if (m < 0.75) return fxTremolo(rnd, energy > 0.5);
        return fxVibrato(rnd, lyrical);
      }
      return fxReverb(bpm, rnd, bias, 0.3, 0.6, [2, 3, 5]);
    }
  }
}

function pickTrackMix(
  role: ExprRole,
  trackIndex: number,
  trackCount: number,
  energy: number,
  bpm: number,
  style: MusicStyleId,
  rnd: () => number,
): Omit<SequenceTrackPlan, "trackId"> {
  const spread =
    trackCount <= 1 ? 0 : ((trackIndex / (trackCount - 1)) * 2 - 1) * 0.55;
  const panJitter = (rnd() - 0.5) * 0.15;
  const pan = clamp(spread + panJitter, -1, 1);
  const eGain = (energy - 0.5) * 2;
  const fx = pickRoleFx(role, bpm, energy, style, rnd);

  switch (role) {
    case "kick":
      return {
        gainDb: 0.5 + rnd() * 1.5 + eGain,
        pan: clamp(pan * 0.15, -0.2, 0.2),
        fx,
      };
    case "snare":
      return {
        gainDb: -1 + rnd() * 1.5 + eGain * 0.5,
        pan: clamp(pan * 0.4, -0.35, 0.35),
        fx,
      };
    case "hat":
      return {
        gainDb: -4 + rnd() * 2,
        pan: clamp(pan, -0.7, 0.7),
        fx,
      };
    case "bass":
      return {
        gainDb: rnd() * 1.5 + eGain * 0.5,
        pan: clamp(pan * 0.2, -0.25, 0.25),
        fx,
      };
    case "chord":
      return {
        gainDb: -2 + rnd() * 1.5,
        pan: clamp(pan, -0.55, 0.55),
        fx,
      };
    case "lead":
    case "arp":
      return {
        gainDb: -1 + rnd() * 2 + eGain * 0.4,
        pan: clamp(pan, -0.6, 0.6),
        fx,
      };
    case "texture":
      return {
        gainDb: -5 + rnd() * 2.5 - (1 - energy),
        pan: clamp(pan, -0.8, 0.8),
        fx,
      };
    case "loop":
      return {
        gainDb: -2.5 + rnd() * 2,
        pan: clamp(pan * 0.7, -0.5, 0.5),
        fx,
      };
    case "perc":
      return {
        gainDb: -2 + rnd() * 2 + eGain * 0.3,
        pan: clamp(pan, -0.75, 0.75),
        fx,
      };
    case "fx":
    default:
      return {
        gainDb: -3 + rnd() * 2.5,
        pan: clamp(pan, -0.85, 0.85),
        fx,
      };
  }
}

/**
 * Plan a full multi-track sequence over `bars`, drawing from the library.
 * Controls: seed + music style/patterns + density/energy/mix/groove; advanced
 * locks (key, palette, form, humanize, variation, sample variety, bpm-sync,
 * reverse, stutter, call–response, lock-pitch). Sample voices stay pinned per
 * section kind so verse/chorus returns stay familiar; spectral seating
 * (centroid + role EQ) spreads lows / mids / highs. Uses sample analysis + ML
 * tags when present. Pass `"auto"` to let the seed pick; omit for engine
 * defaults.
 */
export function planSequence(opts: {
  bars: number;
  beatsPerBar: number;
  ppq: number;
  bpm: number;
  seed: number;
  tracks: Array<{ id: string; index: number }>;
  samples: SequenceSampleIn[];
  /** Genre / pattern bank, or `"auto"` (infer from YAMNet / seed). */
  musicStyle?: GenMusicStyleChoice;
  /** Pitch-class 0–11, or `"auto"` / omit → infer from library. */
  keyRootPc?: number | GenAuto;
  /** Hit keep multiplier (0.35–1.5), or `"auto"`. Default 1. */
  density?: number | GenAuto;
  /** Dynamics / fills / expressivity (0–1), or `"auto"`. Default 0.55. */
  energy?: number | GenAuto;
  /** 0 = textures/field, 1 = drums/kit, or `"auto"`. Default 0.55. */
  drumsVsTexture?: number | GenAuto;
  groove?: GenGrooveChoice;
  scaleMode?: GenScaleMode;
  palette?: GenPaletteChoice;
  formStyle?: GenFormStyle;
  /** Timing jitter strength (0–1), or `"auto"`. */
  humanize?: number | GenAuto;
  /** Motif evolve / fill ornaments (0–1), or `"auto"`. Home samples stay pinned. */
  variation?: number | GenAuto;
  /**
   * How far the seed explores the library (0–1), or `"auto"`.
   * 0 = greedy best-fit (same voices across seeds); 1 = wide mix.
   */
  sampleVariety?: number | GenAuto;
  bpmSync?: GenTriState;
  reverse?: GenTriState;
  stutter?: GenTriState;
  callResponse?: GenTriState;
  /**
   * Keep native sample pitch: no semitone transpose, no resample stretch,
   * no melody/chord tone targeting. `"auto"` / `"off"` = unlocked.
   */
  lockPitch?: GenTriState;
  /**
   * Max upward transpose in semitones (0–24), or `"auto"` → 12.
   * Ignored when lockPitch is on.
   */
  pitchUpSemitones?: number | GenAuto;
  /**
   * Max downward transpose in semitones (0–24), or `"auto"` → 12.
   * Ignored when lockPitch is on.
   */
  pitchDownSemitones?: number | GenAuto;
  /**
   * Constrain tempo adapts to ×¼, ×½, ×1, ×2, ×4, ×8 only (snap BPM sync /
   * rate changes). `"auto"` / `"off"` = free ratio.
   */
  lockTempoPow2?: GenTriState;
  /**
   * Forbid stretch mode `preserve-pitch` (UI: "pitch"). Falls back to `copy`
   * when pitch is locked, else `resample`. `"on"` / `"off"` (default off).
   */
  forbidPitchStretch?: GenTriState;
  /**
   * Max time-stretch enlargement (clip duration / sample duration).
   * `"auto"` = no cap.
   */
  stretchUpRatio?: number | GenAuto;
  /**
   * Min time-stretch factor (clip duration / sample duration).
   * `"auto"` = no cap. `1` = no shortening; `0.5` = at most twice as short.
   */
  stretchDownRatio?: number | GenAuto;
}): SequencePlanResult {
  const { bars, beatsPerBar, ppq, bpm, seed, tracks, samples } = opts;
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

  const density = resolveStyleBiasedSlider(
    opts.density,
    rnd,
    0.35,
    1.5,
    1,
    styleProfile.densityCenter,
  );
  const energy = resolveStyleBiasedSlider(
    opts.energy,
    rnd,
    0,
    1,
    0.55,
    styleProfile.energyCenter,
  );
  const drumsVsTexture = resolveStyleBiasedSlider(
    opts.drumsVsTexture,
    rnd,
    0,
    1,
    0.55,
    styleProfile.drumsCenter,
  );
  const groove: GrooveKind =
    opts.groove === "auto"
      ? pickGroove(rnd, styleProfile.groove)
      : (opts.groove ?? styleProfile.groove);
  const humanize =
    opts.humanize === undefined
      ? (styleProfile.humanizeCenter ?? 1)
      : resolveStyleBiasedSlider(
          opts.humanize,
          rnd,
          0,
          1,
          styleProfile.humanizeCenter ?? 1,
          styleProfile.humanizeCenter,
        );
  // Bias toward familiarity: auto stays near ~0.32 (ornaments, not sample churn).
  const variation = resolveStyleBiasedSlider(
    opts.variation,
    rnd,
    0,
    1,
    0.32,
    0.32,
  );
  const scaleMode: GenScaleMode =
    opts.scaleMode && opts.scaleMode !== "auto"
      ? opts.scaleMode
      : styleProfile.scaleBias && rnd() < 0.75
        ? styleProfile.scaleBias
        : (opts.scaleMode ?? "auto");
  const formStyle: GenFormStyle = opts.formStyle ?? "auto";
  const bpmSyncMode: GenTriState = opts.bpmSync ?? "auto";
  const reverseMode: GenTriState = opts.reverse ?? "auto";
  const stutterMode: GenTriState = opts.stutter ?? "auto";
  const callResponseMode: GenTriState = opts.callResponse ?? "auto";
  const lockPitch = opts.lockPitch === "on";
  const lockTempoPow2 = opts.lockTempoPow2 === "on";
  const forbidPitchStretch = opts.forbidPitchStretch === "on";
  const resolvePitchBound = (v: number | GenAuto | undefined): number => {
    if (v === "auto" || v == null || !Number.isFinite(v)) return 12;
    return Math.round(clamp(v, 0, 24));
  };
  const stretchUpRatio =
    opts.stretchUpRatio === "auto" ||
    opts.stretchUpRatio == null ||
    !Number.isFinite(opts.stretchUpRatio)
      ? Infinity
      : clamp(opts.stretchUpRatio, 1, 16);
  const stretchDownRatio =
    opts.stretchDownRatio === "auto" ||
    opts.stretchDownRatio == null ||
    !Number.isFinite(opts.stretchDownRatio)
      ? 0
      : clamp(opts.stretchDownRatio, 1 / 16, 1);
  const pitchUpSemitones = lockPitch ? 0 : resolvePitchBound(opts.pitchUpSemitones);
  const pitchDownSemitones = lockPitch
    ? 0
    : resolvePitchBound(opts.pitchDownSemitones);
  const allowEmptyKit =
    musicStyle === "classical" || musicStyle === "ambient";

  const ticksPerBar = beatsPerBar * ppq;
  const seqEnd = bars * ticksPerBar;
  const pool = [...enriched].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    const ai = a.interestScore ?? -1;
    const bi = b.interestScore ?? -1;
    if (ai !== bi) return bi - ai;
    const ar = a.rating ?? 0;
    const br = b.rating ?? 0;
    if (ar !== br) return br - ar;
    const ac = a.clapCohesion ?? -1;
    const bc = b.clapCohesion ?? -1;
    if (ac !== bc) return bc - ac;
    // Prefer analysed / tagged samples when ranking the pool
    const aMeta =
      (a.analysisBpm != null ? 1 : 0) +
      (a.pitchHz != null || a.noteName ? 1 : 0) +
      ((a.yamnet?.length ?? 0) > 0 ? 1 : 0) +
      (a.clapVector?.length ? 1 : 0) +
      (a.stem ? 1 : 0);
    const bMeta =
      (b.analysisBpm != null ? 1 : 0) +
      (b.pitchHz != null || b.noteName ? 1 : 0) +
      ((b.yamnet?.length ?? 0) > 0 ? 1 : 0) +
      (b.clapVector?.length ? 1 : 0) +
      (b.stem ? 1 : 0);
    if (aMeta !== bMeta) return bMeta - aMeta;
    return a.id.localeCompare(b.id);
  });

  const rootPc = lockPitch
    ? 0
    : opts.keyRootPc == null || opts.keyRootPc === "auto"
      ? inferKeyRootPc(pool)
      : ((Math.round(opts.keyRootPc) % 12) + 12) % 12;
  const scale = lockPitch
    ? MAJOR_SCALE
    : pickScale(pool, rootPc, rnd, scaleMode);
  const sections = planSongForm(bars, rnd, {
    drumsVsTexture,
    energy,
    formStyle,
    formLean: styleProfile.formLean,
  });
  const chordTimeline = lockPitch
    ? []
    : buildSectionHarmonyTimeline(
        bars,
        sections.map((s) => ({
          kind: s.kind,
          startBar: s.startBar,
          bars: s.bars,
        })),
        paletteFromMix(
          drumsVsTexture,
          rnd,
          opts.palette,
          styleProfile.palette,
        ),
        scale === MINOR_SCALE,
        rnd,
      );

  const sortedTracks = [...tracks].sort((a, b) => a.index - b.index);
  const roles = assignTrackRoles(
    sortedTracks.length,
    pool,
    rnd,
    drumsVsTexture,
  );
  const trackPlans: SequenceTrackPlan[] = sortedTracks.map((track, ti) => {
    const role = roles[ti] ?? "perc";
    const mix = pickTrackMix(
      role,
      ti,
      sortedTracks.length,
      energy,
      bpm,
      musicStyle,
      rnd,
    );
    return { trackId: track.id, ...mix };
  });

  // Melodic ensemble: lock / respond / kinship (skill glane-arranger).
  const ensemblePlan = ensemble.plan({
    roles,
    rnd,
    callResponseMode,
    energy,
    sparse: drumsVsTexture < 0.4,
    musicStyle,
  });
  const ensembleStyle = ensemblePlan.styleProfile;
  const hasMelodicRespond = ensemblePlan.relationByTrack.some(
    (r) => r === "respond",
  );

  // Kit call–response pairs: lead↔perc, hat↔snare (melodic dialogue is EnsemblePlan).
  const respondTracks = new Set<number>();
  if (callResponseMode !== "off") {
    const leadIdx = roles.indexOf("lead");
    const percIdx = roles.indexOf("perc");
    const hatIdx = roles.indexOf("hat");
    const snareIdx = roles.indexOf("snare");
    if (leadIdx >= 0 && percIdx >= 0) respondTracks.add(percIdx);
    if (hatIdx >= 0 && snareIdx >= 0) {
      if (
        callResponseMode === "on" ||
        (callResponseMode === "auto" && rnd() < 0.45)
      ) {
        respondTracks.add(hatIdx);
      }
    }
  }

  const plans: SequenceClipPlan[] = [];
  const rankedByRole = new Map<ExprRole, SequenceSampleIn[]>();
  for (const role of ROLE_TRACK_ORDER) {
    rankedByRole.set(role, rankSamplesForRole(pool, role, rnd, sampleVariety));
  }

  const reverseBaseChance =
    reverseMode === "off"
      ? 0
      : reverseMode === "on"
        ? 0.32 + energy * 0.25 + variation * 0.15
        : (0.14 + energy * 0.1) * (0.5 + variation);

  const stutterBaseChance =
    stutterMode === "off"
      ? 0
      : stutterMode === "on"
        ? 0.22 + energy * 0.2 + variation * 0.15
        : energy > 0.55
          ? (0.12 + energy * 0.1) * (0.55 + variation * 0.9)
          : 0;

  /** Cross-track spectral seats already claimed (centroid occupancy). */
  const spectralOccupied: SpectralOccupancy[] = [];
  /** Cross-track dominant notes already sounding (pitch or centroid). */
  const pitchOccupied: PitchOccupancy[] = [];

  for (let ti = 0; ti < sortedTracks.length; ti++) {
    const track = sortedTracks[ti]!;
    const role = roles[ti] ?? "perc";
    const ranked = rankedByRole.get(role) ?? pool;
    const poolFrac = 0.6 + sampleVariety * 0.4;
    const samplePool = ranked.slice(
      0,
      Math.min(
        Math.max(3, Math.ceil(ranked.length * poolFrac)),
        ranked.length,
      ),
    );
    if (samplePool.length === 0) continue;

    const motif = buildMotif(role, beatsPerBar, ppq, rnd, groove, musicStyle);
    const motifAlt = buildMotif(role, beatsPerBar, ppq, rnd, groove, musicStyle);
    // Skip empty kit tracks for classical / ambient pattern banks
    if (allowEmptyKit && isDrumRole(role) && motif.length === 0) {
      const plan = trackPlans[ti];
      if (plan) {
        plan.fx = withRoleFilters(
          plan.fx,
          role,
          musicStyle,
          energy,
          undefined,
          rnd,
        );
      }
      continue;
    }
    const voiceRel = ensemblePlan.relationByTrack[ti] ?? "independent";
    const isPrimaryMelodic = ti === ensemblePlan.primaryLeadTrack;
    const sparseMel = drumsVsTexture < 0.4;
    const coupleArp = ensemble.shouldCoupleArp(voiceRel, ensembleStyle);
    const coupledArp =
      ensemblePlan.leadCell != null
        ? ensemble.melodyCellToArpCell(ensemblePlan.leadCell)
        : null;
    const coupledArpAlt =
      ensemblePlan.leadCellAlt != null
        ? ensemble.melodyCellToArpCell(ensemblePlan.leadCellAlt)
        : coupledArp;
    const leadCell =
      !lockPitch && role === "lead"
        ? isPrimaryMelodic && ensemblePlan.leadCell
          ? ensemblePlan.leadCell
          : voiceRel === "respond" && ensemblePlan.responseCell
            ? ensemblePlan.responseCell
            : (ensemblePlan.leadCell ?? pickMelodyCell(rnd, sparseMel))
        : null;
    const leadCellAlt =
      !lockPitch && role === "lead"
        ? isPrimaryMelodic && ensemblePlan.leadCellAlt
          ? ensemblePlan.leadCellAlt
          : (ensemblePlan.leadCellAlt ?? pickMelodyCell(rnd, sparseMel))
        : null;
    const arpCell =
      !lockPitch && role === "arp"
        ? coupleArp && coupledArp
          ? coupledArp
          : pickArpCell(rnd, sparseMel || energy < 0.4)
        : null;
    const arpCellAlt =
      !lockPitch && role === "arp"
        ? coupleArp && coupledArpAlt
          ? coupledArpAlt
          : pickArpCell(rnd, true)
        : null;

    const humanizeMs =
      (isDrumRole(role)
        ? 6 + energy * 6
        : role === "lead" || role === "arp"
          ? 18 + energy * 10
          : 14) * humanize;

    // Stable home sample per section kind (verse↔verse, chorus↔chorus).
    const homeByKind = new Map<SectionKind, SequenceSampleIn>();
    const kindOccurrence = new Map<SectionKind, number>();
    /** Same sample window when a section kind returns (familiar ear-hook). */
    const loopContentByKey = new Map<
      string,
      { contentOffsetMs: number; loopEnabled: boolean; loopLengthMs?: number }
    >();
    let trackFxRefined = false;

    for (const section of sections) {
      const baseMotif =
        section.kind === "bridge" || section.kind === "outro" ? motifAlt : motif;
      const occurrence = kindOccurrence.get(section.kind) ?? 0;
      kindOccurrence.set(section.kind, occurrence + 1);
      // Returning sections stay closer to the home motif (classic song recall).
      const evolveScale =
        occurrence === 0
          ? 0.22 + variation * 0.5
          : 0.1 + variation * 0.32;

      const sparseSection =
        section.kind === "intro" ||
        section.kind === "outro" ||
        section.kind === "bridge";

      const barStride =
        role === "texture"
          ? Math.max(
              1,
              Math.min(
                section.bars,
                (sparseSection ? 3 : 2) + pickInt(rnd, 0, sparseSection ? 2 : 1),
              ),
            )
          : role === "loop"
            ? Math.max(
                1,
                Math.min(section.bars, sparseSection ? 3 : 2),
              )
            : role === "chord"
              ? section.kind === "chorus"
                ? 2
                : sparseSection
                  ? 2
                  : 1
              : role === "bass" && sparseSection
                ? Math.max(1, Math.min(2, section.bars))
                : 1;

      const homeWasNew = !homeByKind.has(section.kind);
      const homeSample = pickHomeSampleForKind(
        section.kind,
        role,
        samplePool,
        homeByKind,
        spectralOccupied,
        rnd,
        sampleVariety,
      );
      if (homeWasNew) {
        registerSpectralOccupancy(spectralOccupied, role, homeSample);
      }
      if (!trackFxRefined) {
        const plan = trackPlans[ti];
        if (plan) {
          plan.fx = withRoleFilters(
            withSpectralTrackEq(plan.fx, role, homeSample, rnd),
            role,
            musicStyle,
            energy,
            homeSample,
            rnd,
          );
        }
        trackFxRefined = true;
      }

      for (let b = 0; b < section.bars; b += barStride) {
        const absBar = section.startBar + b;
        const barTick = absBar * ticksPerBar;
        const chord = lockPitch
          ? { degree: 0, tones: [0, 2, 4] as const }
          : (chordTimeline[absBar] ?? {
              degree: 0,
              tones: [0, 2, 4] as const,
            });
        const degreeHint = chord.degree;

        // Stick to the section home sample; rare fill ornament only at high variation.
        let sample = homeSample;
        const lastBar = b + barStride >= section.bars;
        const allowOrnament =
          variation > 0.6 &&
          samplePool.length > 1 &&
          (lastBar || section.altSample || section.kind === "bridge");
        if (allowOrnament && rnd() < (variation - 0.6) * 0.5) {
          // Prefer an ornament that still respects the role band when possible.
          let bestOrn = samplePool.find((s) => s.id !== homeSample.id) ?? homeSample;
          let bestSc = Infinity;
          for (const cand of samplePool) {
            if (cand.id === homeSample.id) continue;
            const sc =
              spectralFitPenalty(cand, role) +
              spectralClashPenalty(cand, role, spectralOccupied) * 0.5;
            if (sc < bestSc) {
              bestSc = sc;
              bestOrn = cand;
            }
          }
          sample = bestOrn;
        }

        if (
          !sectionAllowsRole(role, section, b, energy, rnd)
        ) {
          continue;
        }

        const sectionVoiceRel = ensemble.resolveSectionRelation(
          voiceRel,
          section.kind,
          role,
          rnd,
          ensembleStyle,
        );
        const respondMode = ensemble.respondPlacementMode(
          section.kind,
          ensembleStyle,
        );
        const callBar =
          respondMode === "alternateBars" && ensemble.isCallBar(absBar);

        // Alternate-bar dialogue: followers rest on call bars.
        if (
          sectionVoiceRel === "respond" &&
          !isPrimaryMelodic &&
          isMelodicRole(role) &&
          callBar
        ) {
          continue;
        }

        let hits: MotifHit[];
        if (role === "arp" && (arpCell || arpCellAlt)) {
          // Library tonal oneshots sequenced on chord tones from the harmony timeline.
          const cell =
            section.kind === "bridge" || section.kind === "outro"
              ? (arpCellAlt ?? arpCell!)
              : arpCell!;
          hits = arpCellToHits(cell, ppq, beatsPerBar, groove);
          if (section.kind === "intro" || section.kind === "outro") {
            hits = hits.filter((h) => h.accent || rnd() < 0.35);
          } else if (section.kind === "verse") {
            hits = hits.filter((h) => h.accent || rnd() < 0.7 + energy * 0.2);
          }
        } else if (role === "lead" && (leadCell || leadCellAlt)) {
          if (
            sectionVoiceRel === "respond" &&
            ensemblePlan.responseCell &&
            respondMode === "halfBar"
          ) {
            hits = ensemble.applyRespond(
              ensemblePlan.responseCell,
              beatsPerBar,
              ppq,
            );
          } else {
            const cell =
              section.kind === "bridge" || section.kind === "outro"
                ? (leadCellAlt ?? leadCell!)
                : leadCell!;
            hits = melodyCellToHits(cell, ppq, beatsPerBar, groove);
            if (section.kind === "intro" || section.kind === "outro") {
              hits = hits.filter((h) => h.accent || rnd() < 0.28);
            } else if (section.kind === "bridge") {
              hits = hits.filter((h) => h.accent || rnd() < 0.5);
            } else if (section.kind === "verse") {
              hits = hits.filter((h) => h.accent || rnd() < 0.55 + energy * 0.2);
            }
            // Soft mutual gate vs arp ostinato on the same arrangement.
            if (roles.includes("arp") && rnd() < 0.45) {
              hits = hits.filter((h) => h.accent || rnd() < 0.35);
            }
          }
        } else {
          hits = evolveMotifHits(baseMotif, {
            role,
            section: {
              ...section,
              evolve: section.evolve * evolveScale,
            },
            barInSection: b,
            beatsPerBar,
            ppq,
            density,
            energy,
            rnd,
            allowEmptyKit,
          });
        }

        // Ensemble relations for melodic followers / primary call thinning.
        if (
          !lockPitch &&
          isMelodicRole(role) &&
          ensemblePlan.sharedOnsets.length > 0
        ) {
          if (
            sectionVoiceRel === "respond" &&
            !isPrimaryMelodic &&
            role !== "lead"
          ) {
            const cell =
              ensemblePlan.responseCell ?? ensemblePlan.leadCell;
            if (cell) {
              hits =
                respondMode === "alternateBars"
                  ? ensemble.applyRespondFullBar(cell, beatsPerBar, ppq)
                  : ensemble.applyRespond(cell, beatsPerBar, ppq);
            }
          } else if (sectionVoiceRel === "lock") {
            hits = ensemble.applyLock(
              hits,
              ensemblePlan.sharedOnsets,
              beatsPerBar,
              ppq,
              ensemble.lockDegreeOffset(role, rnd, ensembleStyle.family),
            );
          } else if (sectionVoiceRel === "kinship") {
            hits = ensemble.applyKinship(
              hits,
              ensemblePlan.sharedOnsets,
              beatsPerBar,
              ppq,
              rnd,
            );
          } else if (isPrimaryMelodic && hasMelodicRespond) {
            if (respondMode === "alternateBars" && !callBar) {
              hits = ensemble.thinAnswerBar(hits, rnd);
            } else if (respondMode === "halfBar") {
              hits = ensemble.thinCallHalf(hits, beatsPerBar, ppq, rnd);
            }
          }
        }

        // Kit-only half-bar shift (melodic dialogue uses EnsemblePlan).
        if (isDrumRole(role) && respondTracks.has(ti)) {
          hits = callResponseShift(hits, ppq, beatsPerBar, true);
        }

        const absHits = hits
          .map((h) => {
            const humanTicks =
              ((rnd() * 2 - 1) * humanizeMs * bpm * ppq) / 60_000;
            return {
              ...h,
              tick: Math.round(barTick + h.tickInBar + humanTicks),
            };
          })
          .filter((h) => h.tick >= 0 && h.tick < seqEnd)
          .sort((a, b) => a.tick - b.tick);

        for (let hi = 0; hi < absHits.length; hi++) {
          const hit = absHits[hi]!;
          const next = absHits[hi + 1]?.tick ?? null;

          // Harmony retune needs the recorded fundamental (pitchHz / noteName).
          if (
            !lockPitch &&
            (role === "arp" ||
              role === "lead" ||
              role === "bass" ||
              role === "chord") &&
            !sampleHasFundamental(sample)
          ) {
            continue;
          }

          const stutter =
            stutterBaseChance > 0 &&
            (role === "lead" || role === "perc" || role === "hat") &&
            (stutterMode === "on" || section.kind === "chorus") &&
            hit.accent &&
            rnd() < stutterBaseChance;

          const allowResamplePitch =
            pitchUpSemitones > 0 || pitchDownSemitones > 0;

          const bpmSync = bpmSyncStretch(
            sample,
            bpm,
            role,
            rnd,
            bpmSyncMode,
            lockTempoPow2,
          );
          const bpmLengthFactor = bpmSync?.lengthFactor ?? 1;

          let lengthTick = pickLengthTick({
            sample,
            role,
            startTick: hit.tick,
            nextTick: next,
            barTick,
            ticksPerBar: ticksPerBar * barStride,
            bpm,
            ppq,
            section,
            bpmLengthFactor,
            stutter,
            energy,
            rnd,
          });
          if (hit.tick + lengthTick > seqEnd) lengthTick = seqEnd - hit.tick;
          if (lengthTick < Math.floor(ppq / 4)) continue;

          const naturalTick = msToLengthTick(sample.durationMs, bpm, ppq);
          // When pow2 lock is on, snap free duration changes to ×¼…×8 of the
          // natural (BPM-synced) length — no arbitrary tempo warps.
          // Arp gates are harmony-cell driven — never snap to sample duration.
          if (lockTempoPow2 && !stutter && role !== "arp") {
            const base = Math.max(1, naturalTick * bpmLengthFactor);
            const rawFactor = lengthTick / base;
            const snapped = snapTempoRatioPow2(rawFactor);
            if (Math.abs(snapped - rawFactor) > 0.06) {
              lengthTick = Math.max(
                Math.floor(ppq / 4),
                Math.round(base * snapped),
              );
              if (hit.tick + lengthTick > seqEnd) {
                lengthTick = seqEnd - hit.tick;
              }
              if (lengthTick < Math.floor(ppq / 4)) continue;
            }
          }
          const { fitFactor, artisticFactor: factor } = clipStretchFactors(
            lengthTick,
            naturalTick,
            bpmLengthFactor,
          );

          // Library arp / lead: pitch each hit onto the current chord tone.
          let pitchSemitones = lockPitch
            ? 0
            : pickPitchSemitones({
                sample,
                role,
                rootPc,
                scale,
                degreeHint,
                chordTones: chord.tones,
                toneIndex: role === "chord" ? hi : undefined,
                melodyDegree:
                  role === "lead" || role === "arp"
                    ? (hit.melodyDegree ?? degreeHint)
                    : undefined,
                accent: hit.accent,
                section,
                energy,
                rnd,
                maxUp: pitchUpSemitones,
                maxDown: pitchDownSemitones,
              });

          const pitchAllowedRels =
            !lockPitch && shouldEnforceScale(role, sample)
              ? harmonicAllowedRels(
                  role,
                  scale,
                  degreeHint,
                  chord.tones,
                  hit.accent,
                )
              : undefined;

          let stretchMode = pickStretchMode({
            sample,
            role,
            lengthFactor: factor,
            pitchSemitones,
            bpmSync,
            energy,
            stutter,
            lockPitch,
            allowResamplePitch,
            rnd,
          });
          // BPM sync needs preserve-pitch; do not replace it with resample.
          if (forbidPitchStretch && !bpmSync) {
            stretchMode = withoutPreservePitchStretch(stretchMode, lockPitch);
          }
          // Resample pitch uses fitFactor (clip/natural), never artisticFactor.
          stretchMode = constrainStretchToPitchBounds(
            stretchMode,
            pitchSemitones,
            fitFactor,
            pitchUpSemitones,
            pitchDownSemitones,
            {
              forbidPitchStretch,
              loopish: (sample.loopScore ?? 0) > 0.45,
            },
          );

          // Pow2 tempo lock: avoid non-grid resample/stretch; tile or leave native.
          // Keep BPM sync preserve-pitch (length already snapped when pow2 is on).
          if (
            lockTempoPow2 &&
            !stutter &&
            !bpmSync &&
            stretchMode !== "off" &&
            stretchMode !== "copy" &&
            !nearTempoPow2(factor) &&
            !nearTempoPow2(1 / Math.max(1e-6, factor))
          ) {
            stretchMode =
              (sample.loopScore ?? 0) > 0.45 || factor > 1.1
                ? "copy"
                : "off";
          }

          // Tempo-matched loops: prefer a musical sub-window + loop over
          // stretching the whole take to fill the clip — but not when BPM sync
          // still needs preserve-pitch to match project tempo.
          if (
            !stutter &&
            !bpmSync &&
            stretchMode !== "copy" &&
            tempoAlignedForLoop(sample, bpm) &&
            ((sample.loopScore ?? 0) > 0.4 ||
              (sample.loopStartMs != null && sample.loopEndMs != null)) &&
            (role === "loop" ||
              role === "texture" ||
              role === "chord" ||
              role === "perc") &&
            Math.abs(factor - 1) > 0.08
          ) {
            stretchMode = "off";
          }

          if (!stutter) {
            // Cap artistic stretch (vs tempo-matched length), not raw fitFactor —
            // otherwise BPM sync itself trips stretchUp/Down and loses tempo lock.
            const capped = constrainStretchToDurationRatio(
              stretchMode,
              factor,
              stretchUpRatio,
              stretchDownRatio,
              (sample.loopScore ?? 0) > 0.45,
            );
            const keepBpmPreserve =
              bpmSync &&
              stretchMode === "preserve-pitch" &&
              capped !== "preserve-pitch";
            if (!keepBpmPreserve) stretchMode = capped;
          }

          let stretchPitch =
            stretchMode === "resample"
              ? resampleStretchPitchSemis(fitFactor)
              : 0;
          if (!lockPitch) {
            const finalized = finalizeScalePitch({
              sample,
              role,
              pitchSemitones,
              stretchMode,
              fitFactor,
              rootPc,
              scale,
              maxUp: pitchUpSemitones,
              maxDown: pitchDownSemitones,
              allowedRels: pitchAllowedRels,
            });
            pitchSemitones = finalized.pitchSemitones;
            stretchMode = finalized.stretchMode;
            stretchPitch = finalized.stretchPitch;
            pitchSemitones = avoidFundamentalClash({
              sample,
              preferredSemis: pitchSemitones,
              stretchSemis: stretchPitch,
              startTick: hit.tick,
              endTick: hit.tick + lengthTick,
              occupied: pitchOccupied,
              rootPc,
              scale,
              maxUp: pitchUpSemitones,
              maxDown: pitchDownSemitones,
              enforceScale: shouldEnforceScale(role, sample),
              allowedRels: pitchAllowedRels,
            });
          } else {
            stretchPitch = 0;
          }

          const lengthMs = lengthTickToMs(lengthTick, bpm, ppq);
          const { fadeInMs, fadeOutMs, fadeCurve } = pickFades({
            sample,
            role,
            lengthMs,
            stretchMode,
            accent: hit.accent,
            energy,
            stutter,
            rnd,
          });

          const loopSeed =
            stutter ||
            stretchMode === "copy" ||
            ((sample.loopScore ?? 0) > 0.5 &&
              (factor > 1.05 || role === "texture" || role === "loop"));

          const contentKey = `${section.kind}:${sample.id}:${stretchMode}`;
          let loopPick = loopContentByKey.get(contentKey);
          if (!loopPick) {
            loopPick = pickLoopContent({
              sample,
              role,
              lengthMs,
              bpm,
              beatsPerBar,
              loopEnabled: loopSeed,
              stretchMode,
              energy,
              variation,
              rnd,
            });
            loopContentByKey.set(contentKey, loopPick);
          }
          // Stable offset/slice when the section returns; loop flag follows clip length.
          const contentOffsetMs = loopPick.contentOffsetMs;
          const loopLengthMs = loopPick.loopLengthMs;
          const loopEnabled =
            loopLengthMs != null
              ? lengthMs > loopLengthMs * 1.05
              : loopPick.loopEnabled;

          const reverse =
            reverseBaseChance > 0 &&
            (role === "texture" || role === "fx" || role === "lead") &&
            (reverseMode === "on" ||
              section.kind === "bridge" ||
              section.kind === "outro") &&
            rnd() < reverseBaseChance;

          let gainDb = hit.gainDb + section.gainBiasDb + (energy - 0.5) * 1.5;
          // Level from analysis: lift quiet beds, ease hot peaks
          if (sample.lufs != null && Number.isFinite(sample.lufs)) {
            gainDb += clamp((-18 - sample.lufs) * 0.12, -2.5, 3);
          }
          if (sample.peakDbtp != null && Number.isFinite(sample.peakDbtp) && sample.peakDbtp > -1) {
            gainDb -= Math.min(2, (sample.peakDbtp + 1) * 1.2);
          }
          if (section.kind === "chorus") {
            gainDb += (1.2 + Math.min(1.5, b * 0.1)) * (0.55 + energy * 0.45);
          }
          if (section.kind === "prechorus") {
            gainDb += (b / Math.max(1, section.bars)) * 1.5 * energy;
          }
          if (section.kind === "intro") {
            gainDb -= (1 - b / Math.max(1, section.bars)) * 1.5;
          }
          if (section.kind === "bridge") {
            gainDb -= isDrumRole(role) ? 2.5 : 0.8;
          }
          if (section.kind === "outro") {
            gainDb -= (b / Math.max(1, section.bars)) * 5;
          }
          if (stutter) gainDb += 0.5;

          const repeats =
            stutter && rnd() < 0.7
              ? pickInt(rnd, 1, 2 + Math.floor(energy * 2 * variation))
              : 0;

          const pushClip = (
            startTick: number,
            len: number,
            g: number,
            rev: boolean,
          ) => {
            plans.push({
              trackId: track.id,
              sampleId: sample.id,
              startTick,
              lengthTick: len,
              contentOffsetMs,
              gainDb: g,
              loopEnabled,
              loopLengthMs,
              fadeInMs,
              fadeOutMs,
              fadeCurve,
              pitchSemitones,
              stretchMode,
              reverse: rev,
            });
            const domMidi = sampleDominantMidi(sample);
            if (domMidi != null) {
              pitchOccupied.push({
                startTick,
                endTick: startTick + len,
                pc: pitchClassOf(domMidi, pitchSemitones + stretchPitch),
              });
            }
          };

          pushClip(hit.tick, lengthTick, gainDb, reverse);
          let repTick = hit.tick + lengthTick;
          for (let r = 0; r < repeats; r++) {
            if (repTick + lengthTick > seqEnd) break;
            if (next != null && repTick + lengthTick > next - 2) break;
            pushClip(
              repTick,
              lengthTick,
              gainDb - r * 0.8,
              reverse && rnd() < 0.3,
            );
            repTick += lengthTick;
          }
        }
      }
    }
  }

  const clips = plans.sort(
    (a, b) =>
      a.startTick - b.startTick ||
      a.trackId.localeCompare(b.trackId) ||
      a.sampleId.localeCompare(b.sampleId),
  );
  return { clips, tracks: trackPlans };
}
