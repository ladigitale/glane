import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  zoomRatioFromVerticalDelta,
  zoomAroundAnchor,
  applyVerticalZoom,
} from "./zoom.ts";

describe("zoomRatioFromVerticalDelta", () => {
  it("zooms in when finger moves up", () => {
    const r = zoomRatioFromVerticalDelta(-10, 400);
    assert.ok(r > 1);
  });

  it("zooms out when finger moves down", () => {
    const r = zoomRatioFromVerticalDelta(10, 400);
    assert.ok(r < 1);
  });
});

describe("zoomAroundAnchor", () => {
  it("keeps tick under anchor fixed", () => {
    const origin = 100;
    const view = { pxPerTick: 0.1, scrollLeft: 200 };
    const anchor = 150;
    const tick = (view.scrollLeft + anchor - origin) / view.pxPerTick;
    const next = zoomAroundAnchor(view, 0.2, anchor, origin);
    const tick2 = (next.scrollLeft + anchor - origin) / next.pxPerTick;
    assert.ok(Math.abs(tick2 - tick) < 1e-6);
  });
});

describe("applyVerticalZoom", () => {
  it("changes pxPerTick within clamps", () => {
    const v = applyVerticalZoom(
      { pxPerTick: 0.05, scrollLeft: 0 },
      -20,
      400,
      100,
      108,
      0.01,
      2,
    );
    assert.ok(v.pxPerTick > 0.05);
    assert.ok(v.pxPerTick <= 2);
  });
});
