import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stretchBuffer, tileBuffer } from "./stretch.ts";
import { resampleLinear } from "./stretch.ts";

describe("resampleLinear", () => {
  it("no-op when rates match", () => {
    const input = new Float32Array([1, 2, 3]);
    const out = resampleLinear(input, 48_000, 48_000);
    assert.deepEqual([...out], [1, 2, 3]);
  });

  it("doubles length when upsampling 2x", () => {
    const input = new Float32Array([0, 1]);
    const out = resampleLinear(input, 24_000, 48_000);
    assert.equal(out.length, 4);
    assert.equal(out[0], 0);
    assert.ok(Math.abs((out[out.length - 1] ?? 0) - 1) < 1e-6);
  });
});

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

  it("preserve-pitch length tracks ratio", () => {
    const input = new Float32Array(8000).map((_, i) => Math.sin((2 * Math.PI * i) / 40));
    const out = stretchBuffer(input, 1.5, "preserve-pitch");
    const expected = Math.floor(input.length / 1.5);
    assert.equal(out.length, expected);
    for (let i = 0; i < out.length; i++) {
      assert.ok(Number.isFinite(out[i]));
    }
  });

  it("preserve-pitch keeps period near identity for mild stretch", () => {
    // 440-ish cycle every 100 samples → count zero-crossings.
    const period = 100;
    const input = new Float32Array(period * 80).map((_, i) =>
      Math.sin((2 * Math.PI * i) / period),
    );
    const out = stretchBuffer(input, 1.25, "preserve-pitch");
    const countZc = (buf: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < buf.length; i++) {
        if ((buf[i - 1]! >= 0) !== (buf[i]! >= 0)) n++;
      }
      return n;
    };
    const inRate = countZc(input) / input.length;
    const outRate = countZc(out) / out.length;
    // Pitch should stay within ~15% (granular WSOLA, not a phase vocoder).
    assert.ok(
      Math.abs(outRate - inRate) / inRate < 0.15,
      `zc rate in=${inRate.toFixed(4)} out=${outRate.toFixed(4)}`,
    );
  });

  it("resample raises pitch when shortening", () => {
    const period = 100;
    const input = new Float32Array(period * 40).map((_, i) =>
      Math.sin((2 * Math.PI * i) / period),
    );
    const out = stretchBuffer(input, 2, "resample");
    const countZc = (buf: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < buf.length; i++) {
        if ((buf[i - 1]! >= 0) !== (buf[i]! >= 0)) n++;
      }
      return n;
    };
    const inRate = countZc(input) / input.length;
    const outRate = countZc(out) / out.length;
    assert.ok(outRate > inRate * 1.5, `expected higher pitch, got ${outRate}/${inRate}`);
  });
});
