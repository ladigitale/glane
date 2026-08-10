import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stretchBuffer, tileBuffer } from "./stretch.ts";

describe("tileBuffer", () => {
  it("loops to fill longer target", () => {
    const input = new Float32Array([1, 2, 3]);
    const out = tileBuffer(input, 7);
    assert.deepEqual([...out], [1, 2, 3, 1, 2, 3, 1]);
  });

  it("truncates when shorter", () => {
    const input = new Float32Array([1, 2, 3, 4]);
    const out = tileBuffer(input, 2);
    assert.deepEqual([...out], [1, 2]);
  });

  it("starts at offset with wrap", () => {
    const input = new Float32Array([1, 2, 3]);
    const out = tileBuffer(input, 4, 2);
    assert.deepEqual([...out], [3, 1, 2, 3]);
  });
});

describe("stretchBuffer", () => {
  it("identity at ratio 1", () => {
    const input = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const out = stretchBuffer(input, 1, "resample");
    assert.equal(out.length, input.length);
    assert.equal(out[2], 1);
  });

  it("resample shortens when ratio > 1", () => {
    const input = new Float32Array(1000).map((_, i) => Math.sin(i / 20));
    const out = stretchBuffer(input, 2, "resample");
    assert.ok(out.length < input.length);
    assert.ok(out.length > input.length / 3);
  });

  it("preserve-pitch produces finite samples", () => {
    const input = new Float32Array(2048).map((_, i) => Math.sin(i / 30));
    const out = stretchBuffer(input, 1.5, "preserve-pitch");
    assert.ok(out.length > 0);
    for (let i = 0; i < out.length; i++) {
      assert.ok(Number.isFinite(out[i]));
    }
  });
});
