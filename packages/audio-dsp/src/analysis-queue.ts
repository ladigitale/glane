import {
  SegmentPipeline,
  type DetectedSegment,
} from "./segment-pipeline.js";

export type AnalysisJob = {
  pcm: Float32Array;
  absoluteOffsetSamples: number;
};

export type AnalysisQueueStats = {
  pending: number;
  dropped: number;
  deferredToT2: number;
  processed: number;
};

/**
 * Bounded T1 analysis queue — never blocks capture.
 * If full, defer to T2 instead of stalling the audio path.
 */
export class BoundedAnalysisQueue {
  readonly maxJobs: number;
  readonly pipeline: SegmentPipeline;
  readonly stats: AnalysisQueueStats = {
    pending: 0,
    dropped: 0,
    deferredToT2: 0,
    processed: 0,
  };

  #queue: AnalysisJob[] = [];
  #busy = false;
  #onSegment: (seg: DetectedSegment) => void;
  #onDeferred?: (job: AnalysisJob) => void;

  constructor(
    sampleRate: number,
    onSegment: (seg: DetectedSegment) => void,
    opts?: { maxJobs?: number; onDeferred?: (job: AnalysisJob) => void },
  ) {
    this.pipeline = new SegmentPipeline(sampleRate);
    this.maxJobs = opts?.maxJobs ?? 8;
    this.#onSegment = onSegment;
    this.#onDeferred = opts?.onDeferred;
  }

  push(job: AnalysisJob): void {
    if (this.#queue.length >= this.maxJobs) {
      this.stats.dropped++;
      this.stats.deferredToT2++;
      this.#onDeferred?.(job);
      return;
    }
    this.#queue.push({
      pcm: job.pcm.slice(),
      absoluteOffsetSamples: job.absoluteOffsetSamples,
    });
    this.stats.pending = this.#queue.length;
    void this.#pump();
  }

  async #pump(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    while (this.#queue.length > 0) {
      const job = this.#queue.shift();
      this.stats.pending = this.#queue.length;
      if (!job) break;
      const segs = this.pipeline.push(job.pcm, job.absoluteOffsetSamples);
      for (const seg of segs) this.#onSegment(seg);
      this.stats.processed++;
      await Promise.resolve();
    }
    this.#busy = false;
  }
}
