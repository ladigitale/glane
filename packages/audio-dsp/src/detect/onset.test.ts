import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OnsetDetector,
  snapToZeroCrossing,
  snapToRisingZeroCrossing,
} from "./descriptors.ts";

describe("OnsetDetector", () => {
  it("fires on flux spike after quiet", () => {
    const d = new OnsetDetector(48_000);
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      if (d.push(0.001, i)) fired++;
    }
    if (d.push(0.5, 40)) fired++;
    assert.ok(fired >= 1);
  });
});

describe("snapToZeroCrossing", () => {
  it("snaps near a zero crossing", () => {
    const buf = new Float32Array(200);
    for (let i = 0; i < 200; i++) buf[i] = Math.sin((i / 200) * Math.PI * 4);
    const snapped = snapToZeroCrossing(buf, 50, 40);
    const a = buf[snapped - 1] ?? 0;
    const b = buf[snapped] ?? 0;
    assert.ok(a * b <= 0 || Math.abs(b) < 0.05);
  });
});

describe("snapToRisingZeroCrossing", () => {
  it("requires negative→positive rising edge", () => {
    const buf = new Float32Array(200);
    for (let i = 0; i < 200; i++) buf[i] = Math.sin((i / 200) * Math.PI * 4);
    const snapped = snapToRisingZeroCrossing(buf, 100, 80);
    assert.ok((buf[snapped - 1] ?? 0) < 0);
    assert.ok((buf[snapped] ?? 0) > 0);
    assert.ok((buf[snapped - 1] ?? 0) < (buf[snapped] ?? 0));
  });
});
