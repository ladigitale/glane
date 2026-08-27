import type { AudioLabelScore } from "@glane/audio-ml";
import type {
  YamnetWorkerRequest,
  YamnetWorkerResponse,
} from "./yamnet-worker-messages.js";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  kind: "preload" | "classify";
};

/**
 * YAMNet client via Dedicated Worker (serialized jobs).
 * Keeps MediaPipe `classify` off the UI thread.
 */
export const yamnetClient = (() => {
  let worker: Worker | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const pending = new Map<string, Pending>();

  function jobId(): string {
    seq += 1;
    return `yamnet-${seq}`;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./yamnet-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<YamnetWorkerResponse>) => {
      onWorkerMessage(ev.data);
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || "YAMNet worker error");
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(err);
      }
      worker = null;
    };
    return worker;
  }

  function onWorkerMessage(msg: YamnetWorkerResponse): void {
    const p = pending.get(msg.jobId);
    if (!p) return;
    if (msg.type === "preloaded") {
      pending.delete(msg.jobId);
      p.resolve(undefined);
      return;
    }
    if (msg.type === "done") {
      pending.delete(msg.jobId);
      p.resolve(msg.labels);
      return;
    }
    if (msg.type === "error") {
      pending.delete(msg.jobId);
      p.reject(new Error(msg.message));
    }
  }

  function post(
    req: YamnetWorkerRequest,
    transfer?: Transferable[],
  ): void {
    const w = ensureWorker();
    if (transfer?.length) w.postMessage(req, transfer);
    else w.postMessage(req);
  }

  return {
    async preload(): Promise<void> {
      const run = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const id = jobId();
          pending.set(id, {
            kind: "preload",
            resolve: () => resolve(),
            reject,
          });
          post({ type: "preload", jobId: id });
        });
      const next = chain.then(run, run);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },

    classify(
      pcm: Float32Array,
      sampleRate: number,
    ): Promise<AudioLabelScore[]> {
      const run = (): Promise<AudioLabelScore[]> =>
        new Promise((resolve, reject) => {
          const id = jobId();
          const copy = new Float32Array(pcm);
          pending.set(id, {
            kind: "classify",
            resolve: (v) => resolve(v as AudioLabelScore[]),
            reject,
          });
          post(
            {
              type: "classify",
              jobId: id,
              pcm: copy,
              sampleRate,
            },
            [copy.buffer],
          );
        });
      const next = chain.then(run, run);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
})();
