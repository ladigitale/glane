/**
 * Genre / pattern banks for sequence generation.
 * Each style drives drum motifs, groove lean, form & harmonic palette bias.
 */

import type { HarmonicPalette } from "./generative-refs";
import {
  MUSIC_STYLE_IDS,
  STYLE_GENERATOR_PROFILES,
  type GenMusicStyleChoice,
  type MusicStyleId,
} from "@glane/composer";
export type { MusicStyleId, GenMusicStyleChoice } from "@glane/composer";
export { MUSIC_STYLE_IDS, STYLE_GENERATOR_PROFILES } from "@glane/composer";

const G = STYLE_GENERATOR_PROFILES;

export type GrooveKind = "straight" | "shuffle" | "half-time";

/** Soft BPM window for listening / testing a style (project BPM stays free). */
export type StyleBpmHint = {
  min: number;
  ideal: number;
  max: number;
};

/** Soft bar-count window for form + arrangement to read clearly. */
export type StyleBarsHint = {
  min: number;
  ideal: number;
  max: number;
};

export type MusicStyleProfile = {
  id: MusicStyleId;
  groove: GrooveKind;
  /** Prefer song / ambient form when formStyle is auto. */
  formLean: "song" | "ambient";
  palette: HarmonicPalette;
  scaleBias?: "major" | "minor";
  /** Soft bias applied when those sliders are `"auto"`. */
  densityCenter?: number;
  energyCenter?: number;
  drumsCenter?: number;
  humanizeCenter?: number;
  /** Recommended project tempo for this style (hints only). */
  bpmHint: StyleBpmHint;
  /** Recommended sequence length in bars (hints only). */
  barsHint: StyleBarsHint;
};

type MotifSpec = { beat: number; gainDb?: number; accent?: boolean };
export type MotifHit = { tickInBar: number; gainDb: number; accent: boolean };

export const MUSIC_STYLE_PROFILES: Record<MusicStyleId, MusicStyleProfile> = {
  rock: {
    id: "rock",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.rock.densityCenter,
    energyCenter: G.rock.energyCenter,
    drumsCenter: G.rock.drumsCenter,
    humanizeCenter: G.rock.humanizeCenter,
    bpmHint: { min: 100, ideal: 120, max: 140 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  pop: {
    id: "pop",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.pop.densityCenter,
    energyCenter: G.pop.energyCenter,
    drumsCenter: G.pop.drumsCenter,
    humanizeCenter: G.pop.humanizeCenter,
    bpmHint: { min: 100, ideal: 118, max: 130 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  reggae: {
    id: "reggae",
    groove: "straight",
    formLean: "song",
    palette: "modal",
    scaleBias: "minor",
    densityCenter: G.reggae.densityCenter,
    energyCenter: G.reggae.energyCenter,
    drumsCenter: G.reggae.drumsCenter,
    humanizeCenter: G.reggae.humanizeCenter,
    bpmHint: { min: 70, ideal: 85, max: 100 },
    barsHint: { min: 32, ideal: 64, max: 96 },
  },
  dub: {
    id: "dub",
    groove: "half-time",
    formLean: "ambient",
    palette: "modal",
    scaleBias: "minor",
    densityCenter: G.dub.densityCenter,
    energyCenter: G.dub.energyCenter,
    drumsCenter: G.dub.drumsCenter,
    humanizeCenter: G.dub.humanizeCenter,
    bpmHint: { min: 60, ideal: 75, max: 90 },
    barsHint: { min: 48, ideal: 96, max: 128 },
  },
  hiphop: {
    id: "hiphop",
    groove: "straight",
    formLean: "song",
    palette: "mixed",
    scaleBias: "minor",
    densityCenter: G.hiphop.densityCenter,
    energyCenter: G.hiphop.energyCenter,
    drumsCenter: G.hiphop.drumsCenter,
    humanizeCenter: G.hiphop.humanizeCenter,
    bpmHint: { min: 80, ideal: 92, max: 105 },
    barsHint: { min: 32, ideal: 64, max: 96 },
  },
  triphop: {
    id: "triphop",
    groove: "half-time",
    formLean: "ambient",
    palette: "ambient",
    scaleBias: "minor",
    densityCenter: G.triphop.densityCenter,
    energyCenter: G.triphop.energyCenter,
    drumsCenter: G.triphop.drumsCenter,
    humanizeCenter: G.triphop.humanizeCenter,
    bpmHint: { min: 70, ideal: 85, max: 100 },
    barsHint: { min: 48, ideal: 96, max: 128 },
  },
  dnb: {
    id: "dnb",
    groove: "straight",
    formLean: "song",
    palette: "mixed",
    scaleBias: "minor",
    densityCenter: G.dnb.densityCenter,
    energyCenter: G.dnb.energyCenter,
    drumsCenter: G.dnb.drumsCenter,
    humanizeCenter: G.dnb.humanizeCenter,
    bpmHint: { min: 160, ideal: 172, max: 180 },
    barsHint: { min: 32, ideal: 96, max: 128 },
  },
  breakbeat: {
    id: "breakbeat",
    groove: "straight",
    formLean: "song",
    palette: "mixed",
    densityCenter: G.breakbeat.densityCenter,
    energyCenter: G.breakbeat.energyCenter,
    drumsCenter: G.breakbeat.drumsCenter,
    humanizeCenter: G.breakbeat.humanizeCenter,
    bpmHint: { min: 125, ideal: 135, max: 150 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  techno: {
    id: "techno",
    groove: "straight",
    formLean: "song",
    palette: "modal",
    scaleBias: "minor",
    densityCenter: G.techno.densityCenter,
    energyCenter: G.techno.energyCenter,
    drumsCenter: G.techno.drumsCenter,
    humanizeCenter: G.techno.humanizeCenter,
    bpmHint: { min: 120, ideal: 130, max: 140 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  house: {
    id: "house",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.house.densityCenter,
    energyCenter: G.house.energyCenter,
    drumsCenter: G.house.drumsCenter,
    humanizeCenter: G.house.humanizeCenter,
    bpmHint: { min: 118, ideal: 124, max: 130 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  disco: {
    id: "disco",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.disco.densityCenter,
    energyCenter: G.disco.energyCenter,
    drumsCenter: G.disco.drumsCenter,
    humanizeCenter: G.disco.humanizeCenter,
    bpmHint: { min: 110, ideal: 120, max: 128 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  funk: {
    id: "funk",
    groove: "straight",
    formLean: "song",
    palette: "mixed",
    densityCenter: G.funk.densityCenter,
    energyCenter: G.funk.energyCenter,
    drumsCenter: G.funk.drumsCenter,
    humanizeCenter: G.funk.humanizeCenter,
    bpmHint: { min: 95, ideal: 108, max: 120 },
    barsHint: { min: 32, ideal: 64, max: 96 },
  },
  jazz: {
    id: "jazz",
    groove: "shuffle",
    formLean: "song",
    palette: "jazz",
    densityCenter: G.jazz.densityCenter,
    energyCenter: G.jazz.energyCenter,
    drumsCenter: G.jazz.drumsCenter,
    humanizeCenter: G.jazz.humanizeCenter,
    bpmHint: { min: 90, ideal: 120, max: 160 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  blues: {
    id: "blues",
    groove: "shuffle",
    formLean: "song",
    palette: "modal",
    scaleBias: "minor",
    densityCenter: G.blues.densityCenter,
    energyCenter: G.blues.energyCenter,
    drumsCenter: G.blues.drumsCenter,
    humanizeCenter: G.blues.humanizeCenter,
    bpmHint: { min: 70, ideal: 90, max: 110 },
    barsHint: { min: 24, ideal: 48, max: 96 },
  },
  latin: {
    id: "latin",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.latin.densityCenter,
    energyCenter: G.latin.energyCenter,
    drumsCenter: G.latin.drumsCenter,
    humanizeCenter: G.latin.humanizeCenter,
    bpmHint: { min: 95, ideal: 110, max: 130 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  afrobeat: {
    id: "afrobeat",
    groove: "straight",
    formLean: "song",
    palette: "modal",
    densityCenter: G.afrobeat.densityCenter,
    energyCenter: G.afrobeat.energyCenter,
    drumsCenter: G.afrobeat.drumsCenter,
    humanizeCenter: G.afrobeat.humanizeCenter,
    bpmHint: { min: 100, ideal: 115, max: 130 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  classical: {
    id: "classical",
    groove: "straight",
    formLean: "song",
    palette: "jazz",
    scaleBias: "major",
    densityCenter: G.classical.densityCenter,
    energyCenter: G.classical.energyCenter,
    drumsCenter: G.classical.drumsCenter,
    humanizeCenter: G.classical.humanizeCenter,
    bpmHint: { min: 60, ideal: 90, max: 120 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  ambient: {
    id: "ambient",
    groove: "straight",
    formLean: "ambient",
    palette: "ambient",
    densityCenter: G.ambient.densityCenter,
    energyCenter: G.ambient.energyCenter,
    drumsCenter: G.ambient.drumsCenter,
    humanizeCenter: G.ambient.humanizeCenter,
    bpmHint: { min: 50, ideal: 70, max: 90 },
    barsHint: { min: 64, ideal: 96, max: 160 },
  },
  folk: {
    id: "folk",
    groove: "straight",
    formLean: "song",
    palette: "modal",
    scaleBias: "major",
    densityCenter: G.folk.densityCenter,
    energyCenter: G.folk.energyCenter,
    drumsCenter: G.folk.drumsCenter,
    humanizeCenter: G.folk.humanizeCenter,
    bpmHint: { min: 80, ideal: 100, max: 120 },
    barsHint: { min: 32, ideal: 64, max: 96 },
  },
  metal: {
    id: "metal",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "minor",
    densityCenter: G.metal.densityCenter,
    energyCenter: G.metal.energyCenter,
    drumsCenter: G.metal.drumsCenter,
    humanizeCenter: G.metal.humanizeCenter,
    bpmHint: { min: 120, ideal: 160, max: 200 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  garage: {
    id: "garage",
    groove: "shuffle",
    formLean: "song",
    palette: "mixed",
    scaleBias: "minor",
    densityCenter: G.garage.densityCenter,
    energyCenter: G.garage.energyCenter,
    drumsCenter: G.garage.drumsCenter,
    humanizeCenter: G.garage.humanizeCenter,
    bpmHint: { min: 128, ideal: 135, max: 140 },
    barsHint: { min: 32, ideal: 64, max: 128 },
  },
  punk: {
    id: "punk",
    groove: "straight",
    formLean: "song",
    palette: "pop",
    scaleBias: "major",
    densityCenter: G.punk.densityCenter,
    energyCenter: G.punk.energyCenter,
    drumsCenter: G.punk.drumsCenter,
    humanizeCenter: G.punk.humanizeCenter,
    bpmHint: { min: 140, ideal: 170, max: 200 },
    barsHint: { min: 16, ideal: 48, max: 64 },
  },
};

export type StyleTempoBarsFit = {
  style: MusicStyleId;
  bpmOk: boolean;
  barsOk: boolean;
  bpm: number;
  bars: number;
  bpmHint: StyleBpmHint;
  barsHint: StyleBarsHint;
};

export function styleTempoBarsFit(
  style: MusicStyleId,
  bpm: number,
  bars: number,
): StyleTempoBarsFit {
  const p = MUSIC_STYLE_PROFILES[style];
  return {
    style,
    bpm,
    bars,
    bpmHint: p.bpmHint,
    barsHint: p.barsHint,
    bpmOk: bpm >= p.bpmHint.min && bpm <= p.bpmHint.max,
    barsOk: bars >= p.barsHint.min && bars <= p.barsHint.max,
  };
}

/** Ideal BPM + bars to apply when the user accepts style suggestions. */
export function styleSuggestedTempoBars(style: MusicStyleId): {
  bpm: number;
  bars: number;
} {
  const p = MUSIC_STYLE_PROFILES[style];
  return { bpm: p.bpmHint.ideal, bars: p.barsHint.ideal };
}

/** Approximate wall-clock length for 4/4 at given BPM and bar count. */
export function approxDurationSec(bpm: number, bars: number): number {
  return (bars * 4 * 60) / Math.max(1, bpm);
}

type RoleMotifs = {
  kick: MotifSpec[];
  snare: MotifSpec[];
  hat: MotifSpec[];
  perc?: MotifSpec[];
  bass?: MotifSpec[];
  chord?: MotifSpec[];
  lead?: MotifSpec[];
};

/** Beat-grid patterns per style (beat = quarter-note index in bar). */
const STYLE_MOTIFS: Record<MusicStyleId, RoleMotifs> = {
  rock: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 2, gainDb: 0.4, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: 0.6, accent: true },
      { beat: 3, gainDb: 0.8, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -1.5, accent: true },
      { beat: 0.5, gainDb: -3.5 },
      { beat: 1, gainDb: -1.5, accent: true },
      { beat: 1.5, gainDb: -3.5 },
      { beat: 2, gainDb: -1.5, accent: true },
      { beat: 2.5, gainDb: -3.5 },
      { beat: 3, gainDb: -1.5, accent: true },
      { beat: 3.5, gainDb: -3.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    chord: [{ beat: 0, accent: true }, { beat: 2, gainDb: -1 }],
  },
  pop: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 2, gainDb: 0.3, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: 0.55, accent: true },
      { beat: 3, gainDb: 0.7, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2, accent: true },
      { beat: 0.5, gainDb: -4 },
      { beat: 1, gainDb: -2, accent: true },
      { beat: 1.5, gainDb: -4 },
      { beat: 2, gainDb: -2, accent: true },
      { beat: 2.5, gainDb: -4 },
      { beat: 3, gainDb: -2, accent: true },
      { beat: 3.5, gainDb: -4 },
    ],
    bass: [
      { beat: 0, gainDb: 0.4, accent: true },
      { beat: 1.5, gainDb: -1 },
      { beat: 2, gainDb: -0.3 },
    ],
    chord: [{ beat: 0, accent: true }],
  },
  reggae: {
    // One-drop: kick often on 3; snare on 3; skank on offbeats
    kick: [
      { beat: 2, gainDb: 0.8, accent: true },
      { beat: 0, gainDb: -1.5 },
    ],
    snare: [{ beat: 2, gainDb: 0.7, accent: true }],
    hat: [
      { beat: 0.5, gainDb: -2, accent: true },
      { beat: 1.5, gainDb: -2.5, accent: true },
      { beat: 2.5, gainDb: -2, accent: true },
      { beat: 3.5, gainDb: -2.5, accent: true },
    ],
    bass: [
      { beat: 0, gainDb: 0.6, accent: true },
      { beat: 2.5, gainDb: -0.5 },
      { beat: 3, gainDb: 0.2 },
    ],
    chord: [
      { beat: 0.5, gainDb: -0.5, accent: true },
      { beat: 1.5, gainDb: -1 },
      { beat: 2.5, gainDb: -0.5, accent: true },
      { beat: 3.5, gainDb: -1 },
    ],
  },
  dub: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 2, gainDb: 0.2 },
    ],
    snare: [{ beat: 2, gainDb: 0.5, accent: true }],
    hat: [
      { beat: 0.5, gainDb: -3 },
      { beat: 2.5, gainDb: -3.5 },
    ],
    perc: [
      { beat: 1.5, gainDb: -2 },
      { beat: 3.25, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.8, accent: true },
      { beat: 3, gainDb: -1 },
    ],
    chord: [{ beat: 0, gainDb: -1, accent: true }],
  },
  hiphop: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 2.5, gainDb: 0.2 },
      { beat: 1.5, gainDb: -0.8 },
    ],
    snare: [
      { beat: 1, gainDb: 0.7, accent: true },
      { beat: 3, gainDb: 0.85, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2, accent: true },
      { beat: 0.5, gainDb: -4 },
      { beat: 1, gainDb: -2.5 },
      { beat: 1.5, gainDb: -4 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -4 },
      { beat: 3, gainDb: -2.5 },
      { beat: 3.5, gainDb: -4 },
    ],
    bass: [
      { beat: 0, gainDb: 0.6, accent: true },
      { beat: 2.5, gainDb: -0.5 },
    ],
  },
  triphop: {
    kick: [
      { beat: 0, gainDb: 0.8, accent: true },
      { beat: 2.75, gainDb: -1 },
    ],
    snare: [{ beat: 2, gainDb: 0.5, accent: true }],
    hat: [
      { beat: 0.5, gainDb: -4 },
      { beat: 1.5, gainDb: -4.5 },
      { beat: 3, gainDb: -3.5 },
    ],
    bass: [{ beat: 0, gainDb: 0.3, accent: true }],
    chord: [{ beat: 0, gainDb: -1.5, accent: true }],
  },
  dnb: {
    // Amen-ish skeleton (felt as break within bar)
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 1.5, gainDb: 0.2 },
      { beat: 2.5, gainDb: 0.4, accent: true },
      { beat: 3.25, gainDb: -0.5 },
    ],
    snare: [
      { beat: 1, gainDb: 0.5 },
      { beat: 2, gainDb: 0.85, accent: true },
      { beat: 3.5, gainDb: 0.3 },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.25, gainDb: -4 },
      { beat: 0.5, gainDb: -3 },
      { beat: 0.75, gainDb: -4 },
      { beat: 1, gainDb: -2 },
      { beat: 1.25, gainDb: -4 },
      { beat: 1.5, gainDb: -3 },
      { beat: 1.75, gainDb: -4 },
      { beat: 2, gainDb: -2 },
      { beat: 2.25, gainDb: -4 },
      { beat: 2.5, gainDb: -3 },
      { beat: 2.75, gainDb: -4 },
      { beat: 3, gainDb: -2 },
      { beat: 3.25, gainDb: -4 },
      { beat: 3.5, gainDb: -3 },
      { beat: 3.75, gainDb: -4 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 2, gainDb: 0.3, accent: true },
      { beat: 3, gainDb: -0.5 },
    ],
  },
  breakbeat: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 0.75, gainDb: -0.5 },
      { beat: 2, gainDb: 0.5, accent: true },
      { beat: 2.5, gainDb: 0.1 },
    ],
    snare: [
      { beat: 1, gainDb: 0.6, accent: true },
      { beat: 2.75, gainDb: 0.2 },
      { beat: 3, gainDb: 0.7, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.5, gainDb: -3.5 },
      { beat: 1, gainDb: -2 },
      { beat: 1.5, gainDb: -3.5 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -3.5 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -3.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.4, accent: true },
      { beat: 2, gainDb: -0.3 },
    ],
  },
  techno: {
    kick: [
      { beat: 0, gainDb: 1.2, accent: true },
      { beat: 1, gainDb: 1, accent: true },
      { beat: 2, gainDb: 1, accent: true },
      { beat: 3, gainDb: 1, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: -1 },
      { beat: 3, gainDb: -0.5 },
    ],
    hat: [
      { beat: 0.5, gainDb: -2, accent: true },
      { beat: 1.5, gainDb: -2.5, accent: true },
      { beat: 2.5, gainDb: -2, accent: true },
      { beat: 3.5, gainDb: -2.5, accent: true },
    ],
    bass: [
      { beat: 0, gainDb: 0.3, accent: true },
      { beat: 0.5, gainDb: -1 },
      { beat: 1, gainDb: -0.5 },
      { beat: 1.5, gainDb: -1 },
      { beat: 2, gainDb: 0.2 },
      { beat: 2.5, gainDb: -1 },
      { beat: 3, gainDb: -0.5 },
      { beat: 3.5, gainDb: -1 },
    ],
  },
  house: {
    kick: [
      { beat: 0, gainDb: 1.1, accent: true },
      { beat: 1, gainDb: 1, accent: true },
      { beat: 2, gainDb: 1, accent: true },
      { beat: 3, gainDb: 1, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: 0.3 },
      { beat: 3, gainDb: 0.4 },
    ],
    hat: [
      { beat: 0, gainDb: -3 },
      { beat: 0.5, gainDb: -1.5, accent: true },
      { beat: 1, gainDb: -3 },
      { beat: 1.5, gainDb: -1.5, accent: true },
      { beat: 2, gainDb: -3 },
      { beat: 2.5, gainDb: -1.5, accent: true },
      { beat: 3, gainDb: -3 },
      { beat: 3.5, gainDb: -1.5, accent: true },
    ],
    bass: [
      { beat: 0, gainDb: 0.4, accent: true },
      { beat: 2, gainDb: 0.2 },
      { beat: 3.5, gainDb: -0.8 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
  },
  disco: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 1, gainDb: 0.9, accent: true },
      { beat: 2, gainDb: 0.9, accent: true },
      { beat: 3, gainDb: 0.9, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: 0.5, accent: true },
      { beat: 3, gainDb: 0.6, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.5, gainDb: -2.5 },
      { beat: 1, gainDb: -2 },
      { beat: 1.5, gainDb: -2.5 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -2.5 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 1, gainDb: -0.5 },
      { beat: 2, gainDb: 0.3 },
      { beat: 3, gainDb: -0.5 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 1, gainDb: -1 },
      { beat: 2, accent: true },
      { beat: 3, gainDb: -1 },
    ],
  },
  funk: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 1.5, gainDb: 0.2 },
      { beat: 2.25, gainDb: 0.4 },
      { beat: 3.5, gainDb: -0.3 },
    ],
    snare: [
      { beat: 1, gainDb: 0.7, accent: true },
      { beat: 2.5, gainDb: -1.5 },
      { beat: 3, gainDb: 0.8, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.25, gainDb: -4 },
      { beat: 0.5, gainDb: -2.5 },
      { beat: 0.75, gainDb: -4 },
      { beat: 1, gainDb: -2 },
      { beat: 1.25, gainDb: -4 },
      { beat: 1.5, gainDb: -2.5 },
      { beat: 1.75, gainDb: -4 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -2.5 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 0.75, gainDb: -1 },
      { beat: 1.5, gainDb: 0.2 },
      { beat: 2.5, gainDb: -0.5 },
      { beat: 3.25, gainDb: -0.8 },
    ],
  },
  jazz: {
    kick: [
      { beat: 0, gainDb: 0.3 },
      { beat: 2.5, gainDb: -0.5 },
    ],
    snare: [
      { beat: 1, gainDb: -0.5 },
      { beat: 3, gainDb: 0.2, accent: true },
      { beat: 1.5, gainDb: -2 },
    ],
    hat: [
      { beat: 0, gainDb: -1.5, accent: true },
      { beat: 1, gainDb: -2.5 },
      { beat: 2, gainDb: -1.5, accent: true },
      { beat: 3, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.2, accent: true },
      { beat: 1, gainDb: -0.5 },
      { beat: 2, gainDb: 0.1 },
      { beat: 3, gainDb: -0.5 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    lead: [
      { beat: 0, accent: true },
      { beat: 1.5, gainDb: -1 },
      { beat: 2.5, gainDb: -0.5 },
      { beat: 3.5, gainDb: -1.5 },
    ],
  },
  blues: {
    kick: [
      { beat: 0, gainDb: 0.8, accent: true },
      { beat: 2, gainDb: 0.3 },
    ],
    snare: [
      { beat: 1, gainDb: 0.5, accent: true },
      { beat: 3, gainDb: 0.6, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 1, gainDb: -2.5 },
      { beat: 2, gainDb: -2 },
      { beat: 3, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.4, accent: true },
      { beat: 1, gainDb: -0.8 },
      { beat: 2, gainDb: 0.2 },
      { beat: 3, gainDb: -0.8 },
    ],
    lead: [
      { beat: 0, accent: true },
      { beat: 1.5, gainDb: -0.5 },
      { beat: 2.5, gainDb: -1 },
      { beat: 3.5, gainDb: -0.5 },
    ],
  },
  latin: {
    kick: [
      { beat: 0, gainDb: 0.8, accent: true },
      { beat: 2.5, gainDb: 0.3 },
    ],
    snare: [
      { beat: 1.5, gainDb: 0.4 },
      { beat: 3, gainDb: 0.5, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.5, gainDb: -3 },
      { beat: 1, gainDb: -2 },
      { beat: 1.5, gainDb: -3 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -3 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -3 },
    ],
    perc: [
      { beat: 0.5, gainDb: -1, accent: true },
      { beat: 1.25, gainDb: -1.5 },
      { beat: 2, gainDb: -1 },
      { beat: 3.25, gainDb: -1.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 2, gainDb: -0.3 },
      { beat: 3.5, gainDb: -0.8 },
    ],
  },
  afrobeat: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 1.5, gainDb: 0.2 },
      { beat: 2, gainDb: 0.5 },
      { beat: 3.25, gainDb: -0.3 },
    ],
    snare: [
      { beat: 1, gainDb: 0.3 },
      { beat: 2.5, gainDb: 0.5, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.5, gainDb: -3 },
      { beat: 1, gainDb: -2 },
      { beat: 1.5, gainDb: -3 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -3 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -3 },
    ],
    perc: [
      { beat: 0.25, gainDb: -1.5 },
      { beat: 0.75, gainDb: -1 },
      { beat: 1.75, gainDb: -1.5 },
      { beat: 2.25, gainDb: -1 },
      { beat: 3.5, gainDb: -1.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 1.5, gainDb: -0.5 },
      { beat: 2.5, gainDb: 0.2 },
    ],
  },
  classical: {
    kick: [],
    snare: [],
    hat: [],
    perc: [{ beat: 0, gainDb: -3 }],
    bass: [
      { beat: 0, gainDb: 0.2, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    lead: [
      { beat: 0, accent: true },
      { beat: 1, gainDb: -0.5 },
      { beat: 2, gainDb: -0.3 },
      { beat: 3, gainDb: -0.8 },
    ],
  },
  ambient: {
    kick: [],
    snare: [],
    hat: [{ beat: 0, gainDb: -5 }],
    bass: [{ beat: 0, gainDb: -1, accent: true }],
    chord: [{ beat: 0, gainDb: -1.5, accent: true }],
    lead: [{ beat: 0, gainDb: -2, accent: true }],
  },
  folk: {
    kick: [{ beat: 0, gainDb: 0.3 }],
    snare: [{ beat: 2, gainDb: -0.5 }],
    hat: [
      { beat: 0, gainDb: -3 },
      { beat: 1, gainDb: -3.5 },
      { beat: 2, gainDb: -3 },
      { beat: 3, gainDb: -3.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.2, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 2, gainDb: -0.5 },
    ],
    lead: [
      { beat: 0, accent: true },
      { beat: 1.5, gainDb: -1 },
      { beat: 3, gainDb: -0.5 },
    ],
  },
  metal: {
    kick: [
      { beat: 0, gainDb: 1.2, accent: true },
      { beat: 0.5, gainDb: 0.8, accent: true },
      { beat: 1, gainDb: 1, accent: true },
      { beat: 1.5, gainDb: 0.8, accent: true },
      { beat: 2, gainDb: 1.2, accent: true },
      { beat: 2.5, gainDb: 0.8, accent: true },
      { beat: 3, gainDb: 1, accent: true },
      { beat: 3.5, gainDb: 0.8, accent: true },
    ],
    snare: [
      { beat: 1, gainDb: 0.9, accent: true },
      { beat: 3, gainDb: 1, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -1.5 },
      { beat: 0.5, gainDb: -2.5 },
      { beat: 1, gainDb: -1.5 },
      { beat: 1.5, gainDb: -2.5 },
      { beat: 2, gainDb: -1.5 },
      { beat: 2.5, gainDb: -2.5 },
      { beat: 3, gainDb: -1.5 },
      { beat: 3.5, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.6, accent: true },
      { beat: 0.5, gainDb: 0.2 },
      { beat: 1, gainDb: 0.4 },
      { beat: 1.5, gainDb: 0.2 },
      { beat: 2, gainDb: 0.6 },
      { beat: 2.5, gainDb: 0.2 },
      { beat: 3, gainDb: 0.4 },
      { beat: 3.5, gainDb: 0.2 },
    ],
  },
  garage: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 2.5, gainDb: 0.4 },
      { beat: 3.25, gainDb: -0.5 },
    ],
    snare: [
      { beat: 1.5, gainDb: 0.3 },
      { beat: 2, gainDb: 0.7, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -2 },
      { beat: 0.5, gainDb: -3.5 },
      { beat: 1, gainDb: -2 },
      { beat: 1.5, gainDb: -3 },
      { beat: 2, gainDb: -2 },
      { beat: 2.5, gainDb: -3.5 },
      { beat: 3, gainDb: -2 },
      { beat: 3.5, gainDb: -3 },
    ],
    bass: [
      { beat: 0, gainDb: 0.4, accent: true },
      { beat: 2, gainDb: -0.3 },
      { beat: 3.5, gainDb: -0.8 },
    ],
  },
  punk: {
    kick: [
      { beat: 0, gainDb: 1, accent: true },
      { beat: 1, gainDb: 0.6 },
      { beat: 2, gainDb: 1, accent: true },
      { beat: 3, gainDb: 0.6 },
    ],
    snare: [
      { beat: 1, gainDb: 0.9, accent: true },
      { beat: 3, gainDb: 1, accent: true },
    ],
    hat: [
      { beat: 0, gainDb: -1.5 },
      { beat: 0.5, gainDb: -2.5 },
      { beat: 1, gainDb: -1.5 },
      { beat: 1.5, gainDb: -2.5 },
      { beat: 2, gainDb: -1.5 },
      { beat: 2.5, gainDb: -2.5 },
      { beat: 3, gainDb: -1.5 },
      { beat: 3.5, gainDb: -2.5 },
    ],
    bass: [
      { beat: 0, gainDb: 0.5, accent: true },
      { beat: 1, gainDb: 0.2 },
      { beat: 2, gainDb: 0.5 },
      { beat: 3, gainDb: 0.2 },
    ],
    chord: [
      { beat: 0, accent: true },
      { beat: 1, gainDb: -0.5 },
      { beat: 2, accent: true },
      { beat: 3, gainDb: -0.5 },
    ],
  },
};

function applyGrooveTick(
  tickInBar: number,
  groove: GrooveKind,
  beatsPerBar: number,
  ppq: number,
): number {
  const tpb = beatsPerBar * ppq;
  let t = ((tickInBar % tpb) + tpb) % tpb;
  if (groove === "straight") return t;
  if (groove === "half-time") {
    const beat = t / ppq;
    if (beatsPerBar >= 4) {
      if (beat >= 1 && beat < 2) t = Math.round((beat - 1) * 0.35 * ppq);
      else if (beat >= 3 && beat < 4)
        t = Math.round(2 * ppq + (beat - 3) * 0.35 * ppq);
    }
    return ((t % tpb) + tpb) % tpb;
  }
  const beatFloor = Math.floor(t / ppq);
  const within = t - beatFloor * ppq;
  const eighth = ppq / 2;
  if (within > eighth * 0.85 && within < eighth * 1.15) {
    t = beatFloor * ppq + Math.round(eighth * (2 / 3) + eighth);
  } else if (within >= eighth) {
    const sub = within - eighth;
    t = beatFloor * ppq + eighth + Math.round(sub * 0.55 + eighth * 0.15);
  }
  return ((t % tpb) + tpb) % tpb;
}

function specsToHits(
  specs: MotifSpec[],
  beatsPerBar: number,
  ppq: number,
  groove: GrooveKind,
): MotifHit[] {
  const tpb = beatsPerBar * ppq;
  const hits: MotifHit[] = [];
  for (const s of specs) {
    if (s.beat >= beatsPerBar) continue;
    const raw = Math.round(s.beat * ppq);
    if (raw < 0 || raw >= tpb) continue;
    hits.push({
      tickInBar: applyGrooveTick(raw, groove, beatsPerBar, ppq),
      gainDb: s.gainDb ?? 0,
      accent: !!s.accent,
    });
  }
  hits.sort((a, b) => a.tickInBar - b.tickInBar);
  return hits;
}

function fallbackMotif(
  role: string,
  beatsPerBar: number,
  ppq: number,
  groove: GrooveKind,
  rnd: () => number,
): MotifHit[] {
  const tpb = beatsPerBar * ppq;
  const push = (beat: number, gainDb: number, accent: boolean): MotifHit => ({
    tickInBar: applyGrooveTick(Math.round(beat * ppq), groove, beatsPerBar, ppq),
    gainDb,
    accent,
  });
  if (role === "loop" || role === "texture") return [push(0, role === "texture" ? -1 : 0, true)];
  if (role === "fx") {
    const hits: MotifHit[] = [];
    if (rnd() < 0.6) hits.push(push(0, -2, false));
    if (rnd() < 0.4) hits.push(push(beatsPerBar / 2, -3, false));
    return hits.length ? hits : [push(0, -2, true)];
  }
  if (role === "perc") {
    const offs = [0, 1.5, 2, 3.25];
    return offs
      .filter((o) => o < beatsPerBar && rnd() < 0.7)
      .map((o) => push(o, (rnd() * 2 - 1) * 2, o === 0));
  }
  if (role === "lead") {
    const steps =
      rnd() < 0.5 ? [0, 1, 2, 3] : [0, 1.5, 2, 3.5];
    return steps
      .filter((o) => o < beatsPerBar && rnd() < 0.75)
      .map((o) => push(o, (rnd() * 2 - 1) * 1.5, o === 0));
  }
  if (role === "chord" || role === "arp") return [push(0, 0, true)];
  if (role === "bass") {
    const hits = [push(0, 0.5, true)];
    if (beatsPerBar >= 3 && rnd() < 0.7) hits.push(push(2, -0.5, false));
    return hits;
  }
  return [push(0, 0, true)];
}

/**
 * Build a bar motif for a role from the music-style bank.
 * Falls back to generic patterns when the style has no entry for that role.
 */
export function buildStyleMotif(
  style: MusicStyleId,
  role: string,
  beatsPerBar: number,
  ppq: number,
  rnd: () => number,
  groove: GrooveKind,
): MotifHit[] {
  const bank = STYLE_MOTIFS[style];
  let specs: MotifSpec[] | undefined;
  switch (role) {
    case "kick":
      specs = bank.kick;
      break;
    case "snare":
      specs = bank.snare;
      break;
    case "hat":
      specs = bank.hat;
      break;
    case "perc":
      specs = bank.perc;
      break;
    case "bass":
      specs = bank.bass;
      break;
    case "chord":
      specs = bank.chord;
      break;
    case "lead":
      specs = bank.lead;
      break;
    case "arp":
      specs = bank.chord;
      break;
    default:
      specs = undefined;
  }
  if (specs && specs.length > 0) {
    const hits = specsToHits(specs, beatsPerBar, ppq, groove);
    if (hits.length > 0) return hits;
  }
  // Classical / ambient: empty kick/snare is intentional — skip drums
  if (
    (style === "classical" || style === "ambient") &&
    (role === "kick" || role === "snare" || role === "hat")
  ) {
    return [];
  }
  return fallbackMotif(role, beatsPerBar, ppq, groove, rnd);
}

/** Map YAMNet / AudioSet-ish slugs → music style votes. */
const YAMNET_STYLE_RULES: Array<{ re: RegExp; style: MusicStyleId; w: number }> =
  [
    { re: /\b(drum-and-bass|drum.?n.?bass|dnb|jungle)\b/, style: "dnb", w: 4 },
    { re: /\b(hip-hop|hiphop|rap)\b/, style: "hiphop", w: 4 },
    { re: /\b(trip-hop|triphop)\b/, style: "triphop", w: 4 },
    { re: /\b(reggae)\b/, style: "reggae", w: 4 },
    { re: /\b(dub)\b/, style: "dub", w: 3 },
    { re: /\b(techno)\b/, style: "techno", w: 4 },
    { re: /\b(house)\b/, style: "house", w: 3.5 },
    { re: /\b(disco)\b/, style: "disco", w: 3.5 },
    { re: /\b(funk)\b/, style: "funk", w: 3.5 },
    { re: /\b(jazz)\b/, style: "jazz", w: 3.5 },
    { re: /\b(blues)\b/, style: "blues", w: 3.5 },
    { re: /\b(rock|punk)\b/, style: "rock", w: 3 },
    { re: /\b(metal|heavy-metal)\b/, style: "metal", w: 4 },
    { re: /\b(punk)\b/, style: "punk", w: 3.5 },
    { re: /\b(classical|orchestra|symphony|opera|choir)\b/, style: "classical", w: 4 },
    { re: /\b(ambient|new-age)\b/, style: "ambient", w: 3.5 },
    { re: /\b(folk|country|bluegrass)\b/, style: "folk", w: 3 },
    { re: /\b(latin|salsa|samba|bossa|tango)\b/, style: "latin", w: 3.5 },
    { re: /\b(afrobeat|african)\b/, style: "afrobeat", w: 3 },
    { re: /\b(breakbeat|break-beat)\b/, style: "breakbeat", w: 3.5 },
    { re: /\b(garage|uk-garage|2-step)\b/, style: "garage", w: 3.5 },
    { re: /\b(pop|pop-music)\b/, style: "pop", w: 2.5 },
    { re: /\b(electronic-music|electronica|edm)\b/, style: "techno", w: 2 },
    { re: /\b(music)\b/, style: "pop", w: 0.4 },
  ];

export function inferMusicStyleFromYamnet(
  yamnetSlugs: readonly string[],
): MusicStyleId | null {
  if (!yamnetSlugs.length) return null;
  const hay = ` ${yamnetSlugs.join(" ").toLowerCase().replace(/_/g, "-")} `;
  const votes = new Map<MusicStyleId, number>();
  for (const rule of YAMNET_STYLE_RULES) {
    if (!rule.re.test(hay)) continue;
    votes.set(rule.style, (votes.get(rule.style) ?? 0) + rule.w);
  }
  let best: MusicStyleId | null = null;
  let bestW = 0;
  for (const [id, w] of votes) {
    if (w > bestW) {
      bestW = w;
      best = id;
    }
  }
  return bestW >= 2 ? best : null;
}

export function pickMusicStyle(
  choice: GenMusicStyleChoice | undefined,
  rnd: () => number,
  yamnetPool: readonly string[],
): MusicStyleId {
  if (choice && choice !== "auto") return choice;
  const inferred = inferMusicStyleFromYamnet(yamnetPool);
  if (inferred && rnd() < 0.85) return inferred;
  return MUSIC_STYLE_IDS[Math.floor(rnd() * MUSIC_STYLE_IDS.length)]!;
}

export function resolveStyleBiasedSlider(
  value: number | "auto" | undefined,
  rnd: () => number,
  lo: number,
  hi: number,
  fallback: number,
  center: number | undefined,
): number {
  if (value === "auto") {
    if (center != null && Number.isFinite(center)) {
      const spread = (hi - lo) * 0.18;
      const v = center + (rnd() * 2 - 1) * spread;
      return Math.min(hi, Math.max(lo, v));
    }
    return lo + rnd() * (hi - lo);
  }
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}
