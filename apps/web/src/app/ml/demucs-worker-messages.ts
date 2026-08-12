import type { DemucsStemName } from "@glane/audio-ml";

export type DemucsWorkerRequest =
  | { type: "preload"; jobId: string }
  | {
      type: "separate";
      jobId: string;
      pcm: Float32Array;
      sampleRate: number;
    };

export type DemucsWorkerResponse =
  | {
      type: "download";
      jobId: string;
      loaded: number;
      total: number;
    }
  | {
      type: "progress";
      jobId: string;
      phase: "loading" | "running";
      ratio: number;
    }
  | { type: "preloaded"; jobId: string }
  | {
      type: "done";
      jobId: string;
      sampleRate: number;
      stems: Record<DemucsStemName, Float32Array>;
      backend: string;
    }
  | { type: "error"; jobId: string; message: string };
