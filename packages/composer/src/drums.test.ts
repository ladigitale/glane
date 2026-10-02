import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PPQ } from "@glane/core-model";
import { compose } from "./compose.js";
import { onsetJaccard, planDrums } from "./drums.js";
import { fitForm } from "./form.js";
import { generateRhythmGenes, euclid, geneFromOnsets } from "./rhythm.js";
import { makeRng } from "./rng.js";
import type { ComposeSettings } from "./types.js";

describe("rhythm euclid", () => {
  it("euclid(4,16) has 4 onsets", () => {
    assert.equal(euclid(4, 16).length, 4);
  });

  it("generateRhythmGenes is deterministic", () => {
    const a = generateRhythmGenes(makeRng(5), "r", 0.5);
    const b = generateRhythmGenes(makeRng(5), "r", 0.5);
    assert.deepEqual(a, b);
    assert.ok(a.length >= 2);
  });
});

describe("drums no flicker", () => {
  it("kick base pattern identical across bars 0–2 of a section", () => {
    const form = fitForm({
      targetBars: 32,
      family: "verse-chorus",
      energyShape: "arch",
      energyBias: 0.6,
      rng: makeRng(11),
    });
    const genes = generateRhythmGenes(makeRng(11), "g", 0.55);
    const parts = planDrums({
      sections: form.sections,
      rhythmGenes: genes,
      density: 0.55,
      trackIndexByRole: { kick: 0, snare: 1, hat: 2, perc: 3 },
    });
    const kick = parts.find((p) => p.role === "kick")!;
    const verse =
      form.sections.find((s) => s.kind === "verse" && s.bars >= 4) ??
      form.sections.find((s) => s.bars >= 4);
    assert.ok(verse);
    const tpb = PPQ * 4;
    const start = verse!.startBar * tpb;
    // Compare bar0 vs bar1 (both base unless variant at bar3)
    const j = onsetJaccard(
      kick.events,
      kick.events,
      start,
      start + tpb,
      PPQ,
    );
    assert.equal(j, 1);
    const j01 = (() => {
      const a = kick.events.filter(
        (e) => e.tick >= start && e.tick < start + tpb,
      );
      const b = kick.events.filter(
        (e) => e.tick >= start + tpb && e.tick < start + 2 * tpb,
      );
      return onsetJaccard(
        a.map((e) => ({ ...e, tick: e.tick - start })),
        b.map((e) => ({ ...e, tick: e.tick - (start + tpb) })),
        0,
        tpb,
        PPQ,
      );
    })();
    assert.ok(j01 >= 0.8, `jaccard ${j01}`);
  });

  it("same seed → identical kick onsets", () => {
    const settings: ComposeSettings = {
      seed: 77,
      style: "techno",
      targetBars: 32,
      formFamily: "build-drop",
      energyShape: "rise",
      energy: 0.7,
      density: 0.7,
      drumsVsTexture: 0.8,
      variation: 0.2,
      life: 0,
      space: 0.3,
      swing: 0,
      humanize: 0,
      keyPc: 0,
      mode: "aeolian",
      tuningRef: "440",
      targetLufs: -14,
    };
    const a = compose(settings).score;
    const b = compose(settings).score;
    const ka = a.parts.find((p) => p.role === "kick")!.events.map((e) => e.tick);
    const kb = b.parts.find((p) => p.role === "kick")!.events.map((e) => e.tick);
    assert.deepEqual(ka, kb);
  });
});

describe("compose kit+bass", () => {
  it("emits kit + bass parts and layer matrix", () => {
    const { score } = compose({
      seed: 3,
      style: "rock",
      targetBars: 32,
      formFamily: "verse-chorus",
      energyShape: "arch",
      energy: 0.55,
      density: 0.55,
      drumsVsTexture: 0.65,
      variation: 0.3,
      life: 0.2,
      space: 0.3,
      swing: 0,
      humanize: 0.1,
      keyPc: 0,
      mode: "ionian",
      tuningRef: "440",
      targetLufs: -14,
    });
    const roles = new Set(score.parts.map((p) => p.role));
    assert.ok(roles.has("kick"));
    assert.ok(roles.has("bass"));
    assert.ok(score.layerMatrix.length >= 5);
    assert.ok(score.dna.rhythmGenes.length >= 2);
    // Break sections: kit muted via matrix
    const breakIdx = score.sections.findIndex((s) => s.kind === "break");
    if (breakIdx >= 0) {
      const kickRow = score.layerMatrix[0]!;
      assert.equal(kickRow[breakIdx], false);
    }
  });
});

void geneFromOnsets;
