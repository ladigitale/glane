import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  denoiseMonoPcm,
  floatToRnnoisePcm,
  RNNOISE_FRAME_SIZE,
  RNNOISE_PCM_SCALE,
  rnnoisePcmToFloat,
} from "./rnnoise-math.js";

describe("rnnoise math", () => {
  it("round-trips float ↔ PCM scale", () => {
    const frame = new Float32Array([0, 0.5, -1, 1]);
    floatToRnnoisePcm(frame);
    assert.equal(frame[1], 0.5 * RNNOISE_PCM_SCALE);
    assert.equal(frame[2], -RNNOISE_PCM_SCALE);
    rnnoisePcmToFloat(frame);
    assert.ok(Math.abs((frame[1] ?? 0) - 0.5) < 1e-6);
    assert.ok(Math.abs((frame[2] ?? 0) + 1) < 1e-6);
  });

  it("denoiseMonoPcm pads frames and reports progress", () => {
    const pcm = new Float32Array(RNNOISE_FRAME_SIZE * 2 + 17);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 0.01) * 0.2;
    let last = -1;
    const out = denoiseMonoPcm(pcm, 48_000, {
      frameSize: RNNOISE_FRAME_SIZE,
      processFrame: (frame) => {
        // Pass-through identity on PCM scale.
        return 0.5;
      },
    }, {
      onProgress: (r) => {
        assert.ok(r >= last);
        last = r;
      },
    });
    assert.equal(out.length, pcm.length);
    assert.equal(last, 1);
    assert.ok(Math.abs((out[10] ?? 0) - (pcm[10] ?? 0)) < 1e-5);
  });
});
