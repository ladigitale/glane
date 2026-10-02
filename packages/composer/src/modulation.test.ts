import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "./compose.js";
import {
  beatStrengthAt,
  buildModRoutes,
  modulationDepth,
  resolveEventExpression,
} from "./modulation.js";
import type { ComposeSettings } from "./types.js";

function settings(life: number): ComposeSettings {
  return {
    seed: 42,
    style: "house",
    targetBars: 32,
    formFamily: "verse-chorus",
    energyShape: "arch",
    energy: 0.55,
    density: 0.55,
    drumsVsTexture: 0.6,
    variation: 0.3,
    life,
    space: 0.4,
    swing: 0,
    humanize: 0.1,
    keyPc: 0,
    mode: "aeolian",
    tuningRef: "440",
    targetLufs: -14,
  };
}

describe("modulation Vie contract", () => {
  it("life=0 → no routes", () => {
    const routes = buildModRoutes({ life: 0, style: "rock" });
    assert.equal(routes.length, 0);
    assert.equal(compose(settings(0)).score.modRoutes.length, 0);
  });

  it("life≥0.5 → routes with positive depth; monotone vs life=0.2", () => {
    const low = buildModRoutes({ life: 0.2, style: "techno" });
    const high = buildModRoutes({ life: 0.8, style: "techno" });
    assert.ok(high.length > 0);
    assert.ok(modulationDepth(high) > modulationDepth(low));
    assert.ok(compose(settings(0.6)).score.modRoutes.length > 0);
  });

  it("beatStrength accents downbeats", () => {
    assert.equal(beatStrengthAt(0, 960), 1);
    assert.ok(beatStrengthAt(1920, 960) >= 0.5); // beat 2
    assert.ok(beatStrengthAt(960, 960) < 0.5); // beat 1
    assert.ok(beatStrengthAt(480, 960) < 0.5); // offbeat
  });

  it("resolveEventExpression applies role-scoped routes", () => {
    const routes = buildModRoutes({ life: 1, style: "dub" });
    const kick = resolveEventExpression(routes, "kick", {
      energy: 0.8,
      sectionRamp: 0.5,
      phraseRamp: 0.9,
      barInPhrase: 0,
      beatStrength: 1,
      accent: 1,
      velocity: 0.8,
      lfoBars: 0.5,
      holdPerPhrase: 0.5,
      occurrence: 0,
      sampleEnvelope: 0.5,
    });
    assert.ok(kick.sendA === 0 || kick.sendA < 0.2);
    const snare = resolveEventExpression(routes, "snare", {
      energy: 0.5,
      sectionRamp: 0.5,
      phraseRamp: 1,
      barInPhrase: 3,
      beatStrength: 0.6,
      accent: 1,
      velocity: 0.7,
      lfoBars: 0.5,
      holdPerPhrase: 0.2,
      occurrence: 0,
      sampleEnvelope: 0.5,
    });
    assert.ok(snare.sendA > 0 || snare.sendB > 0 || snare.gainDb !== 0);
  });
});
