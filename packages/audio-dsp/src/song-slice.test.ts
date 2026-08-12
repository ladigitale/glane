import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { songSlice } from "./song-slice.ts";

function clickTrain(
  sampleRate: number,
  bpm: number,
  beats: number,
): Float32Array {
  const beatSamples = Math.floor((60 / bpm) * sampleRate);
  const total = beatSamples * beats;
  const pcm = new Float32Array(total);
  for (let b = 0; b < beats; b++) {
    const at = b * beatSamples;
    for (let i = 0; i < Math.min(600, total - at); i++) {
      pcm[at + i] =
        Math.sin((2 * Math.PI * 200 * i) / sampleRate) * Math.exp(-i / 100);
    }
  }
  return pcm;
}

/** Beat pulses + continuous tone — waveform is not period-periodic. */
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

describe("songSlice", () => {
  it("detects ~120 BPM on a click train", () => {
    const sr = 48_000;
    const pcm = clickTrain(sr, 120, 32);
    const tempo = songSlice.detectTempo(pcm, sr);
    assert.ok(tempo, "expected tempo");
    assert.ok(Math.abs(tempo!.bpm - 120) < 4, `bpm ${tempo!.bpm}`);
    assert.ok(tempo!.confidence >= 0.28);
  });

  it("detects tempo on music-like (non-periodic waveform)", () => {
    const sr = 44_100;
    const pcm = musicLike(sr, 100, 48);
    const tempo = songSlice.detectTempo(pcm, sr);
    assert.ok(tempo, "expected tempo on music-like");
    assert.ok(
      Math.abs(tempo!.bpm - 100) < 8,
      `bpm ${tempo!.bpm} (want ~100)`,
    );
  });

  it("maps target density to musical beats", () => {
    assert.equal(songSlice.beatsPerSliceFromTarget(120, 60), 2);
    assert.equal(songSlice.beatsPerSliceFromTarget(120, 15), 8);
    assert.equal(songSlice.beatsPerSliceFromTarget(120, 30), 4);
    assert.equal(songSlice.beatsPerSliceFromTarget(120, 7), 16);
  });

  it("slices a click train on the grid", () => {
    const sr = 48_000;
    const bpm = 120;
    const pcm = clickTrain(sr, bpm, 32);
    const result = songSlice.sliceSong(pcm, sr, { targetPerMin: 15 });
    assert.ok(result);
    assert.equal(result!.beatsPerSlice, 8);
    assert.ok(result!.slices.length >= 3, `got ${result!.slices.length}`);
    const beatSamples = (60 / bpm) * sr;
    const expectedLen = 8 * beatSamples;
    for (const s of result!.slices.slice(0, -1)) {
      const len = s.end - s.start;
      assert.ok(
        Math.abs(len - expectedLen) / expectedLen < 0.12,
        `slice len ${len} vs ${expectedLen}`,
      );
    }
  });

  it("returns null on noise", () => {
    const sr = 16_000;
    const pcm = new Float32Array(sr * 4);
    let s = 0x99aabb;
    for (let i = 0; i < pcm.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      pcm[i] = ((s & 0xffff) / 0x8000 - 1) * 0.2;
    }
    assert.equal(songSlice.detectTempo(pcm, sr), null);
  });
});
