import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processTextureClip, flattenEnvelope } from "./seamless.ts";

describe("processTextureClip", () => {
  it("returns a field-raw section without stacking copies", () => {
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
    // No repetition: output must not exceed the source section
    assert.ok(r!.pcm.length <= pcm.length);
    assert.ok(r!.tags.includes("field-raw"));
    assert.ok(r!.tags.includes("seamless"));
    assert.ok(!r!.tags.includes("peak-norm"));
    assert.ok(!r!.tags.includes("envelope-flat"));
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
    // Soft maxBoost≈4: quieter half rises, but not to near-equality
    const ratio = Math.max(a, b) / Math.max(1e-9, Math.min(a, b));
    assert.ok(ratio < 6);
    assert.ok(ratio > 1.2);
  });
});
