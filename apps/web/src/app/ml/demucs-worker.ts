/// <reference lib="webworker" />
/**
 * Demucs stem separation off the UI thread (WebGPU when available).
 */
import { DEMUCS_STEMS } from "@glane/audio-ml";
import {
  createDemucsSession,
  DEMUCS_MODEL_URL,
  fetchDemucsModel,
  formatOrtError,
  runDemucsSeparate,
} from "./demucs-runtime.js";
import type {
  DemucsWorkerRequest,
  DemucsWorkerResponse,
} from "./demucs-worker-messages.js";

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

let modelBytes: Uint8Array | null = null;
let busy = false;

function post(msg: DemucsWorkerResponse, transfer?: Transferable[]): void {
  if (transfer?.length) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

async function ensureModel(
  jobId: string,
): Promise<Uint8Array> {
  if (modelBytes && modelBytes.byteLength > 0) {
    post({
      type: "download",
      jobId,
      loaded: modelBytes.byteLength,
      total: modelBytes.byteLength,
    });
    return modelBytes;
  }
  const buf = await fetchDemucsModel(DEMUCS_MODEL_URL, (loaded, total) => {
    post({ type: "download", jobId, loaded, total });
    post({
      type: "progress",
      jobId,
      phase: "loading",
      ratio: total > 0 ? loaded / total : 0,
    });
  });
  modelBytes = new Uint8Array(buf);
  return modelBytes;
}

async function handlePreload(jobId: string): Promise<void> {
  await ensureModel(jobId);
  post({ type: "preloaded", jobId });
}

async function handleSeparate(
  jobId: string,
  pcm: Float32Array,
  sampleRate: number,
): Promise<void> {
  post({ type: "progress", jobId, phase: "loading", ratio: 0 });
  const bytes = await ensureModel(jobId);
  post({ type: "progress", jobId, phase: "running", ratio: 0 });
  const handle = await createDemucsSession(bytes);
  try {
    const result = await runDemucsSeparate(
      handle,
      pcm,
      sampleRate,
      (ratio) => {
        post({ type: "progress", jobId, phase: "running", ratio });
      },
    );
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
  } finally {
    await handle.release();
  }
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
        await handlePreload(msg.jobId);
      } else if (msg.type === "separate") {
        await handleSeparate(msg.jobId, msg.pcm, msg.sampleRate);
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
