import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TRACK_ADSR,
  DEFAULT_TRACK_FX,
  TRACK_ADSR_ON,
  TRACK_HP_HZ_ON,
  TRACK_HP_HZ_OPEN,
  TRACK_LP_HZ_ON,
  TRACK_LP_HZ_OPEN,
  adsrGain01,
  fitTrackAdsr,
  normalizeTrackFx,
  trackFxHasEnvelope,
  trackFxHasHp,
  trackFxHasLp,
  trackFxHasTone,
  trackFxIsActive,
  trackFxNeedsBus,
  trackFxToggleAdsr,
  trackFxToggleHp,
  trackFxToggleLp,
} from "./schemas.js";

describe("TrackFx tone + envelope", () => {
  it("normalize fills defaults for legacy rows", () => {
    const n = normalizeTrackFx({ type: "reverb", mix: 0.5 });
    assert.equal(n.hpHz, TRACK_HP_HZ_OPEN);
    assert.equal(n.lpHz, TRACK_LP_HZ_OPEN);
    assert.equal(n.attackMs, 0);
    assert.equal(n.decayMs, 0);
    assert.equal(n.sustain, 1);
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

  it("sustain below 1 is an envelope", () => {
    const fx = normalizeTrackFx({ sustain: 0.5 });
    assert.equal(trackFxHasEnvelope(fx), true);
  });

  it("wet insert needs bus", () => {
    const fx = normalizeTrackFx({ type: "echo" });
    assert.equal(trackFxNeedsBus(fx), true);
  });

  it("toggles HP / LP / ADSR independently", () => {
    let fx = DEFAULT_TRACK_FX;
    fx = trackFxToggleHp(fx);
    assert.equal(trackFxHasHp(fx), true);
    assert.equal(fx.hpHz, TRACK_HP_HZ_ON);
    fx = trackFxToggleLp(fx);
    assert.equal(trackFxHasLp(fx), true);
    assert.equal(fx.lpHz, TRACK_LP_HZ_ON);
    fx = trackFxToggleAdsr(fx);
    assert.equal(trackFxHasEnvelope(fx), true);
    assert.equal(fx.attackMs, TRACK_ADSR_ON.attackMs);
    fx = trackFxToggleHp(fx);
    assert.equal(trackFxHasHp(fx), false);
    assert.equal(trackFxHasLp(fx), true);
    fx = trackFxToggleAdsr(fx);
    assert.deepEqual(
      {
        attackMs: fx.attackMs,
        decayMs: fx.decayMs,
        sustain: fx.sustain,
        releaseMs: fx.releaseMs,
      },
      DEFAULT_TRACK_ADSR,
    );
  });
});

describe("ADSR shape", () => {
  it("fits A/D/R into a short clip", () => {
    const fit = fitTrackAdsr(100, 100, 100, 150);
    assert.equal(fit.attackMs, 100);
    assert.equal(fit.releaseMs, 50);
    assert.equal(fit.decayMs, 0);
  });

  it("classic A/R with sustain 1", () => {
    const adsr = { attackMs: 10, decayMs: 0, sustain: 1, releaseMs: 10 };
    assert.equal(adsrGain01(0, 100, adsr), 0);
    assert.equal(adsrGain01(10, 100, adsr), 1);
    assert.equal(adsrGain01(50, 100, adsr), 1);
    assert.ok(Math.abs(adsrGain01(95, 100, adsr) - 0.5) < 1e-9);
    assert.equal(adsrGain01(100, 100, adsr), 0);
  });

  it("decays from peak to sustain", () => {
    const adsr = { attackMs: 10, decayMs: 20, sustain: 0.5, releaseMs: 10 };
    assert.equal(adsrGain01(10, 200, adsr), 1);
    assert.ok(Math.abs(adsrGain01(20, 200, adsr) - 0.75) < 1e-9);
    assert.equal(adsrGain01(30, 200, adsr), 0.5);
    assert.equal(adsrGain01(100, 200, adsr), 0.5);
  });
});
