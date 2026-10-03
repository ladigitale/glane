import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSongDna, buildSongDna } from "./dna.js";
import { makeRng } from "./rng.js";
import { styleGeneratorProfile } from "./styles/profiles.js";
import type { ComposeSettings } from "./types.js";

describe("buildSongDna", () => {
  it("is deterministic for same seed", () => {
    const a = buildSongDna({
      rng: makeRng(9),
      mode: "aeolian",
      density: 0.7,
    });
    const b = buildSongDna({
      rng: makeRng(9),
      mode: "aeolian",
      density: 0.7,
    });
    assert.deepEqual(a.rhythmGenes, b.rhythmGenes);
    assert.deepEqual(a.hook.contour, b.hook.contour);
    assert.ok(a.progressions.home.slots.length > 0);
  });

  it("assembleSongDna copies style groove feel", () => {
    const settings: ComposeSettings = {
      seed: 1,
      style: "jazz",
      targetBars: 32,
      formFamily: "aaba",
      energyShape: "arch",
      energy: 0.5,
      density: 0.9,
      drumsVsTexture: 0.5,
      variation: 0.3,
      life: 0.5,
      space: 0.4,
      swing: 0.55,
      humanize: 0.8,
      keyPc: 0,
      mode: "dorian",
      tuningRef: "440",
      targetLufs: -14,
    };
    const dna = buildSongDna({
      rng: makeRng(1),
      mode: "dorian",
      density: 0.9,
    });
    const song = assembleSongDna({
      settings,
      style: "jazz",
      keyPc: 0,
      mode: "dorian",
      profile: styleGeneratorProfile("jazz"),
      dna,
    });
    assert.equal(song.groove.feel, "shuffle");
    assert.equal(song.seed, 1);
  });
});
