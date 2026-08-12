import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMUCS_N_SAMPLES,
  DEMUCS_STEMS,
  makeTransitionWindow,
  monoToStereo,
  packStereoChunk,
  stereoToMono,
} from "./demucs-math.js";
import { separateOverlapAdd } from "./overlap-add.js";

describe("demucs-math", () => {
  it("builds fade window", () => {
    const w = makeTransitionWindow(100, 20);
    assert.equal(w[0], 0);
    assert.ok((w[10] ?? 0) > 0.4 && (w[10] ?? 0) < 0.6);
    assert.equal(w[50], 1);
  });

  it("packs stereo chunk", () => {
    const L = new Float32Array([1, 2, 3, 4]);
    const R = new Float32Array([5, 6, 7, 8]);
    const out = new Float32Array(2 * 4);
    packStereoChunk(L, R, 1, 3, 4, out);
    assert.equal(out[0], 2);
    assert.equal(out[1], 3);
    assert.equal(out[4], 6);
    assert.equal(out[5], 7);
  });

  it("mono roundtrip mid", () => {
    const m = new Float32Array([0.2, -0.4]);
    const [l, r] = monoToStereo(m);
    const back = stereoToMono(l, r);
    assert.ok(Math.abs((back[0] ?? 0) - 0.2) < 1e-6);
  });
});

describe("separateOverlapAdd", () => {
  it("runs fake infer and returns 4 stems", async () => {
    const n = DEMUCS_N_SAMPLES + 1000;
    const left = new Float32Array(n).fill(0.1);
    const right = new Float32Array(n).fill(-0.05);
    const stems = await separateOverlapAdd(left, right, async (mix) => {
      // Echo mix into all stem rows lightly.
      const flat = new Float32Array(4 * 2 * DEMUCS_N_SAMPLES);
      for (let row = 0; row < 4; row++) {
        for (let c = 0; c < 2; c++) {
          const src = mix.subarray(c * DEMUCS_N_SAMPLES, (c + 1) * DEMUCS_N_SAMPLES);
          flat
            .subarray(
              row * 2 * DEMUCS_N_SAMPLES + c * DEMUCS_N_SAMPLES,
              row * 2 * DEMUCS_N_SAMPLES + (c + 1) * DEMUCS_N_SAMPLES,
            )
            .set(src);
        }
      }
      return flat;
    });
    for (const name of DEMUCS_STEMS) {
      assert.equal(stems[name].left.length, n);
      assert.ok(Math.abs(stems[name].left[10]! - 0.1) < 1e-3);
    }
  });
});
