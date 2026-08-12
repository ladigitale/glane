import { normalizePeak } from "./normalize.js";
import { processTextureClip } from "./loop/seamless.js";
import { DSP_THRESHOLDS } from "./config/thresholds.js";
import { computeInterestScore } from "./interest-score.js";
import { autoCropPcm } from "./auto-crop.js";

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
      interestScore: number;
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
      // Trim + soften extremities; peak-norm only (no envelope crush).
      const out = normalizePeak(polished.pcm, target);
      const durationMs = Math.round((out.length / sampleRate) * 1000);
      const loopScore = polished.loopScore;
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
        loopScore,
        interestScore: computeInterestScore({
          pcm: out,
          sampleRate,
          kind: "texture",
          loopScore,
        }),
      };
    }
  }

  const cropped = kind === "oneshot" ? autoCropPcm(pcm, sampleRate) : null;
  const source = cropped?.cropped ? cropped.pcm : pcm;
  const out = normalizePeak(source, target);
  const durationMs = Math.round((out.length / sampleRate) * 1000);
  const loopScore = kind === "texture" ? 0.35 : undefined;
  const tags = ["peak-norm", "processing:done"];
  if (cropped?.attackCropped) tags.unshift("auto-crop-attack");
  if (cropped?.tailCropped) tags.unshift("auto-crop-tail");
  return {
    pcm: out,
    tags,
    durationMs,
    loopProposed: kind === "texture",
    loopStartMs: kind === "texture" ? 0 : undefined,
    loopEndMs: kind === "texture" ? durationMs : undefined,
    loopXfadeMs: kind === "texture" ? 40 : undefined,
    loopScore,
    interestScore: computeInterestScore({
      pcm: out,
      sampleRate,
      kind,
      loopScore,
    }),
  };
}
