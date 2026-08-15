import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandSymmetric,
  mulberry32,
  sampleInRange,
  sampleSubtractive,
  rangesFromPivot,
} from "./sample.js";
import { DEFAULT_SUBTRACTIVE_NORM } from "./types.js";

describe("sampleInRange", () => {
  it("stays within bounds (add)", () => {
    const rnd = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const v = sampleInRange(0.2, 0.8, "add", rnd);
      assert.ok(v >= 0.2 - 1e-9 && v <= 0.8 + 1e-9);
    }
  });

  it("stays within bounds (mul)", () => {
    const rnd = mulberry32(2);
    for (let i = 0; i < 50; i++) {
      const v = sampleInRange(0.1, 0.9, "mul", rnd);
      assert.ok(v >= 0.1 - 1e-9 && v <= 0.9 + 1e-9);
    }
  });
});

describe("expandSymmetric", () => {
  it("collapses at randomness 0", () => {
    const { min, max } = expandSymmetric(0.4, 0);
    assert.equal(min, 0.4);
    assert.equal(max, 0.4);
  });
});

describe("sampleSubtractive", () => {
  it("returns all keys in 0–1", () => {
    const ranges = rangesFromPivot(DEFAULT_SUBTRACTIVE_NORM, 0.5);
    const n = sampleSubtractive(ranges, mulberry32(42));
    for (const v of Object.values(n)) {
      assert.ok(v >= 0 && v <= 1);
    }
  });
});
