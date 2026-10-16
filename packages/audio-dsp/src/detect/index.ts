export {
  computeDescriptors,
  AdaptiveNoiseFloor,
  OnsetDetector,
  snapToZeroCrossing,
  snapToRisingZeroCrossing,
  findEnergyMinimum,
  type FrameDescriptors,
} from "./descriptors.js";

export { estimateVadPositive } from "./vad.js";

export {
  HarmonicDetector,
  type HarmonicDetectorOpts,
  type HarmonicExtraction,
  type HarmonicLiveState,
} from "./harmonic-detector.js";