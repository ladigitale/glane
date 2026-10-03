import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeRng } from "./rng.js";
import {
  bpmCompatible,
  chooseRhythmGenes,
  geneFromOnsetSeconds,
  sampleGeneScore,
} from "./sample-gene.js";
import type { RhythmGene } from "./types.js";

describe("sample-gene", () => {
  it("bpmCompatible accepts half / double", () => {
    assert.equal(bpmCompatible(60, 120), true);
    assert.equal(bpmCompatible(120, 120), true);
    assert.equal(bpmCompatible(240, 120), true);
    assert.equal(bpmCompatible(90, 120), false);
  });

  it("geneFromOnsetSeconds quantizes to 16ths", () => {
    // 120 BPM → bar = 2 s; onsets at 0, 0.25, 0.5, 1.0 → steps 0,2,4,8
    const gene = geneFromOnsetSeconds({
      onsetSec: [0, 0.25, 0.5, 1.0, 2.0, 2.25],
      bpm: 120,
    });
    assert.ok(gene);
    assert.equal(gene!.steps, 16);
    assert.deepEqual(gene!.onsets, [0, 2, 4, 8]);
  });

  it("chooseRhythmGenes puts sample first when on", () => {
    const sample: RhythmGene = {
      steps: 16,
      onsets: [0, 3, 6, 10],
      accents: [1, 0.5, 0.8, 0.5],
    };
    const generated: RhythmGene[] = [
      { steps: 16, onsets: [0, 4, 8, 12], accents: [1, 0.4, 0.7, 0.4] },
    ];
    const pick = chooseRhythmGenes({
      generated,
      sampleGenes: [sample],
      mode: "on",
      rng: makeRng(1),
      path: "t",
    });
    assert.equal(pick.usedSample, true);
    assert.deepEqual(pick.genes[0]!.onsets, sample.onsets);
    assert.ok(pick.warning);
  });

  it("chooseRhythmGenes off ignores samples", () => {
    const sample: RhythmGene = {
      steps: 16,
      onsets: [0, 3, 6, 10],
      accents: [1, 0.5, 0.8, 0.5],
    };
    const generated: RhythmGene[] = [
      { steps: 16, onsets: [0, 4, 8, 12], accents: [1, 0.4, 0.7, 0.4] },
    ];
    const pick = chooseRhythmGenes({
      generated,
      sampleGenes: [sample],
      mode: "off",
      rng: makeRng(1),
      path: "t",
    });
    assert.equal(pick.usedSample, false);
    assert.deepEqual(pick.genes[0]!.onsets, [0, 4, 8, 12]);
  });

  it("sampleGeneScore prefers denser syncopation", () => {
    const sparse: RhythmGene = {
      steps: 16,
      onsets: [0, 8],
      accents: [1, 1],
    };
    const dense: RhythmGene = {
      steps: 16,
      onsets: [0, 3, 5, 7, 10, 13],
      accents: [1, 0.5, 0.5, 0.5, 0.5, 0.5],
    };
    assert.ok(sampleGeneScore(dense) > sampleGeneScore(sparse));
  });
});
