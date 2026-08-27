import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  scrubRateToTarget,
  TAPE_SCRUB_CATCHUP_S,
  TAPE_SCRUB_SNAP_SAMPLES,
} from "./tape-scrub.js";

describe("scrubRateToTarget", () => {
  it("1× when error equals catchup window of samples", () => {
    const sr = 48_000;
    const err = sr * TAPE_SCRUB_CATCHUP_S;
    assert.ok(Math.abs(scrubRateToTarget(err, sr) - 1) < 1e-6);
  });

  it("reverse when target is behind audio", () => {
    const sr = 48_000;
    const err = -sr * TAPE_SCRUB_CATCHUP_S;
    assert.ok(Math.abs(scrubRateToTarget(err, sr) + 1) < 1e-6);
  });

  it("snaps to 0 when within snap distance", () => {
    assert.equal(scrubRateToTarget(TAPE_SCRUB_SNAP_SAMPLES, 48_000), 0);
    assert.equal(scrubRateToTarget(0, 48_000), 0);
  });

  it("has no max clamp — large error → large rate", () => {
    const sr = 48_000;
    const rate = scrubRateToTarget(sr * 2, sr); // 2s gap / catchup
    assert.ok(rate > 50, `got ${rate}`);
  });

  it("returns 0 for bad inputs", () => {
    assert.equal(scrubRateToTarget(1000, 0), 0);
    assert.equal(scrubRateToTarget(Number.NaN, 48_000), 0);
  });
});
