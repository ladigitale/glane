import { DEMUCS_STEMS, type DemucsStemName } from "@glane/audio-ml";
import type {
  DemucsWorkerRequest,
  DemucsWorkerResponse,
} from "./demucs-worker-messages.js";

export type SeparateJobResult = {
  sampleRate: number;
  stems: Record<DemucsStemName, Float32Array>;
  backend?: string;
};

export { DEMUCS_MODEL_URL, DEMUCS_FT_MODEL_URLS } from "./demucs-runtime.js";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (ratio: number) => void;
  onDownload?: (loaded: number, total: number) => void;
  kind: "preload" | "separate";
};

/**
 * Demucs FT bag client via Dedicated Worker (WebGPU-first inside the worker).
 * One specialist session at a time; released after each stem.
 */
export const demucsClient = (() => {
  let worker: Worker | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const pending = new Map<string, Pending>();

  function jobId(): string {
    seq += 1;
    return `demucs-${seq}`;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./demucs-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<DemucsWorkerResponse>) => {
      onWorkerMessage(ev.data);
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || "Demucs worker error");
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(err);
      }
      worker = null;
    };
    return worker;
  }

  function onWorkerMessage(msg: DemucsWorkerResponse): void {
    const p = pending.get(msg.jobId);
    if (!p) return;

    if (msg.type === "download") {
      p.onDownload?.(msg.loaded, msg.total);
      return;
    }
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
        sampleRate: msg.sampleRate,
        stems: msg.stems,
        backend: msg.backend,
      } satisfies SeparateJobResult);
      return;
    }
    if (msg.type === "error") {
      pending.delete(msg.jobId);
      p.reject(new Error(msg.message));
    }
  }

  function post(
    req: DemucsWorkerRequest,
    transfer?: Transferable[],
  ): void {
    const w = ensureWorker();
    if (transfer?.length) w.postMessage(req, transfer);
    else w.postMessage(req);
  }

  return {
    /** Prefetch FT specialist weights into Cache Storage. */
    async preload(opts?: {
      stems?: readonly DemucsStemName[];
      onDownload?: (loaded: number, total: number) => void;
    }): Promise<void> {
      const run = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const id = jobId();
          pending.set(id, {
            kind: "preload",
            resolve: () => resolve(),
            reject,
            onDownload: opts?.onDownload,
          });
          post({
            type: "preload",
            jobId: id,
            stems: opts?.stems ? [...opts.stems] : undefined,
          });
        });
      const next = chain.then(run, run);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },

    separate(
      pcm: Float32Array,
      sampleRate: number,
      opts?: {
        channelCount?: number;
        stems?: readonly DemucsStemName[];
        onProgress?: (ratio: number) => void;
        onDownload?: (loaded: number, total: number) => void;
      },
    ): Promise<SeparateJobResult> {
      const run = (): Promise<SeparateJobResult> =>
        new Promise((resolve, reject) => {
          const id = jobId();
          const copy = new Float32Array(pcm);
          pending.set(id, {
            kind: "separate",
            resolve: (v) => resolve(v as SeparateJobResult),
            reject,
            onProgress: opts?.onProgress,
            onDownload: opts?.onDownload,
          });
          post(
            {
              type: "separate",
              jobId: id,
              pcm: copy,
              sampleRate,
              channelCount: opts?.channelCount ?? 1,
              stems: opts?.stems ? [...opts.stems] : undefined,
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

    stemNames: DEMUCS_STEMS,
  };
})();
