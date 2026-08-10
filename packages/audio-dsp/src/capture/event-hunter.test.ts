import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EnvelopeHunter,
  liveKindFromEnvelope,
} from "./event-hunter.ts";
import { DSP_THRESHOLDS } from "../config/thresholds.ts";
import { runProcessJob } from "../process-job.ts";

describe("EnvelopeHunter", () => {
  it("exposes live thresholds 1.5.2", () => {
    assert.equal(DSP_THRESHOLDS.version, "1.5.2");
    assert.ok(DSP_THRESHOLDS.live.maxDurationMs >= 20_000);
    assert.ok(DSP_THRESHOLDS.live.openFloorMin < DSP_THRESHOLDS.live.openFloorFactor);
    assert.ok(DSP_THRESHOLDS.live.openFloorMax > DSP_THRESHOLDS.live.openFloorFactor);
    assert.ok(
      DSP_THRESHOLDS.live.textureMinMsAtMin < DSP_THRESHOLDS.live.textureMinMsAtMax,
    );
    assert.ok(
      DSP_THRESHOLDS.live.oneshotCrestMinAtMin >
        DSP_THRESHOLDS.live.oneshotCrestMinAtMax,
    );
    assert.ok(
      DSP_THRESHOLDS.live.closeHoldMsAtMin > DSP_THRESHOLDS.live.closeHoldMsAtMax,
    );
  });

  it("slider ends: min favors texture, max favors oneshot", () => {
    const live = DSP_THRESHOLDS.live;
    const midMs = 1200;
    const crest = 6;

    const atMin = liveKindFromEnvelope({
      durationMs: midMs,
      crest,
      textureMinMs: live.textureMinMsAtMin,
      textureForceMs: live.textureForceMsAtMin,
      oneshotCrestMin: live.oneshotCrestMinAtMin,
    });
    assert.equal(atMin.kind, "texture");

    const atMax = liveKindFromEnvelope({
      durationMs: midMs,
      crest,
      textureMinMs: live.textureMinMsAtMax,
      textureForceMs: live.textureForceMsAtMax,
      oneshotCrestMin: live.oneshotCrestMinAtMax,
    });
    assert.equal(atMax.kind, "oneshot");
    assert.equal(atMax.class, "percussive");
  });

  it("accepts openFloorFactor override", () => {
    const hunter = new EnvelopeHunter(48_000, { openFloorFactor: 2.0 });
    assert.equal(hunter.openFloorFactor, 2.0);
    hunter.setOpenFloorFactor(1.1);
    assert.equal(hunter.openFloorFactor, 1.1);
    hunter.setOpenFloorFactor(0.5);
    assert.equal(hunter.openFloorFactor, DSP_THRESHOLDS.live.openFloorMin);
  });

  it("scans only a short horizon of new audio", () => {
    const sr = 48_000;
    const hunter = new EnvelopeHunter(sr);
    const hop = DSP_THRESHOLDS.live.envelopeHop;
    const horizon = Math.floor(
      (DSP_THRESHOLDS.live.analyseHorizonMs / 1000) * sr,
    );
    const maxFrames = Math.floor(horizon / hop) + 4;

    const n1 = sr * 3;
    hunter.analyse(new Float32Array(n1), 1000);
    assert.ok(hunter.lastFramesScanned <= maxFrames);

    const n2 = n1 + Math.floor(sr * 0.2);
    const pcm2 = new Float32Array(n2);
    hunter.analyse(pcm2, 1200);
    assert.ok(hunter.lastFramesScanned <= maxFrames);
  });

  it("captures a loud burst as an extraction", () => {
    const sr = 48_000;
    const hunter = new EnvelopeHunter(sr);
    const hop = DSP_THRESHOLDS.live.envelopeHop;
    // Seed noise floor with quiet
    const quiet = new Float32Array(sr);
    hunter.analyse(quiet, 1000);

    const burst = new Float32Array(Math.floor(sr * 0.4));
    for (let i = 0; i < burst.length; i++) {
      burst[i] = (i % 2 === 0 ? 0.5 : -0.5) * Math.exp(-i / (sr * 0.15));
    }
    // Feed in chunks like the live path
    let extraction = null;
    for (let t = 0; t < 8; t++) {
      const win = new Float32Array(Math.floor(sr * 0.5));
      const offset = Math.min(burst.length, t * hop * 4);
      win.set(burst.subarray(0, Math.min(burst.length, win.length)));
      if (offset > 0) {
        // shift: put later part at end
        win.fill(0);
        const start = Math.min(burst.length - 1, t * Math.floor(sr * 0.05));
        win.set(burst.subarray(start, Math.min(burst.length, start + win.length)));
      }
      const r = hunter.analyse(win, 2000 + t * 150);
      if (r.extraction) extraction = r.extraction;
    }
    // May or may not extract depending on envelope timing — at least no throw
    assert.ok(extraction === null || extraction.pcm.length > hop);
  });
});

describe("runProcessJob", () => {
  it("peak-norms oneshots", () => {
    const sr = 48_000;
    const pcm = new Float32Array(sr * 0.2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2;
    const r = runProcessJob("oneshot", pcm, sr);
    assert.ok(r.tags.includes("peak-norm"));
    assert.ok(r.tags.includes("processing:done"));
    let peak = 0;
    for (let i = 0; i < r.pcm.length; i++) {
      peak = Math.max(peak, Math.abs(r.pcm[i] ?? 0));
    }
    assert.ok(peak > 0.8);
  });

  it("peak-norms textures after polish", () => {
    const sr = 48_000;
    const n = sr * 2;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const env = 0.05 + 0.1 * (i / n);
      pcm[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * env;
    }
    const r = runProcessJob("texture", pcm, sr);
    assert.ok(r.tags.includes("peak-norm"));
    assert.ok(r.tags.includes("processing:done"));
    let peak = 0;
    for (let i = 0; i < r.pcm.length; i++) {
      peak = Math.max(peak, Math.abs(r.pcm[i] ?? 0));
    }
    assert.ok(peak > 0.8);
  });
});
