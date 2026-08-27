import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  platterOmegaFromRotationRate,
  smoothTurntableRate,
  turntableRateFromOmega,
  TURNTABLE_33_DEG_PER_SEC,
} from "./turntable-gyro.js";

describe("turntableRateFromOmega", () => {
  it("33⅓ RPM forward → ~1×", () => {
    const r = turntableRateFromOmega(TURNTABLE_33_DEG_PER_SEC);
    assert.ok(Math.abs(r - 1) < 1e-6, `got ${r}`);
  });

  it("reverse spin → negative rate", () => {
    const r = turntableRateFromOmega(-TURNTABLE_33_DEG_PER_SEC);
    assert.ok(Math.abs(r + 1) < 1e-6, `got ${r}`);
  });

  it("near-zero omega holds", () => {
    assert.equal(turntableRateFromOmega(2), 0);
  });

  it("no max clamp", () => {
    const r = turntableRateFromOmega(TURNTABLE_33_DEG_PER_SEC * 8);
    assert.ok(r > 7.5, `got ${r}`);
  });
});

describe("platterOmegaFromRotationRate", () => {
  it("prefers alpha when present", () => {
    assert.equal(
      platterOmegaFromRotationRate({ alpha: 10, beta: 90, gamma: 90 }),
      10,
    );
  });
});

describe("smoothTurntableRate", () => {
  it("moves toward instant", () => {
    const n = smoothTurntableRate(0, 1, 40);
    assert.ok(n > 0.4 && n < 1, `got ${n}`);
  });
});
