import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asSampleIndex, asTick, samplesToTicks, ticksToSamples } from "./time.ts";
import { PPQ } from "./config.ts";

describe("time conversion", () => {
  it("round-trips one bar at 120 bpm 48k", () => {
    const bpm = 120;
    const sr = 48_000;
    const barTicks = asTick(PPQ * 4);
    const samples = ticksToSamples(barTicks, bpm, sr);
    const back = samplesToTicks(samples, bpm, sr);
    assert.equal(back, barTicks);
    assert.equal(samples, asSampleIndex(sr * 2));
  });
});
