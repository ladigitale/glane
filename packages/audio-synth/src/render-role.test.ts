import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultMachineParams,
  filterTypeFromNorm,
  filterTypeToNorm,
} from "./machines.js";
import { sampleMachineParams, usesRoleSynth } from "./render-role.js";

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

  it("maps filtType norm to classic biquads", () => {
    assert.equal(filterTypeFromNorm(0), "lowpass");
    assert.equal(filterTypeFromNorm(0.99), "peaking");
    assert.equal(filterTypeFromNorm(filterTypeToNorm("bandpass")), "bandpass");
  });

  it("includes filter ADSR defaults on every role machine", () => {
    const kick = defaultMachineParams("kick");
    assert.ok((kick.filtEnv ?? 0) > 0);
    assert.ok(kick.filtAtk != null);
    assert.ok(kick.filtDec != null);
    assert.ok(kick.filtSus != null);
    assert.ok(kick.filtRel != null);
    assert.equal(filterTypeFromNorm(kick.filtType ?? 0), "lowpass");
  });
});
