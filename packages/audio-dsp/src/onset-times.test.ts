import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectOnsetTimesSec } from "./onset-times.js";

describe("detectOnsetTimesSec", () => {
  it("finds spaced clicks", () => {
    const sr = 44100;
    const pcm = new Float32Array(sr); // 1 s silence
    // 4 clicks at 0, 0.25, 0.5, 0.75
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const i = Math.floor(t * sr);
      for (let k = 0; k < 32; k++) pcm[i + k] = 0.9;
    }
    const times = detectOnsetTimesSec(pcm, sr, 1);
    assert.ok(times.length >= 3, `got ${times.length}`);
    assert.ok(times[0]! < 0.08);
  });

  it("returns empty for silence", () => {
    assert.equal(detectOnsetTimesSec(new Float32Array(4096), 44100).length, 0);
  });
});
