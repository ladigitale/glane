import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeInterestScore } from "./interest-score.js";

describe("computeInterestScore", () => {
  const sr = 48_000;

  it("scores silence near zero", () => {
    const pcm = new Float32Array(sr * 0.2);
    const s = computeInterestScore({ pcm, sampleRate: sr, kind: "oneshot" });
    assert.ok(s < 0.15);
  });

  it("scores a punchy burst higher than quiet noise", () => {
    const burst = new Float32Array(Math.floor(sr * 0.2));
    for (let i = 0; i < 400; i++) burst[i] = (i % 2 === 0 ? 1 : -1) * 0.9;
    for (let i = 400; i < burst.length; i++) {
      burst[i] = (Math.random() * 2 - 1) * 0.02 * Math.exp(-(i - 400) / 2000);
    }
    const noise = new Float32Array(burst.length);
    for (let i = 0; i < noise.length; i++) {
      noise[i] = (Math.random() * 2 - 1) * 0.01;
    }
    const a = computeInterestScore({
      pcm: burst,
      sampleRate: sr,
      kind: "oneshot",
      confidence: 0.7,
    });
    const b = computeInterestScore({
      pcm: noise,
      sampleRate: sr,
      kind: "oneshot",
      confidence: 0.4,
    });
    assert.ok(a > b + 0.15, `expected ${a} >> ${b}`);
  });
});
