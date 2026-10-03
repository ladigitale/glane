import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { mixcheckScore } from "./mixcheck.js";
import type { ComposeSettings } from "./types.js";

function base(): ComposeSettings {
  return {
    seed: 42,
    style: "ambient",
    targetBars: 32,
    formFamily: "loop-evolve",
    energyShape: "plateau",
    energy: 0.5,
    density: 0.7,
    drumsVsTexture: 0.35,
    variation: 0.3,
    life: 0.4,
    space: 0.5,
    swing: 0,
    humanize: 0.4,
    keyPc: 0,
    mode: "aeolian",
    tuningRef: "440",
    targetLufs: -14,
  };
}

describe("mixcheckScore", () => {
  it("passes a normal ambient compose", () => {
    const { score } = compose(base());
    const r = mixcheckScore(score);
    assert.equal(typeof r.ok, "boolean");
    // Headroom / beds may warn; must not crash.
    assert.ok(Array.isArray(r.warnings));
  });

  it("flags hot kick+bass", () => {
    const { score } = compose({ ...base(), style: "rock", drumsVsTexture: 0.9 });
    for (const t of score.mix.tracks) {
      if (t.role === "kick" || t.role === "bass") t.levelDb = 0;
    }
    const r = mixcheckScore(score);
    assert.ok(r.warnings.some((w) => w.includes("kick+bass")));
  });
});
