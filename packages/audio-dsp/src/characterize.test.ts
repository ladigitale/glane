import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { characterizePcm } from "./characterize.ts";

function sine(
  sampleRate: number,
  hz: number,
  seconds: number,
  amp = 0.5,
): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const pcm = new Float32Array(n);
  const w = (2 * Math.PI * hz) / sampleRate;
  for (let i = 0; i < n; i++) pcm[i] = amp * Math.sin(w * i);
  return pcm;
}

describe("characterizePcm", () => {
  it("reads pitch and note of a 440 Hz sine", () => {
    const sr = 48_000;
    const r = characterizePcm(sine(sr, 440, 0.5), sr);
    assert.ok(r.pitchHz != null, "expected pitch");
    assert.ok(
      Math.abs((r.pitchHz ?? 0) - 440) < 20,
      `pitch ${r.pitchHz}`,
    );
    assert.equal(r.noteName, "A4");
    assert.ok(r.harmonicity > 0.35, `harmonicity ${r.harmonicity}`);
    assert.ok(r.centroidHz > 200 && r.centroidHz < 900, `centroid ${r.centroidHz}`);
    assert.ok(r.peakDbtp < 0);
    assert.ok(r.lufs < 0);
  });

  it("marks clicks as transient, not pitched", () => {
    const sr = 48_000;
    const pcm = new Float32Array(sr * 0.4);
    const width = Math.floor(sr * 0.003);
    for (const atMs of [40, 120, 200, 280]) {
      const at = Math.floor((atMs / 1000) * sr);
      for (let i = 0; i < width && at + i < pcm.length; i++) {
        pcm[at + i] = 0.9 * Math.sin((Math.PI * i) / width);
      }
    }
    const r = characterizePcm(pcm, sr);
    assert.ok(r.transientDensity > 0.15, `transients ${r.transientDensity}`);
    assert.ok(
      r.pitchHz == null || r.harmonicity < 0.45,
      `unexpected stable pitch ${r.pitchHz}`,
    );
  });
});
