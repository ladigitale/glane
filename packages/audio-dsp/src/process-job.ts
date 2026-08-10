import { normalizePeak } from "./normalize.js";
import { processTextureClip } from "./loop/seamless.js";
import { DSP_THRESHOLDS } from "./config/thresholds.js";

export type ProcessJobKind = "oneshot" | "texture";

export type ProcessWorkerRequest = {
  type: "process";
  jobId: string;
  sampleId: string;
  kind: ProcessJobKind;
  sampleRate: number;
  /** Transferable Float32 PCM. */
  pcm: Float32Array;
};

export type ProcessWorkerResponse =
  | {
      type: "done";
      jobId: string;
      sampleId: string;
      pcm: Float32Array;
      tags: string[];
      durationMs: number;
      loopProposed: boolean;
      loopStartMs?: number;
      loopEndMs?: number;
      loopXfadeMs?: number;
      loopScore?: number;
    }
  | {
      type: "error";
      jobId: string;
      sampleId: string;
      message: string;
    };

/** Pure processing used by the worker (and tests). */
export function runProcessJob(
  kind: ProcessJobKind,
  pcm: Float32Array,
  sampleRate: number,
): Omit<Extract<ProcessWorkerResponse, { type: "done" }>, "type" | "jobId" | "sampleId"> {
  const target = DSP_THRESHOLDS.percussive.peakNormDbtp;

  if (kind === "texture") {
    const polished = processTextureClip(pcm, sampleRate);
    if (polished) {
      // Envelope flatten then peak-norm so waveforms share the same height.
      const out = normalizePeak(polished.pcm, target);
      const durationMs = Math.round((out.length / sampleRate) * 1000);
      return {
        pcm: out,
        tags: [
          ...polished.tags.filter((t) => t !== "polish-deferred"),
          "peak-norm",
          "processing:done",
        ],
        durationMs,
        loopProposed: true,
        loopStartMs: 0,
        loopEndMs: durationMs,
        loopXfadeMs: polished.xfadeMs,
        loopScore: polished.loopScore,
      };
    }
  }

  const out = normalizePeak(pcm, target);
  const durationMs = Math.round((out.length / sampleRate) * 1000);
  return {
    pcm: out,
    tags: ["peak-norm", "processing:done"],
    durationMs,
    loopProposed: kind === "texture",
    loopStartMs: kind === "texture" ? 0 : undefined,
    loopEndMs: kind === "texture" ? durationMs : undefined,
    loopXfadeMs: kind === "texture" ? 40 : undefined,
    loopScore: kind === "texture" ? 0.35 : undefined,
  };
}
