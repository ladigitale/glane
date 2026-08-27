/**
 * Dry-run file slicing — same hunt / song / whole path as import, no persist.
 */
import type { SampleClass } from "@glane/core-model";
import {
  DSP_THRESHOLDS,
  EventHunter,
  computeInterestScore,
  durationMsFromPcm,
  frameCount,
  songSlice,
  toMonoPcm,
  type Extraction,
  type TempoEstimate,
} from "@glane/audio-dsp";
import type { FileProcessMode } from "./db.js";
import { INTEREST_CULL, targetKeepCount } from "./interest-cull-plan.js";
import {
  durationPassesSliceFilter,
  resolveSliceDurationFilter,
} from "./slice-duration.js";

/** Same cap as import-for-hunt — full decode stays in RAM. */
const MAX_DURATION_SEC = 30 * 60;

export type SlicePreviewHit = {
  startFrame: number;
  endFrame: number;
  class: SampleClass;
  kind: "oneshot" | "texture";
  interestScore: number;
  durationMs: number;
};

export type SlicePreviewRegion = SlicePreviewHit & { kept: boolean };

export type SlicePreviewError = "empty" | "too-long" | "no-tempo";

export type SlicePreviewResult = {
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  mode: FileProcessMode;
  bpm?: number;
  beatsPerSlice?: number;
  tempo?: TempoEstimate;
  regions: SlicePreviewRegion[];
  kept: number;
  culled: number;
  error?: SlicePreviewError;
};

export type SlicePreviewAnalyzeOpts = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
  mode: FileProcessMode;
  targetPerMin: number;
  openFloorFactor?: number;
  minDurationMs?: number | null;
  maxDurationMs?: number | null;
  /** Skip tempo detection when song-slicing the same file again. */
  tempo?: TempoEstimate | null;
  /** Cached hunt hits — only recull when density changes. */
  huntHits?: SlicePreviewHit[] | null;
  signal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("Aborted", "AbortError");
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function hitFromExtraction(
  extraction: Extraction,
  channelCount: number,
  sampleRate: number,
  totalFrames: number,
  closedAtInterleaved: number,
): SlicePreviewHit | null {
  const frames = frameCount(extraction.pcm, channelCount);
  if (frames < 1) return null;
  const endFrame = Math.min(
    totalFrames,
    Math.max(frames, Math.floor(closedAtInterleaved / Math.max(1, channelCount))),
  );
  const startFrame = Math.max(0, endFrame - frames);
  if (endFrame <= startFrame) return null;
  return {
    startFrame,
    endFrame,
    class: extraction.class,
    kind: extraction.kind,
    durationMs: durationMsFromPcm(
      extraction.pcm,
      sampleRate,
      channelCount,
    ),
    interestScore: computeInterestScore({
      pcm: toMonoPcm(extraction.pcm, channelCount),
      sampleRate,
      kind: extraction.kind,
      confidence: extraction.confidence,
      loopScore: extraction.loopScore,
    }),
  };
}

function withKept(
  hits: SlicePreviewHit[],
  keptFlags: boolean[],
): SlicePreviewRegion[] {
  return hits.map((hit, i) => ({ ...hit, kept: keptFlags[i] !== false }));
}

function countKept(regions: SlicePreviewRegion[]): {
  kept: number;
  culled: number;
} {
  let kept = 0;
  for (const r of regions) if (r.kept) kept++;
  return { kept, culled: regions.length - kept };
}

function applyCull(
  hits: SlicePreviewHit[],
  durationMs: number,
  targetPerMin: number,
): SlicePreviewRegion[] {
  const target = targetKeepCount(durationMs, targetPerMin);
  if (hits.length <= target) {
    return withKept(
      hits,
      hits.map(() => true),
    );
  }
  const ranked = hits
    .map((hit, i) => ({ i, score: hit.interestScore }))
    .sort((a, b) => a.score - b.score || a.i - b.i);
  const excess = hits.length - target;
  const maxDelete = Math.min(
    excess,
    Math.max(0, hits.length - INTEREST_CULL.minKeep),
  );
  const drop = new Set(ranked.slice(0, maxDelete).map((x) => x.i));
  return withKept(
    hits,
    hits.map((_, i) => !drop.has(i)),
  );
}

async function huntHits(opts: {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
  openFloorFactor?: number;
  signal?: AbortSignal;
}): Promise<SlicePreviewHit[]> {
  const { pcm, sampleRate, channelCount, signal } = opts;
  const hunter = new EventHunter(sampleRate, {
    openFloorFactor: opts.openFloorFactor,
    channelCount,
  });
  const hop = DSP_THRESHOLDS.live.envelopeHop * channelCount;
  const chunk = Math.max(
    hop * 4,
    Math.floor(sampleRate * 0.1 * channelCount),
  );
  const totalFrames = frameCount(pcm, channelCount);
  const hits: SlicePreviewHit[] = [];
  let offset = 0;
  let sinceYield = 0;

  const take = (
    extraction: Extraction | null,
    closedAtInterleaved: number,
  ): void => {
    if (!extraction) return;
    const hit = hitFromExtraction(
      extraction,
      channelCount,
      sampleRate,
      totalFrames,
      closedAtInterleaved,
    );
    if (hit) hits.push(hit);
  };

  while (offset < pcm.length) {
    throwIfAborted(signal);
    const end = Math.min(pcm.length, offset + chunk);
    const delta = pcm.subarray(offset, end);
    const nowMs =
      (offset / (sampleRate * Math.max(1, channelCount))) * 1000;
    const { extraction } = hunter.analyse(delta, nowMs);
    take(extraction, offset + hunter.lastFramesScanned * hop);
    offset = end;
    sinceYield += chunk;
    if (sinceYield >= chunk * 8) {
      sinceYield = 0;
      await yieldToUi();
    }
  }
  throwIfAborted(signal);
  take(hunter.flush(), pcm.length);
  return hits;
}

function songHits(
  mono: Float32Array,
  sampleRate: number,
  targetPerMin: number,
  tempo?: TempoEstimate | null,
): { hits: SlicePreviewHit[]; sliced: ReturnType<typeof songSlice.sliceSong> } {
  const sliced = songSlice.sliceSong(mono, sampleRate, {
    targetPerMin,
    tempo: tempo ?? undefined,
  });
  if (!sliced) return { hits: [], sliced: null };
  const hits: SlicePreviewHit[] = sliced.slices.map((slice) => {
    const durationMs = Math.max(
      1,
      Math.round(((slice.end - slice.start) / sampleRate) * 1000),
    );
    return {
      startFrame: slice.start,
      endFrame: slice.end,
      class: "texture" as const,
      kind: "texture" as const,
      durationMs,
      interestScore: computeInterestScore({
        pcm: slice.pcm,
        sampleRate,
        kind: "texture",
        confidence: 0.7,
      }),
    };
  });
  return { hits, sliced };
}

async function analyze(
  opts: SlicePreviewAnalyzeOpts,
): Promise<SlicePreviewResult> {
  const { pcm, sampleRate, channelCount, mode, targetPerMin, signal } = opts;
  const durationMs = Math.max(
    1,
    durationMsFromPcm(pcm, sampleRate, channelCount),
  );
  const durationSec = durationMs / 1000;
  const base = {
    durationMs,
    sampleRate,
    channelCount,
    mode,
  };

  if (pcm.length === 0) {
    return { ...base, regions: [], kept: 0, culled: 0, error: "empty" };
  }
  if (durationSec > MAX_DURATION_SEC) {
    return { ...base, regions: [], kept: 0, culled: 0, error: "too-long" };
  }

  if (mode === "whole") {
    const regions: SlicePreviewRegion[] = [
      {
        startFrame: 0,
        endFrame: frameCount(pcm, channelCount),
        class: "texture",
        kind: "texture",
        interestScore: 1,
        durationMs,
        kept: true,
      },
    ];
    return { ...base, regions, kept: 1, culled: 0 };
  }

  if (mode === "song") {
    const mono =
      channelCount <= 1 ? pcm : toMonoPcm(pcm, channelCount);
    const { hits, sliced } = songHits(
      mono,
      sampleRate,
      targetPerMin,
      opts.tempo,
    );
    if (!sliced) {
      return { ...base, regions: [], kept: 0, culled: 0, error: "no-tempo" };
    }
    const filter = resolveSliceDurationFilter({
      minMs: opts.minDurationMs,
      maxMs: opts.maxDurationMs,
    });
    const regions = withKept(
      hits,
      hits.map((h) => durationPassesSliceFilter(h.durationMs, filter)),
    );
    const { kept, culled } = countKept(regions);
    return {
      ...base,
      bpm: sliced.bpm,
      beatsPerSlice: sliced.beatsPerSlice,
      tempo: {
        bpm: sliced.bpm,
        periodSamples: sliced.periodSamples,
        confidence: 1,
      },
      regions,
      kept,
      culled,
    };
  }

  const hits =
    opts.huntHits ??
    (await huntHits({
      pcm,
      sampleRate,
      channelCount,
      openFloorFactor: opts.openFloorFactor,
      signal,
    }));
  // Density cull first, then length filter — length never crops, only rejects.
  const afterCull = applyCull(hits, durationMs, targetPerMin);
  const filter = resolveSliceDurationFilter({
    minMs: opts.minDurationMs,
    maxMs: opts.maxDurationMs,
  });
  const regions = afterCull.map((r) => ({
    ...r,
    kept: r.kept && durationPassesSliceFilter(r.durationMs, filter),
  }));
  const { kept, culled } = countKept(regions);
  return { ...base, regions, kept, culled };
}

export const slicePreview = {
  analyze,
  applyCull,
  maxDurationSec: MAX_DURATION_SEC,
} as const;
