import type { SampleClass } from "@glane/core-model";

/** One scored AudioSet-style label from a classifier backend. */
export type AudioLabelScore = {
  label: string;
  score: number;
};

/** Port implemented by MediaPipe YAMNet (or a test double). */
export type AudioClassifierPort = {
  classify(
    pcm: Float32Array,
    sampleRate: number,
  ): Promise<AudioLabelScore[]>;
  dispose?(): void;
};

export type EnrichOptions = {
  /** Min score to keep a yamnet: tag (default 0.12). */
  minScore?: number;
  /** Max yamnet label tags (default 5). */
  maxLabels?: number;
};

export type EnrichResult = {
  tags: string[];
  /** Suggested subclass from top label (slug). */
  subclass?: string;
  /** Soft class hint when YAMNet is confident; caller merges with heuristic. */
  classHint?: SampleClass;
  classHintConfidence?: number;
  labels: AudioLabelScore[];
};
