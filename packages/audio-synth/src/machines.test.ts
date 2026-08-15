import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bakeMachine,
  clampMachineParams,
  defaultMachineParams,
  machineSpecFor,
} from "./machines.js";
import { applyCardMachine, createRoleCard, rolePresetPivots } from "./roles.js";

describe("machines", () => {
  it("exposes 4 knobs for kick", () => {
    const spec = machineSpecFor("kick");
    assert.ok(spec);
    assert.equal(spec.knobs.length, 4);
    assert.deepEqual(
      spec.knobs.map((k) => k.id),
      ["body", "punch", "click", "length"],
    );
  });

  it("neutral knobs leave preset pivots unchanged", () => {
    const base = rolePresetPivots("kick");
    const baked = bakeMachine("kick", defaultMachineParams("kick"), base);
    assert.equal(baked.pivot.fund, base.pivot.fund);
    assert.equal(baked.pivot.drive, base.pivot.drive);
    assert.equal(baked.pivotNoise.density, base.pivotNoise.density);
  });

  it("punch raises drive and shortens amp decay on kick", () => {
    const base = rolePresetPivots("kick");
    const machine = clampMachineParams("kick", {
      ...defaultMachineParams("kick"),
      punch: 1,
    });
    const baked = bakeMachine("kick", machine, base);
    assert.ok(baked.pivot.drive > base.pivot.drive);
    assert.ok(baked.pivot.ampDecay < base.pivot.ampDecay);
  });

  it("applyCardMachine refreshes pivots from machine knobs", () => {
    const card = createRoleCard("snare", { quantity: 3 });
    card.machine = { ...card.machine, snare: 1, length: 0.1 };
    const next = applyCardMachine(card);
    assert.ok(next.pivotNoise.density > card.pivotNoise.density);
    assert.ok(next.pivot.duration < rolePresetPivots("snare").pivot.duration);
  });

  it("family cards start with engineUi off and machine defaults", () => {
    const card = createRoleCard("bass");
    assert.equal(card.engineUi, false);
    assert.equal(card.machine.tone, 0.5);
    assert.ok(card.engines.includes("subtractive"));
  });
});
