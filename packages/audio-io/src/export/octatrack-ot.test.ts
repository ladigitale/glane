import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { octatrackOt, OT_SLICE_LOOP_OFF } from "./octatrack-ot.js";

describe("octatrackOt.encode", () => {
  it("writes FORM/DPS1SMPA header and fixed 832-byte size", () => {
    const data = octatrackOt.encode({
      totalSamples: 88_200,
      bpm: 120,
      bars: 1,
      slices: [{ start: 0, end: 88_200, loop: OT_SLICE_LOOP_OFF }],
    });
    assert.equal(data.byteLength, 832);
    assert.equal(String.fromCharCode(...data.subarray(0, 4)), "FORM");
    assert.equal(String.fromCharCode(...data.subarray(8, 16)), "DPS1SMPA");
  });

  it("stores tempo as BPM×24 big-endian and valid checksum", () => {
    const data = octatrackOt.encode({
      totalSamples: 88_200,
      bpm: 120,
      bars: 2,
      slices: [
        { start: 0, end: 44_100 },
        { start: 44_100, end: 88_200 },
      ],
    });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    assert.equal(view.getUint32(0x17, false), 120 * 24);
    assert.equal(view.getUint32(0x1b, false), 200); // 2 bars × 100
    assert.equal(view.getUint32(0x32, false), 88_200);
    assert.equal(view.getUint32(0x33a, false), 2);
    assert.equal(view.getUint32(0x3a, false), 0);
    assert.equal(view.getUint32(0x3e, false), 44_100);
    assert.equal(view.getUint32(0x42, false), OT_SLICE_LOOP_OFF);

    let sum = 0;
    for (let i = 16; i < 830; i++) sum = (sum + data[i]!) & 0xffff;
    assert.equal(view.getUint16(0x33e, false), sum);
  });

  it("plans bar groups when bars > 64", () => {
    assert.equal(octatrackOt.barsPerSlice(64), 1);
    assert.equal(octatrackOt.barsPerSlice(65), 2);
    assert.equal(octatrackOt.sliceCountForBars(65), 33);
    const { slices, barsPerSlice, sliceCount } = octatrackOt.slicesForBars({
      bars: 65,
      totalSamples: 65_000,
      samplesPerBar: 1_000,
    });
    assert.equal(barsPerSlice, 2);
    assert.equal(sliceCount, 33);
    assert.equal(slices.length, 33);
    assert.equal(slices[0]!.start, 0);
    assert.equal(slices[0]!.end, 2_000);
    assert.equal(slices.at(-1)!.end, 65_000);
  });
});
