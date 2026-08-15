import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sampleMachineParams,
  usesRoleSynth,
} from "./render-role.js";
import { defaultMachineParams } from "./machines.js";

describe("role synth", () => {
  it("uses dedicated DSP for drums / tonal roles, not pivot or arp", () => {
    assert.equal(usesRoleSynth("kick"), true);
    assert.equal(usesRoleSynth("snare"), true);
    assert.equal(usesRoleSynth("bass"), true);
    assert.equal(usesRoleSynth("pivot"), false);
    assert.equal(usesRoleSynth("arp"), false);
    assert.equal(usesRoleSynth(undefined), false);
  });

  it("samples machine knobs within randomness span", () => {
    const pivot = defaultMachineParams("kick");
    const rnd = () => 0.9;
    const sampled = sampleMachineParams("kick", pivot, 0.8, rnd);
    assert.ok(sampled.body != null);
    assert.ok(sampled.punch != null);
    assert.notEqual(sampled.body, pivot.body);
  });
});
