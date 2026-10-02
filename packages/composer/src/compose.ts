import { DEFAULT_TRACK_FX } from "@glane/core-model";
import { fitForm, pickEnergyShape, pickFormFamily } from "./form.js";
import {
  defaultProgressions,
  planHarmony,
} from "./harmony.js";
import { makeRng } from "./rng.js";
import type { ComposeResult, ComposeSettings, Score } from "./types.js";

function emptyMotif() {
  return {
    rhythm: { steps: 16, onsets: [] as number[], accents: [] as number[] },
    contour: [] as number[],
    lengthBeats: 4,
  };
}

/**
 * Orchestrate composition layers → Score.
 * Step 3: form + harmony filled; rhythm/melody/mix still empty.
 */
export function compose(settings: ComposeSettings): ComposeResult {
  const rng = makeRng(settings.seed);
  const style = settings.style === "auto" ? "ambient" : settings.style;
  const formFamily = pickFormFamily(rng, "form/family", settings.formFamily);
  const energyShape = pickEnergyShape(
    rng,
    "form/energyShape",
    settings.energyShape,
  );
  const keyPc = settings.keyPc === "auto" ? 0 : settings.keyPc;
  const mode = settings.mode === "auto" ? "aeolian" : settings.mode;

  const form = fitForm({
    targetBars: settings.targetBars,
    family: formFamily,
    energyShape,
    energyBias: settings.energy,
    rng,
    path: "form",
  });

  const progressions = defaultProgressions(rng, "dna/prog", mode);
  const harmony = planHarmony({
    sections: form.sections,
    progressions,
    mode,
    keyPc,
    rng,
    path: "harmony",
  });

  const resolved: ComposeSettings = {
    ...settings,
    style,
    formFamily,
    energyShape,
    keyPc,
    mode,
    targetBars: form.totalBars,
  };

  const score: Score = {
    dna: {
      seed: settings.seed,
      style,
      keyPc,
      mode,
      bpm: 120,
      meter: [4, 4],
      groove: {
        swing: settings.swing,
        feel: "straight",
        humanizeMs: settings.humanize * 20,
      },
      rhythmGenes: [],
      hook: emptyMotif(),
      verseMotif: emptyMotif(),
      progressions,
      tuningOffsetCents: 0,
    },
    sections: form.sections,
    harmony,
    parts: [],
    layerMatrix: [],
    modRoutes: [],
    gestures: [],
    automation: [],
    mix: {
      tracks: [],
      spaces: { A: { ...DEFAULT_TRACK_FX }, B: { ...DEFAULT_TRACK_FX } },
      master: {
        preampGainDb: 0,
        masterGainDb: 0,
        fx: [{ ...DEFAULT_TRACK_FX }, { ...DEFAULT_TRACK_FX }],
        targetLufs: settings.targetLufs,
        ceilingDbtp: -1,
      },
    },
    warnings: [
      ...form.warnings,
      "composer: rhythm/melody/mix layers not yet implemented",
    ],
  };

  return { score, resolved };
}
