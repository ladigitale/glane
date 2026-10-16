export * from "./config/thresholds.js";
export * from "./detect/descriptors.js";
export * from "./classify/heuristic.js";
export * from "./loop/optimize.js";
export * from "./loop/seamless.js";
export * from "./loop/ensure-seamless.js";
export * from "./process-job.js";
export * from "./characterize.js";
export * from "./onset-times.js";
export * from "./interest-score.js";
export * from "./detect/vad.js";
export * from "./detect/harmonic-detector.js";
export * from "./segment-pipeline.js";
export * from "./analysis-queue.js";
export * from "./stretch.js";
export * from "./normalize.js";
export * from "./dynamics.js";
export * from "./auto-crop.js";
export {
  EnvelopeHunter,
  liveKindFromEnvelope,
  type CaptureLiveState,
  type Extraction,
  type LiveKindDecision,
  type EnvelopeHunterOpts,
} from "./capture/event-hunter.js";
export {
  DualEventHunter,
  DualEventHunter as EventHunter,
  type DualExtraction,
  type DualHunterOpts,
  type DualHunterResult,
  type DetectionMode,
} from "./capture/dual-event-hunter.js";
export * from "./song-slice.js";
export * from "./pcm-layout.js";
