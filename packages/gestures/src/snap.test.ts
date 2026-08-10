import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  snapTick,
  clampOverlapStart,
  clampOverlapTrim,
  clipOverlapTicks,
} from "./snap.ts";

describe("snapTick", () => {
  it("snaps to nearest higher-priority target in radius", () => {
    const r = snapTick(
      100,
      [
        { tick: 120, kind: "grid", priority: 4 },
        { tick: 105, kind: "clip-edge", priority: 1 },
      ],
      20,
    );
    assert.equal(r.snapped, true);
    assert.equal(r.tick, 105);
  });
});

describe("clampOverlapStart", () => {
  it("blocks overlap beyond 50% of shorter clip", () => {
    const r = clampOverlapStart(
      { startTick: 80, lengthTick: 100 },
      { startTick: 100, lengthTick: 100 },
    );
    assert.equal(r.blocked, true);
    assert.ok(r.startTick <= 50 || r.startTick >= 80);
  });
});

describe("clipOverlapTicks", () => {
  it("returns overlap window", () => {
    const ov = clipOverlapTicks(
      { startTick: 0, lengthTick: 100 },
      { startTick: 80, lengthTick: 100 },
    );
    assert.deepEqual(ov, { startTick: 80, lengthTick: 20 });
  });
});

describe("clampOverlapTrim", () => {
  it("shrinks end edge past 50%", () => {
    const r = clampOverlapTrim(
      { startTick: 0, lengthTick: 160 },
      { startTick: 100, lengthTick: 100 },
      "end",
      10,
    );
    assert.equal(r.blocked, true);
    // shorter is 100 → max overlap 50 → end at 150 → length 150
    assert.equal(r.lengthTick, 150);
  });
});
