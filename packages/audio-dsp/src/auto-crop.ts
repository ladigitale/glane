import { DSP_THRESHOLDS } from "./config/thresholds.js";
import {
  findEnergyMinimum,
  snapToZeroCrossing,
} from "./detect/descriptors.js";

export type AutoCropResult = {
  pcm: Float32Array;
  startSample: number;
  endSample: number;
  /** True when bounds differ from the full buffer. */
  cropped: boolean;
  /** Start snapped to a later louder attack. */
  attackCropped: boolean;
  /** Trailing quiet removed. */
  tailCropped: boolean;
};

function frameRms(pcm: Float32Array, a: number, b: number): number {
  let s = 0;
  const n = Math.max(1, b - a);
  for (let i = a; i < b; i++) {
    const v = pcm[i] ?? 0;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

function framePeak(pcm: Float32Array, a: number, b: number): number {
  let p = 0;
  for (let i = a; i < b; i++) {
    const aAbs = Math.abs(pcm[i] ?? 0);
    if (aAbs > p) p = aAbs;
  }
  return p;
}

/**
 * Auto-crop: if the clip opens on quiet pre-roll / false trigger and a much
 * louder attack arrives later, snap the start just before that attack.
 * Also trims a quiet release tail (oneshot-friendly).
 */
export function autoCropPcm(
  pcm: Float32Array,
  sampleRate: number,
): AutoCropResult {
  const cfg = DSP_THRESHOLDS.autoCrop;
  const minSamples = Math.floor((cfg.minDurationMs / 1000) * sampleRate);
  if (pcm.length < Math.max(64, minSamples)) {
    return {
      pcm,
      startSample: 0,
      endSample: pcm.length,
      cropped: false,
      attackCropped: false,
      tailCropped: false,
    };
  }

  const hop = Math.max(
    32,
    Math.floor((cfg.hopMs / 1000) * sampleRate),
  );
  const headFrames = Math.max(
    1,
    Math.ceil(((cfg.headMs / 1000) * sampleRate) / hop),
  );
  const nFrames = Math.max(1, Math.floor(pcm.length / hop));
  const env = new Float32Array(nFrames);
  const peaks = new Float32Array(nFrames);
  let globalPeak = 0;
  for (let f = 0; f < nFrames; f++) {
    const a = f * hop;
    const b = Math.min(pcm.length, a + hop);
    const r = frameRms(pcm, a, b);
    const p = framePeak(pcm, a, b);
    env[f] = r;
    peaks[f] = p;
    if (p > globalPeak) globalPeak = p;
  }

  if (globalPeak < 1e-6) {
    return {
      pcm,
      startSample: 0,
      endSample: pcm.length,
      cropped: false,
      attackCropped: false,
      tailCropped: false,
    };
  }

  let headPeak = 0;
  const headN = Math.min(nFrames, Math.ceil(headFrames));
  for (let f = 0; f < headN; f++) {
    headPeak = Math.max(headPeak, peaks[f] ?? 0);
  }

  let startSample = 0;
  let attackCropped = false;
  const headQuiet = headPeak < globalPeak * cfg.headQuietRelPeak;

  if (headQuiet) {
    const riseLookback = Math.max(1, Math.round(cfg.riseLookbackFrames));
    let attackFrame = -1;
    for (let f = 1; f < nFrames; f++) {
      const p = peaks[f] ?? 0;
      const r = env[f] ?? 0;
      if (p < globalPeak * cfg.attackRelPeak) continue;

      let prevMax = 0;
      for (let k = Math.max(0, f - riseLookback); k < f; k++) {
        prevMax = Math.max(prevMax, env[k] ?? 0);
      }
      const sharpRise = r > prevMax * cfg.rmsRiseFactor;
      const pastHead = f >= headN;
      if (sharpRise || pastHead) {
        attackFrame = f;
        break;
      }
    }

    if (attackFrame > 0) {
      const onsetIndex = Math.min(pcm.length - 1, attackFrame * hop);
      const back = Math.floor((cfg.backtrackMs / 1000) * sampleRate);
      const preRoll = Math.floor((cfg.preRollMs / 1000) * sampleRate);
      let start = findEnergyMinimum(pcm, onsetIndex, back);
      start = Math.max(0, start - preRoll);
      start = snapToZeroCrossing(pcm, start, 48);
      const minLead = Math.floor((cfg.minLeadMs / 1000) * sampleRate);
      if (start >= minLead) {
        startSample = start;
        attackCropped = true;
      }
    }
  }

  // Trailing quiet (relative to remaining peak).
  let endSample = pcm.length;
  let tailCropped = false;
  let remPeak = 0;
  for (let i = startSample; i < pcm.length; i++) {
    const a = Math.abs(pcm[i] ?? 0);
    if (a > remPeak) remPeak = a;
  }
  const silenceFloor = remPeak * cfg.tailSilenceRelPeak;
  const holdFrames = Math.max(
    1,
    Math.round(((cfg.tailHoldMs / 1000) * sampleRate) / hop),
  );
  let below = 0;
  let lastLoud = -1;
  let seenLoud = false;
  for (let f = 0; f < nFrames; f++) {
    const sampleAt = f * hop;
    if (sampleAt < startSample) continue;
    if ((peaks[f] ?? 0) > silenceFloor) {
      below = 0;
      lastLoud = f;
      seenLoud = true;
    } else if (seenLoud) {
      below++;
      if (below >= holdFrames) break;
    }
  }
  if (seenLoud && lastLoud >= 0) {
    const postRoll = Math.floor((cfg.postRollMs / 1000) * sampleRate);
    let end = Math.min(pcm.length, (lastLoud + 1) * hop + postRoll);
    end = snapToZeroCrossing(pcm, Math.max(startSample + 32, end), 64);
    const minTailTrim = Math.floor((cfg.minLeadMs / 1000) * sampleRate);
    // Short oneshots are valid — only require a meaningful silence cut.
    if (pcm.length - end >= minTailTrim && end > startSample + 32) {
      endSample = end;
      tailCropped = true;
    }
  }

  if (!attackCropped && !tailCropped) {
    return {
      pcm,
      startSample: 0,
      endSample: pcm.length,
      cropped: false,
      attackCropped: false,
      tailCropped: false,
    };
  }

  const absMin = Math.max(32, Math.floor((20 / 1000) * sampleRate));
  if (endSample - startSample < absMin) {
    return {
      pcm,
      startSample: 0,
      endSample: pcm.length,
      cropped: false,
      attackCropped: false,
      tailCropped: false,
    };
  }

  const out = new Float32Array(pcm.subarray(startSample, endSample));
  return {
    pcm: out,
    startSample,
    endSample,
    cropped: true,
    attackCropped,
    tailCropped,
  };
}
