import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processTextureClip, flattenEnvelope } from "./seamless.ts";

function clickLoopWithTail(
  sampleRate: number,
  bpm: number,
  beats: number,
  quietBeats: number,
): Float32Array {
  const beatSamples = Math.floor((60 / bpm) * sampleRate);
  const active = Math.floor(beats * beatSamples);
  const total = Math.floor((beats + quietBeats) * beatSamples);
  const pcm = new Float32Array(total);
  for (let b = 0; b < Math.ceil(beats); b++) {
    const at = b * beatSamples;
    if (at >= active) break;
    for (let i = 0; i < Math.min(800, active - at); i++) {
      pcm[at + i] =
        Math.sin((2 * Math.PI * 180 * i) / sampleRate) * Math.exp(-i / 120);
    }
  }
  return pcm;
}

describe("processTextureClip", () => {
  it("returns a field-raw section without stacking copies when no period", () => {
    const sr = 48_000;
    const n = sr * 2;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const env = 0.2 + 0.8 * (i / n);
      pcm[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * env;
    }
    const r = processTextureClip(pcm, sr);
    assert.ok(r);
    assert.ok(r!.pcm.length > sr * 0.2);
    assert.ok(r!.pcm.length <= pcm.length);
    assert.ok(r!.tags.includes("seamless"));
    assert.ok(!r!.tags.includes("peak-norm"));
    assert.ok(!r!.tags.includes("envelope-flat"));
  });

  it("crops rhythmic texture to a square loop-period", () => {
    const sr = 48_000;
    const pcm = clickLoopWithTail(sr, 100, 3.65, 2);
    const r = processTextureClip(pcm, sr);
    assert.ok(r);
    assert.ok(r!.tags.includes("loop-period"));
    assert.ok(r!.pcm.length < pcm.length);
    const beat = (60 / 100) * sr;
    const beats = r!.pcm.length / beat;
    assert.ok(Math.abs(beats - 4) < 0.2, `got ${beats.toFixed(3)} beats`);
  });
});

describe("flattenEnvelope", () => {
  it("gently reduces loudness swing without crushing dynamics", () => {
    const sr = 48_000;
    const n = sr;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const env = i < n / 2 ? 0.1 : 0.9;
      pcm[i] = Math.sin((2 * Math.PI * 100 * i) / sr) * env;
    }
    const flat = flattenEnvelope(pcm, sr);
    const hop = Math.floor(sr * 0.05);
    const rms = (from: number) => {
      let s = 0;
      for (let i = from; i < from + hop; i++) s += (flat[i] ?? 0) ** 2;
      return Math.sqrt(s / hop);
    };
    const a = rms(Math.floor(n * 0.2));
    const b = rms(Math.floor(n * 0.7));
    const ratio = Math.max(a, b) / Math.max(1e-9, Math.min(a, b));
    assert.ok(ratio < 6);
    assert.ok(ratio > 1.2);
  });
});
