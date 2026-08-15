import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { denormalizeFm, denormalizeNoise } from "./map.js";
import { DEFAULT_FM_NORM, DEFAULT_NOISE_NORM } from "./types.js";

describe("denormalizeFm", () => {
  it("maps ratio and index to physical ranges", () => {
    const p = denormalizeFm(DEFAULT_FM_NORM);
    assert.ok(p.carrierHz > 20 && p.carrierHz < 2000);
    assert.ok(p.ratio >= 0.25 && p.ratio <= 8);
    assert.ok(p.index >= 0 && p.index <= 12);
  });
});

describe("denormalizeNoise", () => {
  it("maps color and cutoffs", () => {
    const p = denormalizeNoise(DEFAULT_NOISE_NORM);
    assert.ok(["white", "pink", "brown"].includes(p.color));
    assert.ok(p.lpHz > p.hpHz || p.lpHz > 80);
  });
});
