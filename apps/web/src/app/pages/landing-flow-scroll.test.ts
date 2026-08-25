import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BAR_N,
  BAR_SPACING,
  BAR_SPAN,
  PARTICLE_WRAP_X,
  WAVE_SPEED,
  ampForSlot,
  barX,
  createBarTape,
  waveTravel,
  wrapCentered,
} from "./landing-flow-scroll.js";

describe("landing flow scrolling sample bars", () => {
  it("keeps height fixed while a bar slides (no mid-travel morph)", () => {
    const tape = createBarTape();
    const i = 40;
    const t0 = 1.1;
    const t1 = t0 + BAR_SPACING * 0.85;
    tape.sync(t0);
    const h0 = tape.heights[i]!;
    const x0 = barX(i, t0);
    tape.sync(t1);
    const h1 = tape.heights[i]!;
    const x1 = barX(i, t1);
    assert.equal(h0, h1);
    assert.ok(x1 < x0, "bar moves left continuously");
  });

  it("only recycles height when a bar wraps left→right", () => {
    const tape = createBarTape();
    const i = 0;
    tape.sync(0);
    const h0 = tape.heights[i]!;
    // One full span of travel → every bar wraps exactly once.
    tape.sync(BAR_SPAN);
    const h1 = tape.heights[i]!;
    assert.notEqual(h0, h1);
  });

  it("bars cover the wrap span without gaps", () => {
    const travel = waveTravel(12.5, WAVE_SPEED);
    const xs: number[] = [];
    for (let i = 0; i < BAR_N; i++) xs.push(barX(i, travel));
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i]! - xs[i - 1]! < BAR_SPACING * 1.5);
    }
    assert.ok(xs[0]! + BAR_SPAN - xs[xs.length - 1]! < BAR_SPACING * 1.5);
  });

  it("particle wrap stays full-bleed after many loops", () => {
    const wrap = PARTICLE_WRAP_X;
    for (const t of [0, 60, 280, 2800]) {
      for (const s of [0, 0.33, 0.91]) {
        const homeX = (s - 0.5) * (wrap * 0.92);
        const drift = (t * (0.028 + s * 0.014)) % wrap;
        const x = wrapCentered(homeX - drift + 0.42, wrap);
        assert.ok(Math.abs(x) <= wrap / 2 + 1e-9);
      }
    }
  });

  it("sample has firm attacks and silence floor", () => {
    let peak = 0;
    let floorHits = 0;
    for (let i = 0; i < BAR_N; i++) {
      const a = ampForSlot(i);
      peak = Math.max(peak, a);
      if (a < 0.06) floorHits++;
    }
    assert.ok(peak > 0.7, `peak=${peak}`);
    assert.ok(floorHits > 5, `silence gaps=${floorHits}`);
  });

  it("rewinds to the same start position after a cycle reset", () => {
    const tape = createBarTape();
    tape.sync(0);
    const x0 = barX(7, 0);
    const h0 = tape.heights[7]!;
    tape.sync(BAR_SPAN * 3.2);
    tape.sync(0);
    assert.equal(barX(7, 0), x0);
    assert.equal(tape.heights[7]!, h0);
  });
});
