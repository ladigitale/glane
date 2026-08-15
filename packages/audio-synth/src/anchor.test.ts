import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorFromAnalysis } from "./anchor.js";

describe("anchorFromAnalysis", () => {
  it("maps pitch and duration", () => {
    const n = anchorFromAnalysis({
      durationMs: 500,
      pitchHz: 220,
      centroidHz: 2000,
      harmonicity: 0.8,
      transientDensity: 0.9,
    });
    assert.ok(n.fund > 0 && n.fund < 1);
    assert.ok(n.duration > 0 && n.duration < 1);
    assert.ok(n.ampAttack < 0.3);
  });

  it("falls back without analysis fields", () => {
    const n = anchorFromAnalysis({ durationMs: 200 });
    assert.ok(n.fund >= 0 && n.fund <= 1);
  });
});
