import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCoherence,
  beatMs,
  hzToPitchClass,
  midiToHz,
  quantizePitchedParams,
  roleAllowedSemis,
  snapHzToScale,
  tonicHz,
} from "./coherence.js";
import {
  denormalizeFm,
  fundNormToHz as mapFundToHz,
  hzToFundNorm,
} from "./map.js";
import { createRoleCard } from "./roles.js";
import {
  DEFAULT_FM_NORM,
  DEFAULT_PHYSICAL_NORM,
  DEFAULT_SUBTRACTIVE_NORM,
} from "./types.js";

describe("coherence", () => {
  it("computes tonic and beat", () => {
    assert.ok(tonicHz(0, 2) > 60 && tonicHz(0, 2) < 80);
    assert.equal(Math.round(beatMs(120)), 500);
  });

  it("maps Hz to pitch class", () => {
    assert.equal(hzToPitchClass(261.63), 0); // C4
    assert.equal(hzToPitchClass(440), 9); // A4
  });

  it("pinches kick duration under musical coherence", () => {
    const card = createRoleCard("kick", { quantity: 2 });
    const before = card.ranges.duration.max - card.ranges.duration.min;
    const next = applyCoherence(card, {
      kind: "musical",
      tonicPc: 0,
      bpm: 120,
    });
    const after = next.ranges.duration.max - next.ranges.duration.min;
    assert.ok(after <= before + 1e-9);
    assert.ok(next.pivot.fund < 0.4);
  });

  it("recenters fund on tonic when preset band does not overlap", () => {
    const card = createRoleCard("bass", { quantity: 1 });
    // Force a high fund band that won't intersect low tonic
    card.ranges.fund = { min: 0.85, max: 0.95, mode: "mul" };
    const next = applyCoherence(card, {
      kind: "musical",
      tonicPc: 0,
      bpm: 100,
    });
    assert.ok(next.ranges.fund.max < 0.85);
  });

  it("snaps Hz onto tonic only", () => {
    const allowed = [...roleAllowedSemis("lead", "major")!];
    assert.deepEqual(allowed, [0]);
    const e4 = midiToHz(64);
    const snapped = snapHzToScale(e4 * 1.03, 0, allowed, 3, 5);
    const midi = 69 + 12 * Math.log2(snapped / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    assert.equal(pc, 0);
  });

  it("quantizePitchedParams locks fund and kills detune", () => {
    const off = {
      ...DEFAULT_SUBTRACTIVE_NORM,
      fund: hzToFundNorm(233),
      detune: 0.9,
    };
    const { sub } = quantizePitchedParams(
      "bass",
      { kind: "musical", tonicPc: 0, bpm: 120, scaleMode: "major" },
      { sub: off },
    );
    assert.ok(sub);
    assert.equal(sub!.detune, 0.5);
    const hz = mapFundToHz(sub!.fund);
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    assert.equal(pc, 0, `bass pc ${pc} must be tonic C`);
  });

  it("quantize leaves parametric pitches unchanged", () => {
    const off = { ...DEFAULT_SUBTRACTIVE_NORM, fund: 0.77, detune: 0.2 };
    const { sub } = quantizePitchedParams(
      "bass",
      { kind: "parametric", tonicPc: 0, bpm: 120 },
      { sub: off },
    );
    assert.equal(sub!.fund, 0.77);
    assert.equal(sub!.detune, 0.2);
  });

  it("locks physical length to tonic regardless of random sample", () => {
    const wild = {
      ...DEFAULT_PHYSICAL_NORM,
      length: hzToFundNorm(311), // D#ish
      stiffness: 0.9,
    };
    const { physical } = quantizePitchedParams(
      "texture",
      { kind: "musical", tonicPc: 0, bpm: 120 },
      { physical: wild },
    );
    assert.ok(physical);
    const hz = mapFundToHz(physical!.length);
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    assert.equal(pc, 0);
    assert.ok(physical!.stiffness <= 0.25);
  });

  it("snaps FM ratio toward harmonic values by default", () => {
    const weird = { ...DEFAULT_FM_NORM, ratio: 0.73, carrier: 0.5 };
    const { fm } = quantizePitchedParams(
      "lead",
      { kind: "musical", tonicPc: 0, bpm: 120 },
      { fm: weird },
    );
    assert.ok(fm);
    assert.notEqual(fm!.ratio, 0.73);
    const phys = denormalizeFm(fm!);
    const harmonics = [0.5, 1, 2, 3, 4];
    const near = harmonics.some(
      (h) => Math.abs(Math.log(phys.ratio / h)) < 0.05,
    );
    assert.ok(near, `ratio ${phys.ratio} should snap near a harmonic`);
    assert.ok(
      Math.abs(phys.ratio - 1.5) > 0.05,
      "1.5 is clangorous vs other engines — must not be a snap target",
    );
  });

  it("keeps FM ratio free when freeFmRatios is set", () => {
    const weird = { ...DEFAULT_FM_NORM, ratio: 0.73, carrier: 0.5 };
    const { fm } = quantizePitchedParams(
      "lead",
      { kind: "musical", tonicPc: 0, bpm: 120, freeFmRatios: true },
      { fm: weird },
    );
    assert.ok(fm);
    assert.equal(fm!.ratio, 0.73);
    const hz = mapFundToHz(fm!.carrier);
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    assert.equal(pc, 0);
  });
});
