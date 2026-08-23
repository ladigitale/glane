import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bpmFromTags,
  buildAutoSampleName,
  extraFromTags,
  formatNameDuration,
} from "./sample-auto-name.js";

describe("formatNameDuration", () => {
  it("keeps ms under 1s", () => {
    assert.equal(formatNameDuration(340), "340ms");
  });
  it("uses seconds above 1s", () => {
    assert.equal(formatNameDuration(1200), "1.2s");
    assert.equal(formatNameDuration(10_000), "10s");
  });
});

describe("buildAutoSampleName", () => {
  it("puts useful metadata in order", () => {
    assert.equal(
      buildAutoSampleName({
        captureName: "Rue",
        class: "tonal",
        subclass: "music",
        noteName: "A3",
        bpm: 96,
        durationMs: 1200,
        loopProposed: true,
      }),
      "Rue · music · A3 · 96bpm · 1.2s · boucle",
    );
  });

  it("reads slice/bpm from tags", () => {
    assert.equal(
      buildAutoSampleName({
        captureName: "Album",
        class: "rhythmic",
        durationMs: 1900,
        tags: ["song-slice", "bpm:128", "slice:3/16"],
      }),
      "Album · slice 3/16 · rhythmic · 128bpm · 1.9s",
    );
  });

  it("skips empty capture", () => {
    assert.equal(
      buildAutoSampleName({
        class: "percussive",
        durationMs: 80,
      }),
      "percussive · 80ms",
    );
  });
});

describe("tag helpers", () => {
  it("parses bpm and slice tags", () => {
    assert.equal(bpmFromTags(["bpm:120"]), 120);
    assert.equal(extraFromTags(["slice:2/8"]), "slice 2/8");
    assert.equal(extraFromTags(["whole"]), "whole");
  });
});
