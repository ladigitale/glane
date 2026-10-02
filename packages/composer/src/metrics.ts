import type { ChordSlot, Score, Section } from "./types.js";
import { assertCarrure } from "./form.js";
import {
  cadenceOk,
  halfCadenceOk,
  phraseCoverageOk,
} from "./harmony.js";

export { assertCarrure } from "./form.js";
export {
  cadenceOk,
  halfCadenceOk,
  phraseCoverageOk,
} from "./harmony.js";

export function sectionBarsOk(sections: readonly Section[]): boolean {
  return assertCarrure(sections);
}

export function contrast(_score: Score): {
  ok: boolean;
  details: string[];
} {
  return { ok: true, details: [] };
}

export function summarize(score: Score): Record<string, number | boolean> {
  return {
    sections: score.sections.length,
    bars: score.sections.reduce((s, x) => s + x.bars, 0),
    chords: score.harmony.length,
    carrure: assertCarrure(score.sections),
    cadence: cadenceOk(score.sections, score.harmony),
    halfCadence: halfCadenceOk(score.sections, score.harmony),
    phraseCoverage: phraseCoverageOk(score.sections, score.harmony),
  };
}

export function harmonyMetrics(
  sections: readonly Section[],
  harmony: readonly ChordSlot[],
): Record<string, boolean> {
  return {
    carrure: assertCarrure(sections),
    cadence: cadenceOk(sections, harmony),
    halfCadence: halfCadenceOk(sections, harmony),
    phraseCoverage: phraseCoverageOk(sections, harmony),
  };
}
