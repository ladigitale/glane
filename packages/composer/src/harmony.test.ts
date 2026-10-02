import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { fitForm } from "./form.js";
import {
  cadenceOk,
  halfCadenceOk,
  phraseCoverageOk,
  planHarmony,
  defaultProgressions,
} from "./harmony.js";
import { harmonyMetrics } from "./metrics.js";
import { makeRng } from "./rng.js";
import type { ComposeSettings } from "./types.js";

function baseSettings(seed: number, bars: number): ComposeSettings {
  return {
    seed,
    style: "rock",
    targetBars: bars,
    formFamily: "verse-chorus",
    energyShape: "arch",
    energy: 0.55,
    density: 0.5,
    drumsVsTexture: 0.6,
    variation: 0.3,
    life: 0.4,
    space: 0.4,
    swing: 0,
    humanize: 0.2,
    keyPc: 0,
    mode: "ionian",
    tuningRef: "440",
    targetLufs: -14,
  };
}

describe("harmony cadences", () => {
  it("phrase coverage + authentic cadence on 30 seeds", () => {
    for (let seed = 0; seed < 30; seed++) {
      const form = fitForm({
        targetBars: 32,
        family: "verse-chorus",
        energyShape: "arch",
        energyBias: 0.5,
        rng: makeRng(seed),
      });
      const prog = defaultProgressions(makeRng(seed), "p", "ionian");
      const harmony = planHarmony({
        sections: form.sections,
        progressions: prog,
        mode: "ionian",
        keyPc: 0,
        rng: makeRng(seed + 1000),
      });
      assert.ok(
        phraseCoverageOk(form.sections, harmony),
        `seed ${seed} coverage`,
      );
      assert.ok(cadenceOk(form.sections, harmony), `seed ${seed} cadence`);
      assert.ok(
        halfCadenceOk(form.sections, harmony),
        `seed ${seed} half`,
      );
    }
  });

  it("same kind reuses identical mid-section degrees (except cadence tags)", () => {
    const form = fitForm({
      targetBars: 48,
      family: "verse-chorus",
      energyShape: "rise",
      energyBias: 0.5,
      rng: makeRng(7),
    });
    const verses = form.sections.filter((s) => s.kind === "verse");
    assert.ok(verses.length >= 2);
    const prog = defaultProgressions(makeRng(7), "p", "aeolian");
    const harmony = planHarmony({
      sections: form.sections,
      progressions: prog,
      mode: "aeolian",
      keyPc: 9,
      rng: makeRng(7),
    });
    const a = harmony.filter(
      (h) =>
        h.bar >= verses[0]!.startBar &&
        h.bar < verses[0]!.startBar + verses[0]!.bars,
    );
    const b = harmony.filter(
      (h) =>
        h.bar >= verses[1]!.startBar &&
        h.bar < verses[1]!.startBar + verses[1]!.bars,
    );
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length - 1; i++) {
      assert.equal(a[i]!.degree, b[i]!.degree);
      assert.equal(a[i]!.durBeats, b[i]!.durBeats);
    }
  });
});

describe("compose form+harmony", () => {
  it("fills sections and harmony with green metrics", () => {
    const { score, resolved } = compose(baseSettings(42, 32));
    assert.ok(score.sections.length > 0);
    assert.ok(score.harmony.length > 0);
    assert.equal(resolved.formFamily, "verse-chorus");
    const m = harmonyMetrics(score.sections, score.harmony);
    assert.equal(m.carrure, true);
    assert.equal(m.cadence, true);
    assert.equal(m.phraseCoverage, true);
  });
});
