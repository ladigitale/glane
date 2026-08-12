import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EnvelopeHunter,
  liveKindFromEnvelope,
} from "./event-hunter.ts";
import { DSP_THRESHOLDS } from "../config/thresholds.ts";
import { runProcessJob } from "../process-job.ts";

describe("EnvelopeHunter", () => {
  it("exposes live thresholds 1.5.5", () => {
    assert.equal(DSP_THRESHOLDS.version, "1.5.5");
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

  it("accumulates contiguous deltas without hop-remainder gaps", () => {
    const sr = 48_000;
    const hop = DSP_THRESHOLDS.live.envelopeHop;
    const hunter = new EnvelopeHunter(sr, { openFloorFactor: 1.05 });

    // Quiet floor
    for (let t = 0; t < 4; t++) {
      hunter.analyse(new Float32Array(hop * 4), 1000 + t * 150);
    }

    // Sustained loud tone — feed deltas whose length is NOT a multiple of hop
    // (old bug dropped length % hop every tick → ~150 ms rhythm).
    const chunkLen = hop * 3 + 17;
    let extraction = null as ReturnType<EnvelopeHunter["analyse"]>["extraction"];
    for (let t = 0; t < 40; t++) {
      const delta = new Float32Array(chunkLen);
      for (let i = 0; i < delta.length; i++) {
        delta[i] = 0.4 * Math.sin((2 * Math.PI * 220 * (t * chunkLen + i)) / sr);
      }
      const r = hunter.analyse(delta, 2000 + t * 150);
      if (r.extraction) {
        extraction = r.extraction;
        break;
      }
    }
    // Force close if still open
    if (!extraction) {
      extraction = hunter.flush();
    }
    assert.ok(extraction && extraction.pcm.length > hop * 10);
    // Captured length should be close to fed loud audio (no systematic 17-sample holes)
    const expectedMin = chunkLen * 8;
    assert.ok(
      extraction.pcm.length >= expectedMin * 0.85,
      `expected >= ${expectedMin * 0.85}, got ${extraction.pcm.length}`,
    );
  });

  it("captures a loud burst as an extraction", () => {
    const sr = 48_000;
    const hunter = new EnvelopeHunter(sr, { openFloorFactor: 1.05 });
    const hop = DSP_THRESHOLDS.live.envelopeHop;

    for (let t = 0; t < 3; t++) {
      hunter.analyse(new Float32Array(hop * 8), 1000 + t * 150);
    }

    const burst = new Float32Array(Math.floor(sr * 0.35));
    for (let i = 0; i < burst.length; i++) {
      burst[i] = (i % 2 === 0 ? 0.5 : -0.5) * Math.exp(-i / (sr * 0.12));
    }

    let extraction = null as ReturnType<EnvelopeHunter["analyse"]>["extraction"];
    const step = hop * 4 + 3;
    for (let off = 0; off < burst.length; off += step) {
      const delta = burst.subarray(off, Math.min(burst.length, off + step));
      const r = hunter.analyse(new Float32Array(delta), 2000 + off);
      if (r.extraction) extraction = r.extraction;
    }
    if (!extraction) extraction = hunter.flush();
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
