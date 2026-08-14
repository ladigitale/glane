import { normalizePeak } from "./normalize.js";
import { processTextureClip } from "./loop/seamless.js";
import { DSP_THRESHOLDS } from "./config/thresholds.js";
import { computeInterestScore } from "./interest-score.js";
import { autoCropPcm } from "./auto-crop.js";
import {
  characterizePcm,
  type ClipCharacterization,
} from "./characterize.js";
import {
  clampChannelCount,
  durationMsFromPcm,
  mapInterleavedChannels,
  sliceFrames,
  toMonoPcm,
} from "./pcm-layout.js";

export type ProcessJobKind = "oneshot" | "texture";

export type ProcessWorkerRequest = {
  type: "process";
  jobId: string;
  sampleId: string;
  kind: ProcessJobKind;
  sampleRate: number;
  channelCount?: number;
  /** Transferable interleaved Float32 PCM. */
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
      analysis: ClipCharacterization;
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
  channelCount = 1,
): Omit<Extract<ProcessWorkerResponse, { type: "done" }>, "type" | "jobId" | "sampleId"> {
  const ch = clampChannelCount(channelCount);
  const target = DSP_THRESHOLDS.percussive.peakNormDbtp;

  if (kind === "texture") {
    const monoIn = toMonoPcm(pcm, ch);
    const textureMeta = processTextureClip(monoIn, sampleRate);
    const polished = mapInterleavedChannels(pcm, ch, (plane) => {
      const result = processTextureClip(plane, sampleRate);
      return result?.pcm ?? plane;
    });
    if (textureMeta || polished.length > 0) {
      const out = normalizePeak(polished, target);
      const durationMs = durationMsFromPcm(out, sampleRate, ch);
      const loopScore = textureMeta?.loopScore ?? 0.5;
      const xfadeMs = textureMeta?.xfadeMs ?? 40;
      const tags = [
        ...(textureMeta?.tags ?? ["loop-proposed", "seamless", "field-raw"]).filter(
          (t) => t !== "polish-deferred",
        ),
        "peak-norm",
        "processing:done",
      ];
      return packResult({
        pcm: out,
        tags,
        durationMs,
        loopProposed: true,
        loopStartMs: 0,
        loopEndMs: durationMs,
        loopXfadeMs: xfadeMs,
        loopScore,
        interestScore: computeInterestScore({
          pcm: toMonoPcm(out, ch),
          sampleRate,
          kind: "texture",
          loopScore,
        }),
      }, sampleRate, ch);
    }
  }

  let source = pcm;
  const tags = ["peak-norm", "processing:done"];
  if (kind === "oneshot") {
    const mono = toMonoPcm(pcm, ch);
    const cropped = autoCropPcm(mono, sampleRate);
    if (cropped.cropped) {
      source = sliceFrames(pcm, ch, cropped.startSample, cropped.endSample);
      if (cropped.attackCropped) tags.unshift("auto-crop-attack");
      if (cropped.tailCropped) tags.unshift("auto-crop-tail");
    }
  }

  const out = normalizePeak(source, target);
  const durationMs = durationMsFromPcm(out, sampleRate, ch);
  const loopScore = kind === "texture" ? 0.35 : undefined;
  return packResult({
    pcm: out,
    tags,
    durationMs,
    loopProposed: kind === "texture",
    loopStartMs: kind === "texture" ? 0 : undefined,
    loopEndMs: kind === "texture" ? durationMs : undefined,
    loopXfadeMs: kind === "texture" ? 40 : undefined,
    loopScore,
    interestScore: computeInterestScore({
      pcm: toMonoPcm(out, ch),
      sampleRate,
      kind,
      loopScore,
    }),
  }, sampleRate, ch);
}

function packResult(
  result: Omit<
    Extract<ProcessWorkerResponse, { type: "done" }>,
    "type" | "jobId" | "sampleId" | "analysis"
  >,
  sampleRate: number,
  channelCount: number,
): Omit<Extract<ProcessWorkerResponse, { type: "done" }>, "type" | "jobId" | "sampleId"> {
  return {
    ...result,
    analysis: characterizePcm(result.pcm, sampleRate, channelCount),
  };
}
