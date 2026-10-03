import type {
  EnergyShape,
  FormFamily,
  ModeId,
} from "../types.js";
import type { MusicStyleId } from "./ids.js";
import { MUSIC_STYLE_IDS } from "./ids.js";

export type GrooveFeel = "straight" | "shuffle" | "half-time";

export type EnsembleBias = {
  lock: number;
  respond: number;
  kinship: number;
};

/** Generator bias owned by `@glane/composer` (form/mode/groove/ensemble/sliders). */
export type StyleGeneratorProfile = {
  id: MusicStyleId;
  formFamily: FormFamily;
  energyShape: EnergyShape;
  mode: ModeId;
  grooveFeel: GrooveFeel;
  /** Default swing 0..1 when UI groove is auto. */
  swing: number;
  densityCenter: number;
  energyCenter: number;
  drumsCenter: number;
  humanizeCenter: number;
  spaceCenter: number;
  lifeCenter: number;
  ensemble: EnsembleBias;
};

const lockHeavy: EnsembleBias = { lock: 0.7, respond: 0.15, kinship: 0.15 };
const respondHeavy: EnsembleBias = { lock: 0.25, respond: 0.55, kinship: 0.2 };
const kinshipHeavy: EnsembleBias = { lock: 0.15, respond: 0.2, kinship: 0.65 };
const jazzLean: EnsembleBias = { lock: 0.2, respond: 0.5, kinship: 0.3 };
const balanced: EnsembleBias = { lock: 0.4, respond: 0.35, kinship: 0.25 };

function p(
  partial: Omit<StyleGeneratorProfile, "id"> & { id: MusicStyleId },
): StyleGeneratorProfile {
  return partial;
}

export const STYLE_GENERATOR_PROFILES: Record<
  MusicStyleId,
  StyleGeneratorProfile
> = {
  rock: p({
    id: "rock",
    formFamily: "verse-chorus",
    energyShape: "arch",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.05,
    energyCenter: 0.7,
    drumsCenter: 0.72,
    humanizeCenter: 0.55,
    spaceCenter: 0.35,
    lifeCenter: 0.55,
    ensemble: balanced,
  }),
  pop: p({
    id: "pop",
    formFamily: "verse-chorus",
    energyShape: "arch",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1,
    energyCenter: 0.6,
    drumsCenter: 0.6,
    humanizeCenter: 0.45,
    spaceCenter: 0.4,
    lifeCenter: 0.5,
    ensemble: balanced,
  }),
  reggae: p({
    id: "reggae",
    formFamily: "verse-chorus",
    energyShape: "waves",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0.08,
    densityCenter: 0.85,
    energyCenter: 0.5,
    drumsCenter: 0.55,
    humanizeCenter: 0.65,
    spaceCenter: 0.55,
    lifeCenter: 0.55,
    ensemble: respondHeavy,
  }),
  dub: p({
    id: "dub",
    formFamily: "loop-evolve",
    energyShape: "plateau",
    mode: "aeolian",
    grooveFeel: "half-time",
    swing: 0.05,
    densityCenter: 0.7,
    energyCenter: 0.45,
    drumsCenter: 0.5,
    humanizeCenter: 0.55,
    spaceCenter: 0.75,
    lifeCenter: 0.6,
    ensemble: kinshipHeavy,
  }),
  hiphop: p({
    id: "hiphop",
    formFamily: "verse-chorus",
    energyShape: "waves",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0.12,
    densityCenter: 0.9,
    energyCenter: 0.55,
    drumsCenter: 0.75,
    humanizeCenter: 0.7,
    spaceCenter: 0.4,
    lifeCenter: 0.55,
    ensemble: respondHeavy,
  }),
  triphop: p({
    id: "triphop",
    formFamily: "loop-evolve",
    energyShape: "plateau",
    mode: "dorian",
    grooveFeel: "half-time",
    swing: 0.1,
    densityCenter: 0.65,
    energyCenter: 0.4,
    drumsCenter: 0.45,
    humanizeCenter: 0.75,
    spaceCenter: 0.65,
    lifeCenter: 0.55,
    ensemble: kinshipHeavy,
  }),
  dnb: p({
    id: "dnb",
    formFamily: "build-drop",
    energyShape: "rise",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.25,
    energyCenter: 0.8,
    drumsCenter: 0.85,
    humanizeCenter: 0.35,
    spaceCenter: 0.35,
    lifeCenter: 0.6,
    ensemble: lockHeavy,
  }),
  breakbeat: p({
    id: "breakbeat",
    formFamily: "build-drop",
    energyShape: "rise",
    mode: "dorian",
    grooveFeel: "straight",
    swing: 0.05,
    densityCenter: 1.15,
    energyCenter: 0.75,
    drumsCenter: 0.8,
    humanizeCenter: 0.45,
    spaceCenter: 0.35,
    lifeCenter: 0.55,
    ensemble: lockHeavy,
  }),
  techno: p({
    id: "techno",
    formFamily: "loop-evolve",
    energyShape: "rise",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.2,
    energyCenter: 0.7,
    drumsCenter: 0.8,
    humanizeCenter: 0.25,
    spaceCenter: 0.45,
    lifeCenter: 0.5,
    ensemble: lockHeavy,
  }),
  house: p({
    id: "house",
    formFamily: "verse-chorus",
    energyShape: "waves",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.1,
    energyCenter: 0.65,
    drumsCenter: 0.75,
    humanizeCenter: 0.35,
    spaceCenter: 0.4,
    lifeCenter: 0.45,
    ensemble: lockHeavy,
  }),
  disco: p({
    id: "disco",
    formFamily: "verse-chorus",
    energyShape: "arch",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.1,
    energyCenter: 0.7,
    drumsCenter: 0.7,
    humanizeCenter: 0.4,
    spaceCenter: 0.45,
    lifeCenter: 0.5,
    ensemble: balanced,
  }),
  funk: p({
    id: "funk",
    formFamily: "verse-chorus",
    energyShape: "waves",
    mode: "dorian",
    grooveFeel: "straight",
    swing: 0.1,
    densityCenter: 1.15,
    energyCenter: 0.7,
    drumsCenter: 0.7,
    humanizeCenter: 0.6,
    spaceCenter: 0.35,
    lifeCenter: 0.6,
    ensemble: respondHeavy,
  }),
  jazz: p({
    id: "jazz",
    formFamily: "aaba",
    energyShape: "arch",
    mode: "dorian",
    grooveFeel: "shuffle",
    swing: 0.55,
    densityCenter: 0.95,
    energyCenter: 0.55,
    drumsCenter: 0.55,
    humanizeCenter: 0.85,
    spaceCenter: 0.45,
    lifeCenter: 0.7,
    ensemble: jazzLean,
  }),
  blues: p({
    id: "blues",
    formFamily: "aaba",
    energyShape: "arch",
    mode: "mixolydian",
    grooveFeel: "shuffle",
    swing: 0.5,
    densityCenter: 0.9,
    energyCenter: 0.55,
    drumsCenter: 0.55,
    humanizeCenter: 0.8,
    spaceCenter: 0.35,
    lifeCenter: 0.65,
    ensemble: jazzLean,
  }),
  latin: p({
    id: "latin",
    formFamily: "verse-chorus",
    energyShape: "waves",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0.08,
    densityCenter: 1.15,
    energyCenter: 0.7,
    drumsCenter: 0.65,
    humanizeCenter: 0.55,
    spaceCenter: 0.4,
    lifeCenter: 0.55,
    ensemble: respondHeavy,
  }),
  afrobeat: p({
    id: "afrobeat",
    formFamily: "loop-evolve",
    energyShape: "plateau",
    mode: "dorian",
    grooveFeel: "straight",
    swing: 0.05,
    densityCenter: 1.2,
    energyCenter: 0.75,
    drumsCenter: 0.7,
    humanizeCenter: 0.5,
    spaceCenter: 0.4,
    lifeCenter: 0.55,
    ensemble: respondHeavy,
  }),
  classical: p({
    id: "classical",
    formFamily: "arch",
    energyShape: "arch",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 0.7,
    energyCenter: 0.45,
    drumsCenter: 0.2,
    humanizeCenter: 0.5,
    spaceCenter: 0.5,
    lifeCenter: 0.55,
    ensemble: kinshipHeavy,
  }),
  ambient: p({
    id: "ambient",
    formFamily: "loop-evolve",
    energyShape: "plateau",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 0.55,
    energyCenter: 0.3,
    drumsCenter: 0.2,
    humanizeCenter: 0.4,
    spaceCenter: 0.8,
    lifeCenter: 0.45,
    ensemble: kinshipHeavy,
  }),
  folk: p({
    id: "folk",
    formFamily: "aaba",
    energyShape: "arch",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0.05,
    densityCenter: 0.8,
    energyCenter: 0.45,
    drumsCenter: 0.35,
    humanizeCenter: 0.7,
    spaceCenter: 0.35,
    lifeCenter: 0.55,
    ensemble: jazzLean,
  }),
  metal: p({
    id: "metal",
    formFamily: "verse-chorus",
    energyShape: "rise",
    mode: "aeolian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.3,
    energyCenter: 0.9,
    drumsCenter: 0.85,
    humanizeCenter: 0.3,
    spaceCenter: 0.25,
    lifeCenter: 0.5,
    ensemble: lockHeavy,
  }),
  garage: p({
    id: "garage",
    formFamily: "build-drop",
    energyShape: "rise",
    mode: "aeolian",
    grooveFeel: "shuffle",
    swing: 0.35,
    densityCenter: 1.1,
    energyCenter: 0.7,
    drumsCenter: 0.8,
    humanizeCenter: 0.45,
    spaceCenter: 0.35,
    lifeCenter: 0.5,
    ensemble: lockHeavy,
  }),
  punk: p({
    id: "punk",
    formFamily: "verse-chorus",
    energyShape: "rise",
    mode: "ionian",
    grooveFeel: "straight",
    swing: 0,
    densityCenter: 1.2,
    energyCenter: 0.85,
    drumsCenter: 0.8,
    humanizeCenter: 0.4,
    spaceCenter: 0.2,
    lifeCenter: 0.4,
    ensemble: lockHeavy,
  }),
};

export function styleGeneratorProfile(
  id: MusicStyleId,
): StyleGeneratorProfile {
  return STYLE_GENERATOR_PROFILES[id];
}

/** Resolve auto form/energy/mode from style profile (stick then diversify). */
export function resolveStyleAutos(opts: {
  style: MusicStyleId;
  formFamily: FormFamily | "auto";
  energyShape: EnergyShape | "auto";
  mode: ModeId | "auto";
  stick?: number;
  roll: (path: string) => number;
}): {
  formFamily: FormFamily;
  energyShape: EnergyShape;
  mode: ModeId;
  profile: StyleGeneratorProfile;
} {
  const profile = STYLE_GENERATOR_PROFILES[opts.style];
  const stick = opts.stick ?? 0.72;
  const formFamily =
    opts.formFamily !== "auto"
      ? opts.formFamily
      : opts.roll("form/family/stick") < stick
        ? profile.formFamily
        : ([
            "verse-chorus",
            "aaba",
            "build-drop",
            "arch",
            "rondo",
            "loop-evolve",
          ] as const)[Math.floor(opts.roll("form/family/alt") * 6)]!;
  const energyShape =
    opts.energyShape !== "auto"
      ? opts.energyShape
      : opts.roll("form/energy/stick") < stick
        ? profile.energyShape
        : (["rise", "arch", "waves", "plateau"] as const)[
            Math.floor(opts.roll("form/energy/alt") * 4)
          ]!;
  const mode =
    opts.mode !== "auto"
      ? opts.mode
      : opts.roll("dna/mode/stick") < 0.85
        ? profile.mode
        : (["ionian", "aeolian", "dorian", "mixolydian"] as const)[
            Math.floor(opts.roll("dna/mode/alt") * 4)
          ]!;
  return { formFamily, energyShape, mode, profile };
}

/** Sanity: every id has a profile. */
export function assertAllStyleProfiles(): boolean {
  return MUSIC_STYLE_IDS.every((id) => STYLE_GENERATOR_PROFILES[id]?.id === id);
}
