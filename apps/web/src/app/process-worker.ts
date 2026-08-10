/// <reference lib="webworker" />
import {
  runProcessJob,
  type ProcessWorkerRequest,
  type ProcessWorkerResponse,
} from "@glane/audio-dsp";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ProcessWorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "process") return;
  try {
    const result = runProcessJob(msg.kind, msg.pcm, msg.sampleRate);
    const response: ProcessWorkerResponse = {
      type: "done",
      jobId: msg.jobId,
      sampleId: msg.sampleId,
      ...result,
    };
    ctx.postMessage(response, [result.pcm.buffer]);
  } catch (e) {
    const response: ProcessWorkerResponse = {
      type: "error",
      jobId: msg.jobId,
      sampleId: msg.sampleId,
      message: e instanceof Error ? e.message : String(e),
    };
    ctx.postMessage(response);
  }
};
