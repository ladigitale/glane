import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RollingPcmWindow } from "./rolling-window.js";

describe("RollingPcmWindow", () => {
  it("snapshotFrom returns contiguous deltas", () => {
    const w = new RollingPcmWindow(100);
    w.push(new Float32Array([1, 2, 3, 4, 5]));
    assert.equal(w.totalPushed, 5);

    const a = w.snapshotFrom(0);
    assert.deepEqual([...a.pcm], [1, 2, 3, 4, 5]);
    assert.equal(a.toAbs, 5);

    w.push(new Float32Array([6, 7]));
    const b = w.snapshotFrom(5);
    assert.deepEqual([...b.pcm], [6, 7]);
    assert.equal(b.fromAbs, 5);
    assert.equal(b.toAbs, 7);
  });

  it("snapshotFrom clamps when cursor lags past capacity", () => {
    const w = new RollingPcmWindow(4);
    w.push(new Float32Array([1, 2, 3, 4]));
    w.push(new Float32Array([5, 6])); // oldest 1,2 dropped
    assert.equal(w.oldestAbs, 2);
    const r = w.snapshotFrom(0);
    assert.equal(r.fromAbs, 2);
    assert.deepEqual([...r.pcm], [3, 4, 5, 6]);
  });
});
