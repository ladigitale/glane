import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "../compose.js";
import { makeRng } from "../rng.js";
import type { ComposeSettings } from "../types.js";
import { MUSIC_STYLE_IDS } from "./ids.js";
import {
  assertAllStyleProfiles,
  resolveStyleAutos,
  STYLE_GENERATOR_PROFILES,
} from "./profiles.js";

describe("STYLE_GENERATOR_PROFILES", () => {
  it("covers every MusicStyleId", () => {
    assert.equal(assertAllStyleProfiles(), true);
    assert.equal(
      Object.keys(STYLE_GENERATOR_PROFILES).length,
      MUSIC_STYLE_IDS.length,
    );
  });

  it("resolveStyleAutos sticks to style defaults", () => {
    const r = makeRng(7);
    const a = resolveStyleAutos({
      style: "dnb",
      formFamily: "auto",
      energyShape: "auto",
      mode: "auto",
      stick: 1,
      roll: (path) => r(path),
    });
    assert.equal(a.formFamily, "build-drop");
    assert.equal(a.energyShape, "rise");
    assert.equal(a.mode, "aeolian");
  });

  it("compose ambient DNA uses profile groove / preferred form", () => {
    const settings: ComposeSettings = {
      seed: 11,
      style: "ambient",
      targetBars: 32,
      formFamily: "loop-evolve",
      energyShape: "plateau",
      energy: 0.3,
      density: 0.55,
      drumsVsTexture: 0.2,
      variation: 0.3,
      life: 0.4,
      space: 0.8,
      swing: 0,
      humanize: 0.4,
      keyPc: 0,
      mode: "aeolian",
      tuningRef: "440",
      targetLufs: -14,
    };
    const { score, resolved } = compose(settings);
    assert.equal(resolved.formFamily, "loop-evolve");
    assert.equal(score.dna.groove.feel, "straight");
    assert.equal(resolved.mode, "aeolian");
  });

  it("compose jazz prefers shuffle feel", () => {
    const { score } = compose({
      seed: 3,
      style: "jazz",
      targetBars: 32,
      formFamily: "aaba",
      energyShape: "arch",
      energy: 0.55,
      density: 0.95,
      drumsVsTexture: 0.55,
      variation: 0.4,
      life: 0.7,
      space: 0.45,
      swing: 0.55,
      humanize: 0.85,
      keyPc: 0,
      mode: "dorian",
      tuningRef: "440",
      targetLufs: -14,
    });
    assert.equal(score.dna.groove.feel, "shuffle");
  });
});
