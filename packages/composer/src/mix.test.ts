import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import { transitionsCoordinated } from "./gestures.js";
import { headroomOk } from "./master.js";
import { mixOk } from "./mix.js";
import type { ComposeSettings } from "./types.js";

function settings(partial?: Partial<ComposeSettings>): ComposeSettings {
  return {
    seed: 12,
    style: "techno",
    targetBars: 48,
    formFamily: "build-drop",
    energyShape: "rise",
    energy: 0.65,
    density: 0.7,
    drumsVsTexture: 0.75,
    variation: 0.3,
    life: 0.6,
    space: 0.5,
    swing: 0,
    humanize: 0.1,
    keyPc: 0,
    mode: "aeolian",
    tuningRef: "440",
    targetLufs: -14,
    ...partial,
  };
}

describe("gestures + mix + master", () => {
  it("emits gestures, automation, mix tracks, spaces, master", () => {
    const { score } = compose(settings());
    assert.ok(score.gestures.length > 0);
    assert.ok(score.automation.length > 0);
    assert.ok(score.mix.tracks.length >= 5);
    assert.equal(score.mix.spaces.A.type, "reverb");
    assert.equal(score.mix.spaces.B.type, "echo");
    assert.ok(score.mix.master.fx[0].type === "compressor");
    assert.equal(score.mix.master.ceilingDbtp, -1);
  });

  it("coordinates energy-up transitions", () => {
    const { score } = compose(settings({ formFamily: "verse-chorus" }));
    assert.ok(transitionsCoordinated(score.sections, score.gestures));
  });

  it("build touches ≥2 tracks or bus/master automation", () => {
    const { score } = compose(settings());
    const builds = score.gestures.filter((g) => g.kind === "build");
    if (builds.length === 0) return;
    const g = builds[0]!;
    const trackCount = Array.isArray(g.tracks) ? g.tracks.length : 3;
    assert.ok(trackCount >= 2 || g.tracks === "nonKick" || g.tracks === "all");
    const related = score.automation.filter((a) => a.gesture === "build");
    assert.ok(related.length >= 2);
  });

  it("mix levels / pan / kick send invariants", () => {
    const { score } = compose(settings({ style: "rock" }));
    assert.ok(mixOk(score.mix.tracks));
  });

  it("headroom ≥ 3 dB before limiter after master trim", () => {
    const { score } = compose(settings());
    assert.ok(headroomOk(score.mix.tracks, score.mix.master));
  });

  it("life=0 still has structural gestures but fewer LFO lanes", () => {
    const dry = compose(settings({ life: 0 }));
    const wet = compose(settings({ life: 0.9 }));
    assert.ok(dry.score.gestures.some((g) => g.kind === "fadeIn" || g.kind === "drop" || g.kind === "build"));
    const lfoDry = dry.score.automation.filter((a) => a.gesture === "lfo").length;
    const lfoWet = wet.score.automation.filter((a) => a.gesture === "lfo").length;
    assert.ok(lfoWet >= lfoDry);
  });
});
