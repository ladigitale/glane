import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TRACK_FX,
  TRACK_HP_HZ_OPEN,
  TRACK_LP_HZ_OPEN,
  normalizeTrackFx,
  trackFxHasEnvelope,
  trackFxHasTone,
  trackFxIsActive,
  trackFxNeedsBus,
} from "./schemas.js";

describe("TrackFx tone + envelope", () => {
  it("normalize fills defaults for legacy rows", () => {
    const n = normalizeTrackFx({ type: "reverb", mix: 0.5 });
    assert.equal(n.hpHz, TRACK_HP_HZ_OPEN);
    assert.equal(n.lpHz, TRACK_LP_HZ_OPEN);
    assert.equal(n.attackMs, 0);
    assert.equal(n.releaseMs, 0);
    assert.equal(n.mix, 0.5);
  });

  it("default is inactive", () => {
    assert.equal(trackFxIsActive(DEFAULT_TRACK_FX), false);
    assert.equal(trackFxNeedsBus(DEFAULT_TRACK_FX), false);
  });

  it("tone alone needs bus", () => {
    const fx = normalizeTrackFx({ hpHz: 120 });
    assert.equal(trackFxHasTone(fx), true);
    assert.equal(trackFxNeedsBus(fx), true);
    assert.equal(trackFxIsActive(fx), true);
  });

  it("envelope alone is active but no bus", () => {
    const fx = normalizeTrackFx({ attackMs: 40, releaseMs: 80 });
    assert.equal(trackFxHasEnvelope(fx), true);
    assert.equal(trackFxNeedsBus(fx), false);
    assert.equal(trackFxIsActive(fx), true);
  });

  it("wet insert needs bus", () => {
    const fx = normalizeTrackFx({ type: "echo" });
    assert.equal(trackFxNeedsBus(fx), true);
  });
});
