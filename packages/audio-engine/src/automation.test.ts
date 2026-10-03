import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoParamUnits, autoValueAt, dbToLin } from "./automation.js";

describe("autoValueAt", () => {
  it("holds before first / after last", () => {
    const pts = [
      { sample: 100, value: 0, curve: "lin" as const },
      { sample: 200, value: 10, curve: "lin" as const },
    ];
    assert.equal(autoValueAt(pts, 0), 0);
    assert.equal(autoValueAt(pts, 300), 10);
  });

  it("lerps lin midpoints", () => {
    const pts = [
      { sample: 0, value: 0, curve: "lin" as const },
      { sample: 100, value: 10, curve: "lin" as const },
    ];
    assert.ok(Math.abs(autoValueAt(pts, 50) - 5) < 1e-9);
  });

  it("steps until next point", () => {
    const pts = [
      { sample: 0, value: 2, curve: "step" as const },
      { sample: 100, value: 8, curve: "lin" as const },
    ];
    assert.equal(autoValueAt(pts, 50), 2);
  });
});

describe("autoParamUnits", () => {
  it("applies dB offset on base gain", () => {
    assert.ok(Math.abs(autoParamUnits("gainDb", 0, 1) - 1) < 1e-9);
    assert.ok(Math.abs(autoParamUnits("gainDb", 6, 1) - dbToLin(6)) < 1e-9);
  });
});
