import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durationMsFromPcm,
  frameCount,
  interleave,
  reverseInterleaved,
  toMonoPcm,
} from "./pcm-layout.js";

describe("pcm-layout", () => {
  it("frameCount and duration for stereo", () => {
    const pcm = new Float32Array([1, 2, 3, 4, 5, 6]);
    assert.equal(frameCount(pcm, 2), 3);
    assert.equal(durationMsFromPcm(pcm, 1000, 2), 3);
  });

  it("toMono mid", () => {
    const pcm = new Float32Array([1, 3, 5, 7]);
    assert.deepEqual([...toMonoPcm(pcm, 2)], [2, 6]);
  });

  it("reverse keeps L/R order", () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    assert.deepEqual([...reverseInterleaved(pcm, 2)], [3, 4, 1, 2]);
  });

  it("interleave roundtrip", () => {
    const L = new Float32Array([1, 3]);
    const R = new Float32Array([2, 4]);
    assert.deepEqual([...interleave([L, R])], [1, 2, 3, 4]);
  });
});
