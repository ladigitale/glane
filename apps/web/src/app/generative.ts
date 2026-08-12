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

export type { ExprRole };
export type { SampleMlCues };
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

export type GrooveKind = "straight" | "shuffle" | "half-time";

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
  pitchHz?: number;
  noteName?: string;
  harmonicity?: number;
  centroidHz?: number;
  transientDensity?: number;
  analysisBpm?: number;
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

function pickGroove(rnd: () => number): GrooveKind {
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
  const cls = s.class;
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
): HarmonicPalette {
  if (forced && forced !== "auto") return forced;
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

  const eBoost = (base: number) =>
    clamp(base * (0.75 + energy * 0.5), 0.25, 1.4);

  let units: Unit[];
  if (ambient) {
    units =
      bars <= 8
        ? [
            {
              kind: "intro",
              weight: 2,
              densityMul: eBoost(0.35),
              gainBiasDb: -3,
              evolve: 0.2,
              fillLastBar: false,
              altSample: false,
            },
            {
              kind: "verse",
              weight: 4,
              densityMul: eBoost(0.55),
              gainBiasDb: -1,
              evolve: 0.35,
              fillLastBar: false,
              altSample: true,
            },
            {
              kind: "chorus",
              weight: 3,
              densityMul: eBoost(0.7),
              gainBiasDb: 0.5,
              evolve: 0.4,
              fillLastBar: false,
              altSample: false,
            },
            {
              kind: "outro",
              weight: 2,
              densityMul: eBoost(0.3),
              gainBiasDb: -2.5,
              evolve: 0.5,
              fillLastBar: false,
              altSample: true,
            },
          ]
        : [
            {
              kind: "intro",
              weight: 3,
              densityMul: eBoost(0.3),
              gainBiasDb: -4,
              evolve: 0.15,
              fillLastBar: false,
              altSample: false,
            },
            {
              kind: "verse",
              weight: 5,
              densityMul: eBoost(0.5),
              gainBiasDb: -1.5,
              evolve: 0.3,
              fillLastBar: false,
              altSample: true,
            },
            {
              kind: "bridge",
              weight: 4,
              densityMul: eBoost(0.45),
              gainBiasDb: 0,
              evolve: 0.65,
              fillLastBar: false,
              altSample: true,
            },
            {
              kind: "chorus",
              weight: 4,
              densityMul: eBoost(0.75),
              gainBiasDb: 1,
              evolve: 0.45,
              fillLastBar: true,
              altSample: false,
            },
            {
              kind: "outro",
              weight: 3,
              densityMul: eBoost(0.28),
              gainBiasDb: -3,
              evolve: 0.55,
              fillLastBar: false,
              altSample: true,
            },
          ];
  } else if (bars <= 4) {
    units = [
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.75),
        gainBiasDb: -1,
        evolve: 0.15,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.05),
        gainBiasDb: 1.2,
        evolve: 0.25,
        fillLastBar: true,
        altSample: false,
      },
    ];
  } else if (bars <= 8) {
    units = [
      {
        kind: "intro",
        weight: 1,
        densityMul: eBoost(0.45),
        gainBiasDb: -3,
        evolve: 0.1,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.8),
        gainBiasDb: -0.5,
        evolve: 0.2,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.1),
        gainBiasDb: 1.5,
        evolve: 0.3,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 1,
        densityMul: eBoost(0.85),
        gainBiasDb: 0,
        evolve: 0.35,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 2,
        densityMul: eBoost(1.15),
        gainBiasDb: 1.8,
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
        densityMul: eBoost(0.4),
        gainBiasDb: -3.5,
        evolve: 0.1,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.78),
        gainBiasDb: -0.8,
        evolve: 0.18,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.95),
        gainBiasDb: 0.4,
        evolve: 0.35,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.15),
        gainBiasDb: 1.6,
        evolve: 0.28,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 2,
        densityMul: eBoost(0.82),
        gainBiasDb: -0.3,
        evolve: 0.4,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.2),
        gainBiasDb: 2,
        evolve: 0.45,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "outro",
        weight: 2,
        densityMul: eBoost(0.55),
        gainBiasDb: -2,
        evolve: 0.5,
        fillLastBar: false,
        altSample: true,
      },
    ];
  } else {
    units = [
      {
        kind: "intro",
        weight: 2,
        densityMul: eBoost(0.35),
        gainBiasDb: -4,
        evolve: 0.08,
        fillLastBar: false,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.75),
        gainBiasDb: -1,
        evolve: 0.15,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "prechorus",
        weight: 2,
        densityMul: eBoost(0.95),
        gainBiasDb: 0.5,
        evolve: 0.32,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.12),
        gainBiasDb: 1.5,
        evolve: 0.25,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "verse",
        weight: 4,
        densityMul: eBoost(0.8),
        gainBiasDb: -0.5,
        evolve: 0.38,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.18),
        gainBiasDb: 1.8,
        evolve: 0.4,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "bridge",
        weight: 4,
        densityMul: eBoost(0.7),
        gainBiasDb: 0.2,
        evolve: 0.7,
        fillLastBar: true,
        altSample: true,
      },
      {
        kind: "chorus",
        weight: 4,
        densityMul: eBoost(1.25),
        gainBiasDb: 2.2,
        evolve: 0.5,
        fillLastBar: true,
        altSample: false,
      },
      {
        kind: "outro",
        weight: 2,
        densityMul: eBoost(0.45),
        gainBiasDb: -2.5,
        evolve: 0.55,
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
): MotifHit[] {
  const tpb = beatsPerBar * ppq;
  const hits: MotifHit[] = [];
  const push = (tickInBar: number, gainDb: number, accent: boolean) => {
    const t = applyGroove(tickInBar, groove, beatsPerBar, ppq);
    hits.push({ tickInBar: t, gainDb, accent });
  };

  if (role === "kick") {
    const style = rnd();
    if (groove === "half-time") {
      push(0, 1, true);
      if (beatsPerBar >= 4 && rnd() < 0.5) push(2 * ppq, 0.2, false);
    } else if (style < 0.35) {
      push(0, 0.8, true);
      if (beatsPerBar >= 3) push(2 * ppq, 0.4, true);
    } else if (style < 0.65) {
      for (let b = 0; b < beatsPerBar; b++)
        push(b * ppq, b === 0 ? 1 : 0.2, b % 2 === 0);
    } else {
      push(0, 1, true);
      push(Math.floor(1.5 * ppq), -0.5, false);
      if (beatsPerBar >= 4) {
        push(2 * ppq, 0.3, true);
        push(Math.floor(3.5 * ppq), -0.8, false);
      }
    }
  } else if (role === "snare") {
    if (groove === "half-time" && beatsPerBar >= 4) {
      push(2 * ppq, 0.7, true);
      if (rnd() < 0.3) push(Math.floor(3.5 * ppq), -2, false);
    } else if (beatsPerBar >= 4) {
      push(ppq, 0.6, true);
      push(3 * ppq, 0.8, true);
      if (rnd() < 0.4) push(Math.floor(2.5 * ppq), -2.5, false);
    } else {
      push(Math.floor(beatsPerBar / 2) * ppq, 0.5, true);
    }
  } else if (role === "hat") {
    const step =
      groove === "half-time"
        ? ppq
        : rnd() < 0.55
          ? Math.floor(ppq / 2)
          : Math.floor(ppq / 4);
    for (let t = 0; t < tpb; t += Math.max(1, step)) {
      const onBeat = t % ppq === 0;
      push(t, onBeat ? -1.5 : -3.5, onBeat);
    }
  } else if (role === "perc") {
    const offs = [0, Math.floor(1.5 * ppq), 2 * ppq, Math.floor(3.25 * ppq)];
    for (const o of offs) {
      if (o < tpb && rnd() < 0.7) push(o, (rnd() * 2 - 1) * 2, o === 0);
    }
  } else if (role === "bass") {
    push(0, 0.5, true);
    if (beatsPerBar >= 3 && rnd() < 0.7) push(2 * ppq, -0.5, false);
    if (rnd() < 0.35) push(Math.floor(1.5 * ppq), -1.5, false);
  } else if (role === "chord") {
    push(0, 0, true);
    if (rnd() < 0.3) push(2 * ppq, -1, false);
  } else if (role === "lead") {
    // Motif skeleton; melodic cell may replace in planSequence
    const steps =
      rnd() < 0.5
        ? [0, ppq, 2 * ppq, 3 * ppq]
        : [0, Math.floor(1.5 * ppq), 2 * ppq, Math.floor(3.5 * ppq)];
    for (const o of steps) {
      if (o < tpb && rnd() < 0.75) push(o, (rnd() * 2 - 1) * 1.5, o === 0);
    }
  } else if (role === "loop") {
    push(0, 0, true);
  } else if (role === "texture") {
    push(0, -1, true);
  } else {
    if (rnd() < 0.6) push(0, -2, false);
    if (rnd() < 0.4) push(Math.floor(tpb / 2), -3, false);
  }

  if (hits.length === 0) push(0, 0, true);
  hits.sort((a, b) => a.tickInBar - b.tickInBar);
  return hits;
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
  } = opts;
  const tpb = beatsPerBar * ppq;
  const last = barInSection === section.bars - 1;
  let hits = motif.map((h) => ({ ...h }));
  const dens = section.densityMul * density;

  hits = hits.filter((h) => {
    if (h.accent && dens >= 0.55) return true;
    return rnd() < dens;
  });

  if (section.kind === "intro") {
    if (role === "hat")
      hits = hits.filter((h) => h.tickInBar % ppq === 0 || rnd() < 0.25);
    if (role === "snare" && barInSection === 0) hits = [];
    if (role === "lead" || role === "chord") {
      hits = hits.filter((h) => h.accent || rnd() < 0.35);
    }
  }

  if (section.kind === "prechorus") {
    hits = hits.map((h) => ({
      ...h,
      gainDb: h.gainDb + 0.4 * (barInSection + 1) * energy,
    }));
  }

  if (section.kind === "chorus") {
    if (role === "hat" && rnd() < 0.4 + energy * 0.4) {
      const step = Math.floor(ppq / 4);
      for (let t = 0; t < tpb; t += step) {
        if (!hits.some((h) => Math.abs(h.tickInBar - t) < 2)) {
          hits.push({ tickInBar: t, gainDb: -4, accent: false });
        }
      }
    }
    if (role === "kick" && section.evolve > 0.35 && rnd() < 0.35 + energy * 0.2) {
      hits.push({
        tickInBar: Math.floor(3.5 * ppq) % tpb,
        gainDb: -1,
        accent: false,
      });
    }
  }

  if (section.kind === "bridge") {
    if (role === "kick" || role === "snare") {
      hits = hits.filter((h) => h.accent || rnd() < 0.35);
    }
    if (role === "lead" || role === "chord") {
      if (rnd() < 0.5) {
        hits.push({
          tickInBar: Math.floor(1.5 * ppq) % tpb,
          gainDb: -1,
          accent: false,
        });
      }
    }
  }

  if (section.kind === "outro") {
    const keep = 1 - (barInSection / Math.max(1, section.bars)) * 0.7;
    hits = hits.filter((h) => h.accent || rnd() < keep);
  }

  if (last && section.fillLastBar && isDrumRole(role) && energy > 0.35) {
    const fillStep = role === "hat" ? Math.floor(ppq / 4) : Math.floor(ppq / 2);
    const from = Math.floor(tpb * 0.5);
    for (let t = from; t < tpb; t += Math.max(1, fillStep)) {
      if (rnd() < 0.45 + section.evolve * 0.3 + energy * 0.15) {
        hits.push({ tickInBar: t, gainDb: -1.5 + rnd(), accent: false });
      }
    }
  }

  if (section.evolve > 0.2 && rnd() < section.evolve * density) {
    if (rnd() < 0.5 && hits.length > 1) {
      const i = pickInt(rnd, 0, hits.length - 1);
      if (!hits[i]!.accent) hits.splice(i, 1);
    } else if (isDrumRole(role)) {
      hits.push({
        tickInBar: Math.floor(rnd() * tpb),
        gainDb: -3,
        accent: false,
      });
    }
  }

  if (
    hits.length === 0 &&
    (role === "kick" || role === "bass" || role === "loop" || role === "texture")
  ) {
    hits.push({ tickInBar: 0, gainDb: section.gainBiasDb, accent: true });
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
  }
  if (role === "bass" && (sampleSourceMidi(s) ?? 60) < 52) score -= 1;
  if (role === "chord" && (s.harmonicity ?? 0) > 0.35) score -= 1;
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
  } = opts;
  const source = sampleSourceMidi(sample);

  if (isDrumRole(role) || role === "fx") {
    if (rnd() > 0.2 + energy * 0.15) return 0;
    const span =
      section.kind === "bridge" || section.kind === "chorus" ? 7 : 4;
    return pickInt(rnd, -span, span);
  }

  if (role === "texture" || role === "loop") {
    if (!isMelodicClass(sample.class, sample.harmonicity)) {
      return rnd() < 0.25 + energy * 0.2 ? pickInt(rnd, -7, 7) : 0;
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
  let semis = clamp(Math.round(targetMidi - fromMidi), -12, 12);

  if (semis === 0 && section.evolve > 0.3 && rnd() < section.evolve * energy) {
    const step = scale[pickInt(rnd, 1, scale.length - 1)] ?? 2;
    semis = clamp(rnd() < 0.5 ? step : -step, -12, 12);
  }
  return semis;
}

/** Stretch toward project BPM when sample has analysisBpm. */
function bpmSyncStretch(
  sample: SequenceSampleIn,
  projectBpm: number,
  role: ExprRole,
  rnd: () => number,
  mode: GenTriState = "auto",
): { stretchMode: StretchMode; lengthFactor: number } | null {
  if (mode === "off") return null;
  const src = sample.analysisBpm;
  if (src == null || src < 40 || src > 240) return null;
  const ratio = projectBpm / src;
  if (Math.abs(ratio - 1) < 0.04) return null;
  if (mode === "on") {
    return {
      stretchMode: Math.abs(ratio - 1) > 0.12 ? "preserve-pitch" : "resample",
      lengthFactor: 1 / ratio,
    };
  }
  if (isDrumRole(role) && Math.abs(ratio - 1) > 0.25 && rnd() < 0.5) {
    // Drums: prefer one-shot at native feel unless close
    return null;
  }
  if (role === "loop" || role === "texture" || role === "chord") {
    return {
      stretchMode: Math.abs(ratio - 1) > 0.12 ? "preserve-pitch" : "resample",
      lengthFactor: 1 / ratio,
    };
  }
  if (isMelodicRole(role)) {
    return {
      stretchMode: "preserve-pitch",
      lengthFactor: 1 / ratio,
    };
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
    rnd,
  } = opts;
  if (stutter) return rnd() < 0.6 ? "copy" : "resample";
  if (bpmSync) return bpmSync.stretchMode;

  const loopish = (sample.loopScore ?? 0) > 0.45;
  if (Math.abs(pitchSemitones) >= 1) {
    if (lengthFactor > 1.15 && loopish)
      return rnd() < 0.6 ? "copy" : "preserve-pitch";
    if (Math.abs(lengthFactor - 1) > 0.12) return "preserve-pitch";
    return "off";
  }
  if (isDrumRole(role)) {
    if (rnd() < 0.08 + energy * 0.1 && lengthFactor < 0.85) return "resample";
    return "off";
  }
  if (loopish && lengthFactor > 1.2) {
    return rnd() < 0.55 ? "copy" : "preserve-pitch";
  }
  if (Math.abs(lengthFactor - 1) > 0.18) {
    if (role === "texture" || role === "loop") {
      return rnd() < 0.7 ? "preserve-pitch" : "copy";
    }
    return rnd() < 0.35 + energy * 0.15 ? "resample" : "preserve-pitch";
  }
  if (rnd() < 0.08 + energy * 0.06) return "resample";
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

function pickTrackMix(
  role: ExprRole,
  trackIndex: number,
  trackCount: number,
  energy: number,
  bpm: number,
  rnd: () => number,
): Omit<SequenceTrackPlan, "trackId"> {
  const spread =
    trackCount <= 1 ? 0 : ((trackIndex / (trackCount - 1)) * 2 - 1) * 0.55;
  const panJitter = (rnd() - 0.5) * 0.15;
  const pan = clamp(spread + panJitter, -1, 1);
  const eGain = (energy - 0.5) * 2;

  switch (role) {
    case "kick":
      return {
        gainDb: 0.5 + rnd() * 1.5 + eGain,
        pan: clamp(pan * 0.15, -0.2, 0.2),
        fx: normalizeTrackFx({
          type: "eq",
          low: 1.15 + rnd() * 0.25,
          mid: 0.9 + rnd() * 0.1,
          high: 0.75 + rnd() * 0.15,
        }),
      };
    case "snare":
      return {
        gainDb: -1 + rnd() * 1.5 + eGain * 0.5,
        pan: clamp(pan * 0.4, -0.35, 0.35),
        fx:
          rnd() < 0.55
            ? normalizeTrackFx({
                type: "reverb",
                mix: 0.18 + rnd() * 0.15,
                decay: bpmSyncedReverbDecay(bpm, rnd, [0.75, 1, 1.5]),
              })
            : normalizeTrackFx({
                type: "eq",
                low: 0.85,
                mid: 1.1,
                high: 1.2,
              }),
      };
    case "hat":
      return {
        gainDb: -4 + rnd() * 2,
        pan: clamp(pan, -0.7, 0.7),
        fx: normalizeTrackFx({
          type: "eq",
          low: 0.55 + rnd() * 0.2,
          mid: 0.95,
          high: 1.2 + rnd() * 0.3,
        }),
      };
    case "bass":
      return {
        gainDb: rnd() * 1.5 + eGain * 0.5,
        pan: clamp(pan * 0.2, -0.25, 0.25),
        fx: normalizeTrackFx({
          type: "eq",
          low: 1.2 + rnd() * 0.3,
          mid: 0.95,
          high: 0.7 + rnd() * 0.2,
        }),
      };
    case "chord":
      return {
        gainDb: -2 + rnd() * 1.5,
        pan: clamp(pan, -0.55, 0.55),
        fx: normalizeTrackFx({
          type: "reverb",
          mix: 0.28 + rnd() * 0.2,
          decay: bpmSyncedReverbDecay(bpm, rnd, [1.5, 2, 3]),
        }),
      };
    case "lead":
      return {
        gainDb: -1 + rnd() * 2 + eGain * 0.4,
        pan: clamp(pan, -0.6, 0.6),
        fx:
          rnd() < 0.6
            ? normalizeTrackFx({
                type: "echo",
                mix: 0.22 + rnd() * 0.18,
                delayBeats: pickBeatFrac(rnd, [0.5, 0.75, 1, 1.5]),
                feedback: 0.25 + rnd() * 0.25,
              })
            : normalizeTrackFx({
                type: "reverb",
                mix: 0.2 + rnd() * 0.2,
                decay: bpmSyncedReverbDecay(bpm, rnd, [1, 1.5, 2]),
              }),
      };
    case "texture":
      return {
        gainDb: -5 + rnd() * 2.5 - (1 - energy),
        pan: clamp(pan, -0.8, 0.8),
        fx: normalizeTrackFx({
          type: "reverb",
          mix: 0.4 + rnd() * 0.25,
          decay: bpmSyncedReverbDecay(bpm, rnd, [3, 4, 6]),
        }),
      };
    case "loop":
      return {
        gainDb: -2.5 + rnd() * 2,
        pan: clamp(pan * 0.7, -0.5, 0.5),
        fx:
          rnd() < 0.45
            ? normalizeTrackFx({
                type: "reverb",
                mix: 0.2 + rnd() * 0.15,
                decay: bpmSyncedReverbDecay(bpm, rnd, [1, 1.5, 2.5]),
              })
            : { ...DEFAULT_TRACK_FX },
      };
    case "perc":
      return {
        gainDb: -2 + rnd() * 2 + eGain * 0.3,
        pan: clamp(pan, -0.75, 0.75),
        fx:
          rnd() < 0.35
            ? normalizeTrackFx({
                type: "echo",
                mix: 0.15 + rnd() * 0.15,
                delayBeats: pickBeatFrac(rnd, [0.25, 0.5, 0.75]),
                feedback: 0.2 + rnd() * 0.2,
              })
            : { ...DEFAULT_TRACK_FX },
      };
    case "fx":
    default:
      return {
        gainDb: -3 + rnd() * 2.5,
        pan: clamp(pan, -0.85, 0.85),
        fx:
          rnd() < 0.5
            ? normalizeTrackFx({
                type: "echo",
                mix: 0.3 + rnd() * 0.25,
                delayBeats: pickBeatFrac(rnd, [1, 1.5, 2]),
                feedback: 0.3 + rnd() * 0.35,
              })
            : normalizeTrackFx({
                type: "reverb",
                mix: 0.35 + rnd() * 0.3,
                decay: bpmSyncedReverbDecay(bpm, rnd, [2, 3, 5]),
              }),
      };
  }
}

/**
 * Plan a full multi-track sequence over `bars`, drawing from the library.
 * Controls: seed + density/energy/mix/groove; advanced locks (key, palette,
 * form, humanize, variation, bpm-sync, reverse, stutter, call–response).
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
  /** Motif evolve / sample rotate / reverse·stutter intensity (0–1), or `"auto"`. */
  variation?: number | GenAuto;
  bpmSync?: GenTriState;
  reverse?: GenTriState;
  stutter?: GenTriState;
  callResponse?: GenTriState;
}): SequencePlanResult {
  const { bars, beatsPerBar, ppq, bpm, seed, tracks, samples } = opts;
  if (bars < 1 || tracks.length === 0 || samples.length === 0) {
    return { clips: [], tracks: [] };
  }

  const rnd = mulberry32(seed);
  const density = resolveSlider(opts.density, rnd, 0.35, 1.5, 1);
  const energy = resolveSlider(opts.energy, rnd, 0, 1, 0.55);
  const drumsVsTexture = resolveSlider(
    opts.drumsVsTexture,
    rnd,
    0,
    1,
    0.55,
  );
  const groove: GrooveKind =
    opts.groove === "auto"
      ? pickGroove(rnd)
      : (opts.groove ?? "straight");
  const humanize =
    opts.humanize === undefined
      ? 1
      : resolveSlider(opts.humanize, rnd, 0, 1, 1);
  const variation =
    opts.variation === undefined
      ? 0.55
      : resolveSlider(opts.variation, rnd, 0, 1, 0.55);
  const scaleMode: GenScaleMode = opts.scaleMode ?? "auto";
  const formStyle: GenFormStyle = opts.formStyle ?? "auto";
  const bpmSyncMode: GenTriState = opts.bpmSync ?? "auto";
  const reverseMode: GenTriState = opts.reverse ?? "auto";
  const stutterMode: GenTriState = opts.stutter ?? "auto";
  const callResponseMode: GenTriState = opts.callResponse ?? "auto";

  const ticksPerBar = beatsPerBar * ppq;
  const seqEnd = bars * ticksPerBar;
  const enriched = withClapCohesion(samples);
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
    return a.id.localeCompare(b.id);
  });

  const rootPc =
    opts.keyRootPc == null || opts.keyRootPc === "auto"
      ? inferKeyRootPc(pool)
      : ((Math.round(opts.keyRootPc) % 12) + 12) % 12;
  const scale = pickScale(pool, rootPc, rnd, scaleMode);
  const minor = scale === MINOR_SCALE;
  const palette = paletteFromMix(drumsVsTexture, rnd, opts.palette);
  const progression = pickProgressionBank(palette, minor, rnd);
  const chordTimeline = expandChordTimeline(progression, bars);
  const sections = planSongForm(bars, rnd, {
    drumsVsTexture,
    energy,
    formStyle,
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
    const mix = pickTrackMix(role, ti, sortedTracks.length, energy, bpm, rnd);
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

    const motif = buildMotif(role, beatsPerBar, ppq, rnd, groove);
    const motifAlt = buildMotif(role, beatsPerBar, ppq, rnd, groove);
    const leadCell =
      role === "lead" ? pickMelodyCell(rnd, drumsVsTexture < 0.4) : null;
    const leadCellAlt =
      role === "lead" ? pickMelodyCell(rnd, drumsVsTexture < 0.4) : null;

    const humanizeMs =
      (isDrumRole(role)
        ? 6 + energy * 6
        : role === "lead"
          ? 18 + energy * 10
          : 14) * humanize;

    let sampleCursor = 0;
    const rotateEvery = Math.max(
      1,
      2 - Math.floor(energy * 1.5 * (0.5 + variation)),
    );

    for (const section of sections) {
      const baseMotif =
        section.kind === "bridge" || section.kind === "outro" ? motifAlt : motif;

      const barStride =
        role === "texture"
          ? Math.max(1, Math.min(section.bars, 2 + pickInt(rnd, 0, 1)))
          : role === "loop"
            ? Math.max(1, Math.min(2, section.bars))
            : role === "chord"
              ? section.kind === "chorus"
                ? 2
                : 1
              : 1;

      for (let b = 0; b < section.bars; b += barStride) {
        const absBar = section.startBar + b;
        const barTick = absBar * ticksPerBar;
        const chord = chordTimeline[absBar] ?? {
          degree: 0,
          tones: [0, 2, 4] as const,
        };
        const degreeHint = chord.degree;

        // Rotate samples mid-song
        if (b % rotateEvery === 0 || section.altSample) {
          sampleCursor = (sampleCursor + 1) % samplePool.length;
        }
        if (
          section.altSample &&
          samplePool.length > 1 &&
          rnd() < 0.4 + variation * 0.55
        ) {
          sampleCursor =
            (sampleCursor + pickInt(rnd, 1, samplePool.length - 1)) %
            samplePool.length;
        }
        const sample = samplePool[sampleCursor]!;

        if (
          section.kind === "intro" &&
          (role === "snare" || role === "lead") &&
          b === 0
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
        } else {
          hits = evolveMotifHits(baseMotif, {
            role,
            section: {
              ...section,
              evolve: section.evolve * (0.45 + variation * 0.9),
            },
            barInSection: b,
            beatsPerBar,
            ppq,
            density,
            energy,
            rnd,
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
          const factor =
            lengthTick / Math.max(1, naturalTick * bpmLengthFactor);

          const melodyDegree =
            role === "lead" && leadCell
              ? (leadCell[hi % leadCell.length]?.degree ?? degreeHint)
              : undefined;

          const pitchSemitones = pickPitchSemitones({
            sample,
            role,
            rootPc,
            scale,
            degreeHint,
            chordTones: role === "chord" ? chord.tones : undefined,
            toneIndex: role === "chord" ? hi : undefined,
            melodyDegree,
            section,
            energy,
            rnd,
          });

          const stretchMode = pickStretchMode({
            sample,
            role,
            lengthFactor: factor,
            pitchSemitones,
            bpmSync,
            energy,
            stutter,
            rnd,
          });

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

          const loopEnabled =
            stutter ||
            stretchMode === "copy" ||
            ((sample.loopScore ?? 0) > 0.5 &&
              (factor > 1.05 || role === "texture" || role === "loop"));

          let contentOffsetMs = 0;
          if (
            stretchMode === "off" &&
            !loopEnabled &&
            sample.durationMs > lengthMs + 40 &&
            !isDrumRole(role)
          ) {
            const window = Math.max(0, sample.durationMs - lengthMs);
            contentOffsetMs = Math.round(
              rnd() * window * (0.35 + energy * 0.5) * (0.4 + variation * 0.8),
            );
          }

          const reverse =
            reverseBaseChance > 0 &&
            (role === "texture" || role === "fx" || role === "lead") &&
            (reverseMode === "on" ||
              section.kind === "bridge" ||
              section.kind === "outro") &&
            rnd() < reverseBaseChance;

          let gainDb = hit.gainDb + section.gainBiasDb + (energy - 0.5) * 1.5;
          if (section.kind === "chorus") {
            gainDb += Math.min(1.2, b * 0.08) * energy;
          }
          if (section.kind === "outro") {
            gainDb -= (b / Math.max(1, section.bars)) * 3;
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
