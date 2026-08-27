import type { AudioLabelScore } from "@glane/audio-ml";

export type YamnetWorkerRequest =
  | { type: "preload"; jobId: string }
  | {
      type: "classify";
      jobId: string;
      /** Mono PCM. */
      pcm: Float32Array;
      sampleRate: number;
    };

export type YamnetWorkerResponse =
  | { type: "preloaded"; jobId: string }
  | {
      type: "done";
      jobId: string;
      labels: AudioLabelScore[];
    }
  | { type: "error"; jobId: string; message: string };
