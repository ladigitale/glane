import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centerWindow, resampleLinear } from "./resample.js";

describe("resampleLinear", () => {
  it("keeps length relation for 48k→16k", () => {
    const pcm = new Float32Array(4800);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20);
    const out = resampleLinear(pcm, 48_000, 16_000);
    assert.equal(out.length, 1600);
  });
});

describe("centerWindow", () => {
  it("returns center slice", () => {
    const pcm = new Float32Array(10);
    for (let i = 0; i < 10; i++) pcm[i] = i;
    const w = centerWindow(pcm, 10, 0.5);
    assert.equal(w.length, 5);
    assert.equal(w[0], 2);
  });
});
