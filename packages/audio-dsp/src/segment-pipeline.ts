import type { SampleClass } from "@glane/core-model";
import { DSP_THRESHOLDS } from "./config/thresholds.js";
import {
  AdaptiveNoiseFloor,
  OnsetDetector,
  computeDescriptors,
  findEnergyMinimum,
  hannWindow,
  snapToZeroCrossing,
  type FrameDescriptors,
} from "./detect/descriptors.js";
import { classifyFromDescriptors, durationAllowed } from "./classify/heuristic.js";
import { optimizeLoop } from "./loop/optimize.js";
import { estimateVadPositive } from "./detect/vad.js";

export type DetectedSegment = {
  startSample: number;
  endSample: number;
  class: SampleClass;
  confidence: number;
  classScores: ReturnType<typeof classifyFromDescriptors>["scores"];
  loop?: ReturnType<typeof optimizeLoop>;
};

/** Streaming segmentation over a PCM buffer (T1 path). */
export class SegmentPipeline {
  readonly sampleRate: number;
  readonly window: Float32Array;
  readonly floor: AdaptiveNoiseFloor;
  readonly onset: OnsetDetector;
  #prevSpec: Float32Array | null = null;
  #frameIndex = 0;
  #activeStart: number | null = null;
  #activePeak = 0;
  #fluxSum = 0;
  #flatSum = 0;
  #rmsSum = 0;
  #zcrSum = 0;
  #framesInEvent = 0;
  #lastNoiseFloor = 0;
  #descHistory: FrameDescriptors[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.window = hannWindow(DSP_THRESHOLDS.frameSize);
    this.floor = new AdaptiveNoiseFloor(sampleRate);
    this.onset = new OnsetDetector(sampleRate);
  }

  push(pcm: Float32Array, absoluteOffsetSamples: number): DetectedSegment[] {
    const out: DetectedSegment[] = [];
    const { frameSize, hopSize } = DSP_THRESHOLDS;
    for (let i = 0; i + frameSize <= pcm.length; i += hopSize) {
      const frame = pcm.subarray(i, i + frameSize);
      const { descriptors, spectrumMag } = computeDescriptors(
        frame,
        this.window,
        this.#prevSpec,
      );
      this.#prevSpec = spectrumMag;
      const noiseFloor = this.floor.pushRms(descriptors.rms);
      this.#lastNoiseFloor = noiseFloor;
      const isOnset = this.onset.push(descriptors.spectralFlux, this.#frameIndex);

      if (this.#activeStart == null && isOnset && descriptors.rms > noiseFloor * 2) {
        const back = Math.floor(
          (DSP_THRESHOLDS.backtrackMs / 1000) * this.sampleRate,
        );
        let start = findEnergyMinimum(pcm, i, back);
        start = snapToZeroCrossing(pcm, start);
        this.#activeStart = absoluteOffsetSamples + start;
        this.#activePeak = descriptors.peak;
        this.#fluxSum = 0;
        this.#flatSum = 0;
        this.#rmsSum = 0;
        this.#zcrSum = 0;
        this.#framesInEvent = 0;
        this.#descHistory = [];
      }

      if (this.#activeStart != null) {
        this.#fluxSum += descriptors.spectralFlux;
        this.#flatSum += descriptors.flatness;
        this.#rmsSum += descriptors.rms;
        this.#zcrSum += descriptors.zcr;
        this.#framesInEvent++;
        this.#descHistory.push(descriptors);
        if (descriptors.peak > this.#activePeak) {
          this.#activePeak = descriptors.peak;
        }

        const peakDb = 20 * Math.log10(this.#activePeak + 1e-12);
        const curDb = 20 * Math.log10(descriptors.peak + 1e-12);
        const floorDb = 20 * Math.log10(noiseFloor + 1e-12);
        const dropped =
          curDb < peakDb - DSP_THRESHOLDS.offsetPeakDropDb ||
          curDb < floorDb + DSP_THRESHOLDS.offsetFloorMarginDb;

        if (dropped && this.#framesInEvent > 4) {
          const endLocal = snapToZeroCrossing(pcm, i + frameSize);
          const endSample = absoluteOffsetSamples + endLocal;
          const startSample = this.#activeStart;
          const durationMs =
            ((endSample - startSample) / this.sampleRate) * 1000;
          const attackMs =
            (DSP_THRESHOLDS.hopSize / this.sampleRate) *
            1000 *
            Math.min(4, this.#framesInEvent);
          const mean = (sum: number) => sum / Math.max(1, this.#framesInEvent);
          const harmonicity = 1 - mean(this.#flatSum);
          const vadPositive = estimateVadPositive({
            meanZcr: mean(this.#zcrSum),
            meanFlatness: mean(this.#flatSum),
            harmonicity,
            meanFlux: mean(this.#fluxSum),
            meanRms: mean(this.#rmsSum),
            durationMs,
            noiseFloorRms: this.#lastNoiseFloor,
          });
          const classification = classifyFromDescriptors({
            meanFlux: mean(this.#fluxSum),
            meanFlatness: mean(this.#flatSum),
            meanRms: mean(this.#rmsSum),
            attackMs,
            harmonicity,
            periodicity: 0,
            vadPositive,
            durationMs,
          });

          if (durationAllowed(classification.dominant, durationMs)) {
            const slice = pcm.subarray(
              Math.max(0, startSample - absoluteOffsetSamples),
              Math.max(0, endSample - absoluteOffsetSamples),
            );
            const loop =
              classification.dominant === "texture" ||
              classification.dominant === "noise" ||
              classification.dominant === "tonal"
                ? optimizeLoop(slice, this.sampleRate)
                : null;
            out.push({
              startSample,
              endSample,
              class: classification.dominant,
              confidence: classification.confidence,
              classScores: classification.scores,
              loop: loop ?? undefined,
            });
          }
          this.#activeStart = null;
        }
      }
      this.#frameIndex++;
    }
    return out;
  }
}
