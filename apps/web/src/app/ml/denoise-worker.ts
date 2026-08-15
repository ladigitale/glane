/**
 * RNNoise denoise off the UI thread.
 */
import { preloadRnnoise, runRnnoiseDenoise } from "./denoise-runtime.js";
import type {
  DenoiseWorkerRequest,
  DenoiseWorkerResponse,
} from "./denoise-worker-messages.js";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let busy = false;

function post(msg: DenoiseWorkerResponse, transfer?: Transferable[]): void {
  if (transfer?.length) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

async function handleDenoise(
  jobId: string,
  pcm: Float32Array,
  sampleRate: number,
  channelCount: number,
): Promise<void> {
  post({ type: "progress", jobId, phase: "loading", ratio: 0 });
  await preloadRnnoise();
  post({ type: "progress", jobId, phase: "loading", ratio: 1 });
  const result = await runRnnoiseDenoise(pcm, sampleRate, channelCount, {
    onProgress: (ratio) =>
      post({ type: "progress", jobId, phase: "running", ratio }),
  });
  post(
    {
      type: "done",
      jobId,
      pcm: result.pcm,
      sampleRate: result.sampleRate,
      channelCount: result.channelCount,
    },
    [result.pcm.buffer],
  );
}

ctx.onmessage = (ev: MessageEvent<DenoiseWorkerRequest>) => {
  const msg = ev.data;
  if (!msg?.jobId) return;
  if (busy) {
    post({
      type: "error",
      jobId: msg.jobId,
      message: "Denoise worker busy",
    });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (msg.type === "preload") {
        await preloadRnnoise();
        post({ type: "preloaded", jobId: msg.jobId });
      } else if (msg.type === "denoise") {
        await handleDenoise(
          msg.jobId,
          msg.pcm,
          msg.sampleRate,
          msg.channelCount,
        );
      }
    } catch (e) {
      post({
        type: "error",
        jobId: msg.jobId,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      busy = false;
    }
  })();
};
