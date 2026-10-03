import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TRACK_FX } from "@glane/core-model";
import { mixcheckPlan } from "./generative-mixcheck.js";
import type { SequencePlanResult } from "./generative.js";

describe("mixcheckPlan", () => {
  it("flags empty clips", () => {
    const r = mixcheckPlan({ clips: [], tracks: [] });
    assert.ok(r.some((w) => w.includes("empty")));
  });

  it("flags track without clips", () => {
    const plan: SequencePlanResult = {
      clips: [
        {
          trackId: "a",
          sampleId: "s",
          startTick: 0,
          lengthTick: 480,
          contentOffsetMs: 0,
          gainDb: 0,
          loopEnabled: false,
          fadeInMs: 0,
          fadeOutMs: 0,
          fadeCurve: "linear",
          pitchSemitones: 0,
          stretchMode: "off",
          reverse: false,
        },
      ],
      tracks: [
        { trackId: "a", gainDb: 0, pan: 0, fx: { ...DEFAULT_TRACK_FX } },
        { trackId: "b", gainDb: 0, pan: 0, fx: { ...DEFAULT_TRACK_FX } },
      ],
    };
    const w = mixcheckPlan(plan);
    assert.ok(w.some((x) => x.includes("track b")));
  });
});
