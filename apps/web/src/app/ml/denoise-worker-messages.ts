export type DenoiseWorkerRequest =
  | { type: "preload"; jobId: string }
  | {
      type: "denoise";
      jobId: string;
      pcm: Float32Array;
      sampleRate: number;
      channelCount: number;
    };

export type DenoiseWorkerResponse =
  | { type: "preloaded"; jobId: string }
  | {
      type: "progress";
      jobId: string;
      phase: "loading" | "running";
      ratio: number;
    }
  | {
      type: "done";
      jobId: string;
      pcm: Float32Array;
      sampleRate: number;
      channelCount: number;
    }
  | { type: "error"; jobId: string; message: string };
