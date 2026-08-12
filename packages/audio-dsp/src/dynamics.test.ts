import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { noiseGate, softCompress } from "./dynamics.ts";

describe("noiseGate", () => {
  it("passes loud signal above threshold", () => {
    const input = new Float32Array(2000);
    input.fill(0.5);
    const out = noiseGate(input, 48_000, {
      thresholdDb: -20,
      attackMs: 1,
      releaseMs: 10,
    });
    const tail = out.subarray(out.length - 200);
    const mean =
      [...tail].reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, tail.length);
    assert.ok(mean > 0.4, `expected open gate, got mean=${mean}`);
  });

  it("attenuates quiet signal below threshold", () => {
    const input = new Float32Array(4000);
    input.fill(0.01); // ≈ −40 dBFS
    const out = noiseGate(input, 48_000, {
      thresholdDb: -20,
      attackMs: 1,
      releaseMs: 5,
      floor: 0,
    });
    const tail = out.subarray(out.length - 500);
    const peak = Math.max(...tail.map(Math.abs));
    assert.ok(peak < 0.002, `expected closed gate, got peak=${peak}`);
  });

  it("keeps length", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const out = noiseGate(input, 48_000, {
      thresholdDb: -40,
      attackMs: 5,
      releaseMs: 50,
    });
    assert.equal(out.length, input.length);
  });
});

describe("softCompress", () => {
  it("reduces peaks above threshold", () => {
    const input = new Float32Array(3000);
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 2 === 0 ? 0.9 : -0.9;
    }
    const out = softCompress(input, 48_000, {
      thresholdDb: -12,
      ratio: 4,
      attackMs: 1,
      releaseMs: 20,
      kneeDb: 0,
      makeupDb: 0,
    });
    const tail = out.subarray(out.length - 200);
    const outPeak = Math.max(...tail.map(Math.abs));
    assert.ok(outPeak < 0.5, `expected compressed tail, got peak=${outPeak}`);
  });
});
