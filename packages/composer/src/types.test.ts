import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { MUSIC_STYLE_IDS } from "./styles/ids.js";
import type { ComposeSettings } from "./types.js";

describe("composer scaffold", () => {
  it("exports 22 music style ids", () => {
    assert.equal(MUSIC_STYLE_IDS.length, 22);
  });

  it("compose returns a Score with resolved autos", () => {
    const settings: ComposeSettings = {
      seed: 1,
      style: "auto",
      targetBars: 32,
      formFamily: "auto",
      energyShape: "auto",
      energy: 0.5,
      density: 0.5,
      drumsVsTexture: 0.5,
      variation: 0.3,
      life: 0.4,
      space: 0.4,
      swing: 0,
      humanize: 0.2,
      keyPc: "auto",
      mode: "auto",
      tuningRef: "auto",
      targetLufs: -14,
    };
    const { score, resolved } = compose(settings);
    assert.equal(resolved.style, "ambient");
    assert.equal(resolved.formFamily, "loop-evolve");
    assert.equal(resolved.mode, "aeolian");
    assert.equal(score.dna.seed, 1);
    assert.ok(score.sections.length > 0);
    assert.ok(score.harmony.length > 0);
    assert.ok(score.parts.some((p) => p.role === "kick"));
  });
});
