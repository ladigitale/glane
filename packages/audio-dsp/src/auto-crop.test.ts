import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoCropPcm } from "./auto-crop.js";

function clickAt(
  pcm: Float32Array,
  sampleRate: number,
  atMs: number,
  amp = 0.9,
  widthMs = 3,
): void {
  const at = Math.floor((atMs / 1000) * sampleRate);
  const w = Math.max(2, Math.floor((widthMs / 1000) * sampleRate));
  for (let i = 0; i < w && at + i < pcm.length; i++) {
    const t = i / w;
    pcm[at + i] = amp * Math.sin(Math.PI * t);
  }
}

describe("autoCropPcm", () => {
  it("snaps start to a later loud attack after quiet pre-roll", () => {
    const sr = 48_000;
    const pcm = new Float32Array(sr * 0.4);
    // Quiet false trigger at start
    for (let i = 0; i < sr * 0.04; i++) pcm[i] = 0.02 * Math.sin(i * 0.1);
    clickAt(pcm, sr, 120, 0.95);

    const r = autoCropPcm(pcm, sr);
    assert.equal(r.attackCropped, true);
    assert.ok(r.startSample > sr * 0.05);
    assert.ok(r.startSample < sr * 0.12);
    assert.ok(r.pcm.length < pcm.length);
  });

  it("leaves a clip alone when attack is already at the head", () => {
    const sr = 48_000;
    const pcm = new Float32Array(sr * 0.25);
    clickAt(pcm, sr, 5, 0.9);
    for (let i = Math.floor(sr * 0.02); i < pcm.length; i++) {
      pcm[i] = 0.05 * Math.exp(-(i / sr) * 12) * Math.sin(i * 0.4);
    }

    const r = autoCropPcm(pcm, sr);
    assert.equal(r.attackCropped, false);
  });

  it("trims a long quiet tail", () => {
    const sr = 48_000;
    const pcm = new Float32Array(sr * 0.5);
    clickAt(pcm, sr, 10, 0.85);
    // Silence for the rest (tiny noise)
    for (let i = Math.floor(sr * 0.08); i < pcm.length; i++) {
      pcm[i] = 0.0005 * Math.sin(i);
    }

    const r = autoCropPcm(pcm, sr);
    assert.equal(r.tailCropped, true);
    assert.ok(r.endSample < pcm.length * 0.5);
  });
});
