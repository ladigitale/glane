/** Deterministic generative helpers — song-form motifs + expressive roles. */

import {
  DEFAULT_TRACK_FX,
  ExprRoleSchema,
  normalizeTrackFx,
  parseExprRoleTag,
  type ExprRole,
  type FadeCurve,
  type StretchMode,
  type TrackFx,
} from "@glane/core-model";
import {
  expandChordTimeline,
  pickMelodyCell,
  pickProgressionBank,
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

/**
 * Classic-song sample identity: each section kind keeps one home sample so
 * verse / chorus returns reuse the same voice. Contrast lives in bridge/outro.
 */
function homeSampleIndexForKind(
  kind: SectionKind,
  poolLen: number,
  assigned: Map<SectionKind, number>,
): number {
  if (poolLen <= 1) return 0;
  const cached = assigned.get(kind);
  if (cached != null) return cached;

  const taken = new Set(assigned.values());
  const prefer = (candidates: number[]): number => {
    for (const raw of candidates) {
      const idx = ((raw % poolLen) + poolLen) % poolLen;
      if (!taken.has(idx)) return idx;
    }
    return ((candidates[0]! % poolLen) + poolLen) % poolLen;
  };

  let idx: number;
  switch (kind) {
    case "chorus":
      idx = prefer([1, 0, 2]);
      break;
    case "prechorus":
      idx = assigned.get("verse") ?? prefer([0, 1]);
      break;
    case "bridge":
      idx = prefer([2, 1, poolLen - 1, 0]);
      break;
    case "outro":
      idx = assigned.get("bridge") ?? prefer([2, poolLen - 1, 1, 0]);
      break;
    case "intro":
      idx = assigned.get("verse") ?? prefer([0, 1]);
      break;
    case "verse":
    default:
      idx = prefer([0, 1]);
      break;
  }
  assigned.set(kind, idx);
  return idx;
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
      if (role === "chord") return rnd() < 0.4 + e * 0.15;
      if (role === "bass") return progress > 0.1 || rnd() < 0.55;
      // texture / loop: often present but thinned by density + stride
      return rnd() < 0.7 + e * 0.15;
    }
    case "verse": {
      if (role === "lead") return rnd() < 0.45 + e * 0.3;
      if (role === "fx") return rnd() < 0.3 + e * 0.2;
      if (role === "hat") return rnd() < 0.75 + e * 0.15;
      return true;
    }
    case "prechorus": {
      // Build: almost full, lead still restrained
      if (role === "lead") return rnd() < 0.55 + e * 0.3;
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
      if (role === "bass" || role === "chord")
        return rnd() < keep * 0.55 + 0.1;
      if (role === "fx") return rnd() < keep * 0.4;
      return rnd() < keep + 0.2;
    }
    default:
      return true;
  }
}

type MotifHit = { tickInBar: number; gainDb: number; accent: boolean };

const ROLE_TRACK_ORDER: ExprRole[] = [
  "kick",
  "snare",
  "hat",
  "bass",
  "chord",
  "lead",
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
  "bass",
];

const ROLE_FALLBACKS: Record<ExprRole, ExprRole[]> = {
  kick: ["perc", "bass", "loop"],
  snare: ["perc", "hat", "fx"],
  hat: ["perc", "fx", "texture"],
  perc: ["hat", "snare", "kick"],
  bass: ["chord", "lead", "loop"],
  chord: ["lead", "texture", "bass"],
  lead: ["chord", "loop", "fx"],
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
  return role === "bass" || role === "chord" || role === "lead";
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
    });
    t += ev.sixteenths * ticksPer16;
  }
  return hits.length > 0 ? hits : [{ tickInBar: 0, gainDb: 0, accent: true }];
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

function scoreSampleForRole(s: SequenceSampleIn, role: ExprRole): number {
  const inferred = resolveExprRole(s);
  let score = inferred === role ? 0 : 8;
  const fb = ROLE_FALLBACKS[role] ?? [];
  const fi = fb.indexOf(inferred);
  if (inferred !== role && fi >= 0) score = 2 + fi;
  if (s.forceRole === role) score -= 4;
  if (s.favorite) score -= 1.5;
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
          : role === "lead" || role === "bass" || role === "chord"
            ? Math.max(scores.tonal ?? 0, scores.voice ?? 0)
            : undefined;
    if (want != null && want > 0.4) score -= want;
  }
  score += mlScoreAdjust(s, role, inferred);
  return score;
}

function rankSamplesForRole(
  pool: SequenceSampleIn[],
  role: ExprRole,
): SequenceSampleIn[] {
  return [...pool].sort(
    (a, b) =>
      scoreSampleForRole(a, role) - scoreSampleForRole(b, role) ||
      a.id.localeCompare(b.id),
  );
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

function pickPitchSemitones(opts: {
  sample: SequenceSampleIn;
  role: ExprRole;
  rootPc: number;
  scale: readonly number[];
  degreeHint: number;
  chordTones?: readonly ChordTone[];
  toneIndex?: number;
  melodyDegree?: number;
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
    section,
    energy,
    rnd,
    maxUp,
    maxDown,
  } = opts;
  const clampPitch = (semis: number) =>
    clamp(semis, -Math.max(0, maxDown), Math.max(0, maxUp));
  const source = sampleSourceMidi(sample);

  if (maxUp <= 0 && maxDown <= 0) return 0;

  if (isDrumRole(role) || role === "fx") {
    if (rnd() > 0.2 + energy * 0.15) return 0;
    const span = Math.min(
      maxUp,
      maxDown,
      section.kind === "bridge" || section.kind === "chorus" ? 7 : 4,
    );
    if (span <= 0) return 0;
    return clampPitch(pickInt(rnd, -span, span));
  }

  if (role === "texture" || role === "loop") {
    if (!isMelodicClass(sample.class, sample.harmonicity)) {
      if (rnd() >= 0.25 + energy * 0.2) return 0;
      const span = Math.min(7, maxUp, maxDown);
      return span > 0 ? clampPitch(pickInt(rnd, -span, span)) : 0;
    }
  }

  let degree = scale[degreeHint % scale.length] ?? 0;
  if (role === "chord" && chordTones && chordTones.length > 0) {
    const tone = chordTones[(toneIndex ?? 0) % chordTones.length]!;
    degree = chordToneSemis(scale, degreeHint, tone);
  } else if (role === "lead" && melodyDegree != null) {
    const md = melodyDegree;
    const oct = Math.floor(md / scale.length);
    degree = (scale[((md % scale.length) + scale.length) % scale.length] ?? 0) +
      oct * 12;
  } else if (role === "bass") {
    degree = scale[degreeHint % scale.length] ?? 0;
  }

  let octave = 0;
  if (role === "bass") octave = pickInt(rnd, -1, 0);
  else if (role === "lead") {
    octave = pickInt(rnd, 0, 1);
    if (section.kind === "chorus" && rnd() < 0.35 * energy) octave += 1;
  } else if (role === "chord") octave = toneIndex && toneIndex > 1 ? 1 : 0;

  const baseOctave =
    source != null
      ? Math.floor(Math.round(source) / 12) - 1
      : role === "bass"
        ? 2
        : 4;
  const targetMidi = (baseOctave + octave + 1) * 12 + rootPc + degree;
  const fromMidi = source != null ? source : 60;
  let semis = clampPitch(Math.round(targetMidi - fromMidi));

  if (semis === 0 && section.evolve > 0.3 && rnd() < section.evolve * energy) {
    const step = scale[pickInt(rnd, 1, scale.length - 1)] ?? 2;
    semis = clampPitch(rnd() < 0.5 ? step : -step);
  }
  return semis;
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

/** Stretch toward project BPM when sample has analysisBpm. */
function bpmSyncStretch(
  sample: SequenceSampleIn,
  projectBpm: number,
  role: ExprRole,
  rnd: () => number,
  mode: GenTriState = "auto",
  lockPitch = false,
  lockTempoPow2 = false,
): { stretchMode: StretchMode; lengthFactor: number } | null {
  if (mode === "off") return null;
  const src = sample.analysisBpm;
  if (src == null || src < 40 || src > 240) return null;
  let ratio = projectBpm / src;
  if (lockTempoPow2) {
    ratio = snapTempoRatioPow2(ratio);
  }
  if (Math.abs(ratio - 1) < 0.04) return null;
  const mild = Math.abs(ratio - 1) <= 0.12;
  const pickMode = (preferPreserve: boolean): StretchMode => {
    if (lockPitch || preferPreserve || !mild) return "preserve-pitch";
    return "resample";
  };
  if (mode === "on") {
    return {
      stretchMode: pickMode(false),
      lengthFactor: 1 / ratio,
    };
  }
  if (isDrumRole(role) && Math.abs(ratio - 1) > 0.25 && rnd() < 0.5) {
    // Drums: prefer one-shot at native feel unless close
    return null;
  }
  if (role === "loop" || role === "texture" || role === "chord") {
    return {
      stretchMode: pickMode(false),
      lengthFactor: 1 / ratio,
    };
  }
  if (isMelodicRole(role)) {
    return {
      stretchMode: "preserve-pitch",
      lengthFactor: 1 / ratio,
    };
  }
  if (lockPitch) {
    return rnd() < 0.4
      ? { stretchMode: "preserve-pitch", lengthFactor: 1 / ratio }
      : null;
  }
  return rnd() < 0.4
    ? { stretchMode: "resample", lengthFactor: 1 / ratio }
    : null;
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
    rnd,
  } = opts;
  if (stutter) {
    const mode = rnd() < 0.6 || lockPitch ? "copy" : "resample";
    return lockPitch ? stretchWithoutPitchShift(mode) : mode;
  }
  if (bpmSync) {
    return lockPitch
      ? stretchWithoutPitchShift(bpmSync.stretchMode)
      : bpmSync.stretchMode;
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
      !lockPitch &&
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
    if (lockPitch) return "preserve-pitch";
    return rnd() < 0.35 + energy * 0.15 ? "resample" : "preserve-pitch";
  }
  if (!lockPitch && rnd() < 0.08 + energy * 0.06) return "resample";
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
    case "kick":
      return fxEq(
        1.15 + rnd() * 0.25,
        0.9 + rnd() * 0.1,
        0.75 + rnd() * 0.15,
      );
    case "hat":
      return fxEq(
        0.55 + rnd() * 0.2,
        0.95,
        1.2 + rnd() * 0.3,
      );
    case "bass":
      // Rare chorus on disco/funk bass; else EQ
      if (modP > 0.45 && rnd() < 0.22) {
        return fxChorus(rnd, bias, false);
      }
      return fxEq(
        1.2 + rnd() * 0.3,
        0.95,
        0.7 + rnd() * 0.2,
      );
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
      return fxEq(0.85, 1.1, 1.2);
    case "chord": {
      const r = rnd();
      if (r < modP * 0.7) return fxChorus(rnd, bias, true);
      if (r < wetP) {
        return fxReverb(bpm, rnd, bias, 0.22, 0.45, [1.5, 2, 3]);
      }
      return fxEq(0.95, 1, 1.05);
    }
    case "lead": {
      const r = rnd();
      if (r < wetP * bias.echoBias) {
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
      if (r < wetP * bias.echoBias + modP * 0.45) {
        return lyrical || rnd() < 0.55
          ? fxVibrato(rnd, lyrical)
          : fxTremolo(rnd, energy > 0.6);
      }
      if (r < wetP * bias.echoBias + modP) {
        return fxChorus(rnd, bias, true);
      }
      if (r < wetP + modP * 0.3) {
        return fxReverb(bpm, rnd, bias, 0.16, 0.38, [1, 1.5, 2]);
      }
      return fxEq(0.9, 1.05, 1.1);
    }
    case "texture": {
      const r = rnd();
      if (r < modP * 0.55) return fxChorus(rnd, bias, true);
      if (r < modP * 0.55 + wetP * 0.25) {
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
      if (r < modP * 0.5) return fxTremolo(rnd, energy > 0.55);
      if (r < modP * 0.5 + wetP * 0.45) {
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
      if (r < modP * 0.5 + wetP * 0.45 + modP * 0.25) {
        return fxChorus(rnd, bias, false);
      }
      return { ...DEFAULT_TRACK_FX };
    }
    case "perc":
      if (rnd() < wetP * 0.55) {
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
      if (rnd() < modP * 0.25) return fxTremolo(rnd, true);
      return { ...DEFAULT_TRACK_FX };
    case "fx":
    default: {
      const r = rnd();
      if (r < wetP * bias.echoBias) {
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
      if (r < wetP * bias.echoBias + modP * 0.6) {
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
 * locks (key, palette, form, humanize, variation, bpm-sync, reverse, stutter,
 * call–response, lock-pitch). Sample voices stay pinned per section kind so
 * verse/chorus returns stay familiar. Uses sample analysis + ML tags when present.
 * Pass `"auto"` to let the seed pick; omit for engine defaults.
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
}): SequencePlanResult {
  const { bars, beatsPerBar, ppq, bpm, seed, tracks, samples } = opts;
  if (bars < 1 || tracks.length === 0 || samples.length === 0) {
    return { clips: [], tracks: [] };
  }

  const rnd = mulberry32(seed);
  const enriched = withClapCohesion(samples);
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
  const resolvePitchBound = (v: number | GenAuto | undefined): number => {
    if (v === "auto" || v == null || !Number.isFinite(v)) return 12;
    return Math.round(clamp(v, 0, 24));
  };
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
  const chordTimeline = lockPitch
    ? []
    : expandChordTimeline(
        pickProgressionBank(
          paletteFromMix(
            drumsVsTexture,
            rnd,
            opts.palette,
            styleProfile.palette,
          ),
          scale === MINOR_SCALE,
          rnd,
        ),
        bars,
      );
  const sections = planSongForm(bars, rnd, {
    drumsVsTexture,
    energy,
    formStyle,
    formLean: styleProfile.formLean,
  });

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

  // Call–response pairs: lead↔perc, hat↔snare when both present
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
    rankedByRole.set(role, rankSamplesForRole(pool, role));
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

  for (let ti = 0; ti < sortedTracks.length; ti++) {
    const track = sortedTracks[ti]!;
    const role = roles[ti] ?? "perc";
    const ranked = rankedByRole.get(role) ?? pool;
    const samplePool = ranked.slice(
      0,
      Math.min(Math.max(3, Math.ceil(ranked.length * 0.6)), ranked.length),
    );
    if (samplePool.length === 0) continue;

    const motif = buildMotif(role, beatsPerBar, ppq, rnd, groove, musicStyle);
    const motifAlt = buildMotif(role, beatsPerBar, ppq, rnd, groove, musicStyle);
    // Skip empty kit tracks for classical / ambient pattern banks
    if (allowEmptyKit && isDrumRole(role) && motif.length === 0) continue;
    const leadCell =
      !lockPitch && role === "lead"
        ? pickMelodyCell(rnd, drumsVsTexture < 0.4)
        : null;
    const leadCellAlt =
      !lockPitch && role === "lead"
        ? pickMelodyCell(rnd, drumsVsTexture < 0.4)
        : null;

    const humanizeMs =
      (isDrumRole(role)
        ? 6 + energy * 6
        : role === "lead"
          ? 18 + energy * 10
          : 14) * humanize;

    // Stable home sample per section kind (verse↔verse, chorus↔chorus).
    const homeByKind = new Map<SectionKind, number>();
    const kindOccurrence = new Map<SectionKind, number>();
    /** Same sample window when a section kind returns (familiar ear-hook). */
    const loopContentByKey = new Map<
      string,
      { contentOffsetMs: number; loopEnabled: boolean; loopLengthMs?: number }
    >();

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

      const homeIdx = homeSampleIndexForKind(
        section.kind,
        samplePool.length,
        homeByKind,
      );

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
        let sampleIdx = homeIdx;
        const lastBar = b + barStride >= section.bars;
        const allowOrnament =
          variation > 0.6 &&
          samplePool.length > 1 &&
          (lastBar || section.altSample || section.kind === "bridge");
        if (allowOrnament && rnd() < (variation - 0.6) * 0.5) {
          sampleIdx =
            (homeIdx + pickInt(rnd, 1, samplePool.length - 1)) %
            samplePool.length;
        }
        const sample = samplePool[sampleIdx]!;

        if (
          !sectionAllowsRole(role, section, b, energy, rnd)
        ) {
          continue;
        }

        let hits: MotifHit[];
        if (role === "lead" && (leadCell || leadCellAlt)) {
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
        hits = callResponseShift(
          hits,
          ppq,
          beatsPerBar,
          respondTracks.has(ti),
        );

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

          const stutter =
            stutterBaseChance > 0 &&
            (role === "lead" || role === "perc" || role === "hat") &&
            (stutterMode === "on" || section.kind === "chorus") &&
            hit.accent &&
            rnd() < stutterBaseChance;

          const bpmSync = bpmSyncStretch(
            sample,
            bpm,
            role,
            rnd,
            bpmSyncMode,
            lockPitch,
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
          if (lockTempoPow2 && !stutter) {
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
          const factor =
            lengthTick / Math.max(1, naturalTick * bpmLengthFactor);

          const pitchSemitones = lockPitch
            ? 0
            : pickPitchSemitones({
                sample,
                role,
                rootPc,
                scale,
                degreeHint,
                chordTones: role === "chord" ? chord.tones : undefined,
                toneIndex: role === "chord" ? hi : undefined,
                melodyDegree:
                  role === "lead" && leadCell
                    ? (leadCell[hi % leadCell.length]?.degree ?? degreeHint)
                    : undefined,
                section,
                energy,
                rnd,
                maxUp: pitchUpSemitones,
                maxDown: pitchDownSemitones,
              });

          let stretchMode = pickStretchMode({
            sample,
            role,
            lengthFactor: factor,
            pitchSemitones,
            bpmSync,
            energy,
            stutter,
            lockPitch,
            rnd,
          });

          // Pow2 tempo lock: avoid non-grid resample/stretch; tile or leave native.
          if (
            lockTempoPow2 &&
            !stutter &&
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
          // stretching the whole take to fill the clip.
          if (
            !stutter &&
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
