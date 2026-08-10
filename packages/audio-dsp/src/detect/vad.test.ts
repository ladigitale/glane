import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateVadPositive } from "./vad.ts";

describe("estimateVadPositive", () => {
  it("flags speech-like mid band", () => {
    assert.equal(
      estimateVadPositive({
        meanZcr: 0.08,
        meanFlatness: 0.35,
        harmonicity: 0.5,
        meanFlux: 0.02,
        meanRms: 0.1,
        durationMs: 800,
        noiseFloorRms: 0.01,
      }),
      true,
    );
  });

  it("rejects percussive flux", () => {
    assert.equal(
      estimateVadPositive({
        meanZcr: 0.08,
        meanFlatness: 0.35,
        harmonicity: 0.5,
        meanFlux: 0.2,
        meanRms: 0.1,
        durationMs: 200,
        noiseFloorRms: 0.01,
      }),
      false,
    );
  });
});
