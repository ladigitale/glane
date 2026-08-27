import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DSP_THRESHOLDS } from "@glane/audio-dsp";
import { slicePreview, type SlicePreviewHit } from "./slice-preview.js";
import { INTEREST_CULL } from "./interest-cull-plan.js";

function toneBurst(
  sampleRate: number,
  startSec: number,
  durSec: number,
  totalSec: number,
  amp = 0.5,
): Float32Array {
  const n = Math.floor(totalSec * sampleRate);
  const pcm = new Float32Array(n);
  const a = Math.floor(startSec * sampleRate);
  const b = Math.min(n, a + Math.floor(durSec * sampleRate));
  for (let i = a; i < b; i++) {
    pcm[i] = amp * Math.sin((2 * Math.PI * 220 * (i - a)) / sampleRate);
  }
  return pcm;
}

function mix(into: Float32Array, add: Float32Array): Float32Array {
  const n = Math.min(into.length, add.length);
  for (let i = 0; i < n; i++) into[i] = (into[i] ?? 0) + (add[i] ?? 0);
  return into;
}

function musicLike(
  sampleRate: number,
  bpm: number,
  beats: number,
): Float32Array {
  const beatSamples = Math.floor((60 / bpm) * sampleRate);
  const total = beatSamples * beats;
  const pcm = new Float32Array(total);
  let s = 0xdeadbeef;
  for (let i = 0; i < total; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const noise = ((s & 0xffff) / 0x8000 - 1) * 0.04;
    const tone =
      Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.12 +
      Math.sin((2 * Math.PI * 330 * i) / sampleRate) * 0.06;
    pcm[i] = tone + noise;
  }
  for (let b = 0; b < beats; b++) {
    const at = b * beatSamples;
    for (let i = 0; i < Math.min(900, total - at); i++) {
      pcm[at + i]! +=
        Math.sin((2 * Math.PI * 80 * i) / sampleRate) * Math.exp(-i / 180) * 0.9;
    }
  }
  return pcm;
}

describe("slicePreview", () => {
  it("whole mode keeps a single full-file region", async () => {
    const sr = 8_000;
    const pcm = new Float32Array(sr * 2);
    pcm[10] = 0.2;
    const result = await slicePreview.analyze({
      pcm,
      sampleRate: sr,
      channelCount: 1,
      mode: "whole",
      targetPerMin: 12,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.regions.length, 1);
    assert.equal(result.kept, 1);
    assert.equal(result.regions[0]?.startFrame, 0);
    assert.equal(result.regions[0]?.endFrame, pcm.length);
    assert.equal(result.regions[0]?.kept, true);
  });

  it("culls lowest interest first and never below minKeep", () => {
    const hits: SlicePreviewHit[] = Array.from({ length: 20 }, (_, i) => ({
      startFrame: i * 100,
      endFrame: i * 100 + 80,
      class: "percussive",
      kind: "oneshot",
      interestScore: i / 20,
      durationMs: 80,
    }));
    const durationMs = 60_000;
    const regions = slicePreview.applyCull(hits, durationMs, 12);
    const kept = regions.filter((r) => r.kept);
    assert.ok(kept.length >= INTEREST_CULL.minKeep);
    assert.ok(kept.length < hits.length);
    const dropped = regions.filter((r) => !r.kept);
    const maxDropped = Math.max(...dropped.map((r) => r.interestScore), 0);
    const minKept = Math.min(...kept.map((r) => r.interestScore));
    assert.ok(maxDropped <= minKept);
  });

  it("song mode returns grid slices whose count follows density", async () => {
    const sr = 44_100;
    const pcm = musicLike(sr, 120, 32);
    const coarse = await slicePreview.analyze({
      pcm,
      sampleRate: sr,
      channelCount: 1,
      mode: "song",
      targetPerMin: 15,
    });
    const dense = await slicePreview.analyze({
      pcm,
      sampleRate: sr,
      channelCount: 1,
      mode: "song",
      targetPerMin: 60,
      tempo: coarse.tempo,
    });
    assert.equal(coarse.error, undefined);
    assert.equal(dense.error, undefined);
    assert.ok((coarse.regions.length ?? 0) >= 2);
    assert.ok(dense.regions.length > coarse.regions.length);
    assert.ok((coarse.bpm ?? 0) > 80);
    for (const r of coarse.regions) {
      assert.ok(r.kept);
      assert.ok(r.endFrame > r.startFrame);
      assert.ok(r.endFrame <= pcm.length);
    }
  });

  it("hunt mode detects bursts and reculls without a second pass", async () => {
    const sr = 16_000;
    const hop = DSP_THRESHOLDS.live.envelopeHop;
    const floor = new Float32Array(hop * 8);
    const pcm = new Float32Array(sr * 6);
    mix(pcm, floor);
    for (let i = 0; i < 4; i++) {
      mix(pcm, toneBurst(sr, 0.6 + i * 1.1, 0.18, 6, 0.7));
    }
    const first = await slicePreview.analyze({
      pcm,
      sampleRate: sr,
      channelCount: 1,
      mode: "hunt",
      targetPerMin: 60,
      openFloorFactor: DSP_THRESHOLDS.live.openFloorMin,
    });
    assert.ok(first.regions.length >= 2, `got ${first.regions.length}`);
    for (const r of first.regions) {
      assert.ok(r.endFrame > r.startFrame);
      assert.ok(r.startFrame >= 0);
      assert.ok(r.endFrame <= pcm.length);
    }
    const hits = first.regions.map((r) => ({
      startFrame: r.startFrame,
      endFrame: r.endFrame,
      class: r.class,
      kind: r.kind,
      interestScore: r.interestScore,
      durationMs: r.durationMs,
    }));
    const recull = await slicePreview.analyze({
      pcm,
      sampleRate: sr,
      channelCount: 1,
      mode: "hunt",
      targetPerMin: 2,
      huntHits: hits,
    });
    assert.equal(recull.regions.length, first.regions.length);
    assert.ok(recull.kept <= first.kept);
  });
});
