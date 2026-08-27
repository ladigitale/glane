/// <reference lib="webworker" />
/**
 * YAMNet classify off the UI thread (MediaPipe WASM is sync).
 */
import { createYamnetClassifier } from "./yamnet-mediapipe.js";
import type {
  YamnetWorkerRequest,
  YamnetWorkerResponse,
} from "./yamnet-worker-messages.js";
import type { AudioClassifierPort } from "@glane/audio-ml";

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

let busy = false;
let classifier: AudioClassifierPort | null = null;

function post(msg: YamnetWorkerResponse): void {
  ctx.postMessage(msg);
}

async function ensureClassifier(): Promise<AudioClassifierPort> {
  if (!classifier) classifier = await createYamnetClassifier();
  return classifier;
}

ctx.onmessage = (ev: MessageEvent<YamnetWorkerRequest>) => {
  const msg = ev.data;
  if (!msg?.jobId) return;
  if (busy) {
    post({
      type: "error",
      jobId: msg.jobId,
      message: "YAMNet worker busy",
    });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (msg.type === "preload") {
        await ensureClassifier();
        post({ type: "preloaded", jobId: msg.jobId });
        return;
      }
      if (msg.type === "classify") {
        const c = await ensureClassifier();
        const labels = await c.classify(msg.pcm, msg.sampleRate);
        post({ type: "done", jobId: msg.jobId, labels });
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
