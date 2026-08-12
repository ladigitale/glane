import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { optimizeLoop } from "./optimize.ts";

/** Click train at `bpm`, then trailing silence — classic non-square capture. */
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

describe("optimizeLoop", () => {
  it("snaps a ~3.7-beat click train to 4 beats when silence remains", () => {
    const sr = 48_000;
    const bpm = 120;
    const pcm = clickLoopWithTail(sr, bpm, 3.7, 1.5);
    const loop = optimizeLoop(pcm, sr);
    assert.ok(loop);
    const beatSamples = (60 / bpm) * sr;
    const beats = (loop!.loopEndSample - loop!.loopStartSample) / beatSamples;
    assert.ok(
      Math.abs(beats - 4) < 0.15,
      `expected ~4 beats, got ${beats.toFixed(3)}`,
    );
    assert.equal(loop!.periodCount, 4);
    assert.ok(loop!.loopScore >= 0.55);
  });

  it("returns null on noise without clear period", () => {
    const sr = 16_000;
    const pcm = new Float32Array(sr * 3);
    // xorshift — flatter spectrum than LCG, less accidental lag peaks
    let s = 0x12345678;
    for (let i = 0; i < pcm.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      pcm[i] = ((s & 0xffff) / 0x8000 - 1) * 0.25;
    }
    assert.equal(optimizeLoop(pcm, sr), null);
  });
});
