import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MUSIC_STYLE_IDS,
  MUSIC_STYLE_PROFILES,
  styleSuggestedTempoBars,
  styleTempoBarsFit,
} from "./generative-styles.js";

describe("style tempo/bars hints", () => {
  it("every style has a coherent bpm and bars window", () => {
    for (const id of MUSIC_STYLE_IDS) {
      const p = MUSIC_STYLE_PROFILES[id];
      assert.ok(p.bpmHint.min <= p.bpmHint.ideal);
      assert.ok(p.bpmHint.ideal <= p.bpmHint.max);
      assert.ok(p.barsHint.min <= p.barsHint.ideal);
      assert.ok(p.barsHint.ideal <= p.barsHint.max);
      assert.ok(p.bpmHint.min >= 40);
      assert.ok(p.bpmHint.max <= 300);
    }
  });

  it("detects mismatch and suggested ideals", () => {
    const fit = styleTempoBarsFit("dnb", 90, 8);
    assert.equal(fit.bpmOk, false);
    assert.equal(fit.barsOk, false);
    const sug = styleSuggestedTempoBars("dnb");
    assert.equal(sug.bpm, MUSIC_STYLE_PROFILES.dnb.bpmHint.ideal);
    assert.equal(sug.bars, MUSIC_STYLE_PROFILES.dnb.barsHint.ideal);
    const ok = styleTempoBarsFit("dnb", sug.bpm, sug.bars);
    assert.equal(ok.bpmOk, true);
    assert.equal(ok.barsOk, true);
  });
});
