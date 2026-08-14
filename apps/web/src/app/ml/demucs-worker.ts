/// <reference lib="webworker" />
/**
 * Demucs FT bag stem separation off the UI thread (WebGPU when available).
 * Loads one specialist at a time to keep peak RAM down.
 */
import { DEMUCS_STEMS, type DemucsStemName } from "@glane/audio-ml";
import {
  formatOrtError,
  preloadDemucsModels,
  runDemucsSeparate,
} from "./demucs-runtime.js";
import type {
  DemucsWorkerRequest,
  DemucsWorkerResponse,
} from "./demucs-worker-messages.js";

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

let busy = false;

function post(msg: DemucsWorkerResponse, transfer?: Transferable[]): void {
  if (transfer?.length) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

function normalizeStems(
  stems: DemucsStemName[] | undefined,
): DemucsStemName[] {
  if (!stems?.length) return [...DEMUCS_STEMS];
  return stems.filter((s) => DEMUCS_STEMS.includes(s));
}

async function handlePreload(
  jobId: string,
  stems: DemucsStemName[],
): Promise<void> {
  const n = stems.length;
  await preloadDemucsModels(stems, (loaded, total, stem) => {
    const idx = stems.indexOf(stem);
    const base = Math.max(0, idx) / n;
    const chunk = total > 0 ? loaded / total / n : 0;
    post({ type: "download", jobId, loaded, total });
    post({
      type: "progress",
      jobId,
      phase: "loading",
      ratio: Math.min(1, base + chunk),
    });
  });
  post({ type: "preloaded", jobId });
}

async function handleSeparate(
  jobId: string,
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
  stems?: DemucsStemName[],
): Promise<void> {
  const stemNames = normalizeStems(stems);
  post({ type: "progress", jobId, phase: "loading", ratio: 0 });
  await preloadDemucsModels(stemNames, (loaded, total, stem) => {
    const idx = stemNames.indexOf(stem);
    const base = Math.max(0, idx) / stemNames.length;
    const chunk = total > 0 ? loaded / total / stemNames.length : 0;
    post({ type: "download", jobId, loaded, total });
    post({
      type: "progress",
      jobId,
      phase: "loading",
      ratio: Math.min(1, base + chunk),
    });
  });
  post({ type: "progress", jobId, phase: "running", ratio: 0 });
  const result = await runDemucsSeparate(pcm, sampleRate, channelCount, {
    stems: stemNames,
    onProgress: (ratio) => {
      post({ type: "progress", jobId, phase: "running", ratio });
    },
  });
  const transfer = DEMUCS_STEMS.map((name) => result.stems[name].buffer);
  post(
    {
      type: "done",
      jobId,
      sampleRate: result.sampleRate,
      stems: result.stems,
      backend: result.backend,
    },
    transfer,
  );
}

ctx.onmessage = (ev: MessageEvent<DemucsWorkerRequest>) => {
  const msg = ev.data;
  if (!msg?.type || !msg.jobId) return;
  if (busy) {
    post({
      type: "error",
      jobId: msg.jobId,
      message: "Demucs worker busy",
    });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (msg.type === "preload") {
        await handlePreload(msg.jobId, normalizeStems(msg.stems));
      } else if (msg.type === "separate") {
        await handleSeparate(
          msg.jobId,
          msg.pcm,
          msg.sampleRate,
          msg.channelCount ?? 1,
          msg.stems,
        );
      }
    } catch (e) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: formatOrtError(e),
      });
    } finally {
      busy = false;
    }
  })();
};
