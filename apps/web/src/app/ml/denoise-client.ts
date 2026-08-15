import type {
  DenoiseWorkerRequest,
  DenoiseWorkerResponse,
} from "./denoise-worker-messages.js";

export type DenoiseJobResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (ratio: number) => void;
  kind: "preload" | "denoise";
};

/**
 * RNNoise client via Dedicated Worker (serialized jobs).
 */
export const denoiseClient = (() => {
  let worker: Worker | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const pending = new Map<string, Pending>();

  function jobId(): string {
    seq += 1;
    return `denoise-${seq}`;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./denoise-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<DenoiseWorkerResponse>) => {
      onWorkerMessage(ev.data);
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || "Denoise worker error");
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(err);
      }
      worker = null;
    };
    return worker;
  }

  function onWorkerMessage(msg: DenoiseWorkerResponse): void {
    const p = pending.get(msg.jobId);
    if (!p) return;

    if (msg.type === "progress") {
      if (msg.phase === "running") p.onProgress?.(msg.ratio);
      return;
    }
    if (msg.type === "preloaded") {
      pending.delete(msg.jobId);
      p.resolve(undefined);
      return;
    }
    if (msg.type === "done") {
      pending.delete(msg.jobId);
      p.resolve({
        pcm: msg.pcm,
        sampleRate: msg.sampleRate,
        channelCount: msg.channelCount,
      } satisfies DenoiseJobResult);
      return;
    }
    if (msg.type === "error") {
      pending.delete(msg.jobId);
      p.reject(new Error(msg.message));
    }
  }

  function post(
    req: DenoiseWorkerRequest,
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

    denoise(
      pcm: Float32Array,
      sampleRate: number,
      opts?: {
        channelCount?: number;
        onProgress?: (ratio: number) => void;
      },
    ): Promise<DenoiseJobResult> {
      const run = (): Promise<DenoiseJobResult> =>
        new Promise((resolve, reject) => {
          const id = jobId();
          const copy = new Float32Array(pcm);
          pending.set(id, {
            kind: "denoise",
            resolve: (v) => resolve(v as DenoiseJobResult),
            reject,
            onProgress: opts?.onProgress,
          });
          post(
            {
              type: "denoise",
              jobId: id,
              pcm: copy,
              sampleRate,
              channelCount: opts?.channelCount ?? 1,
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
