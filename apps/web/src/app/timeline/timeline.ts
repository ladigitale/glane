/**
 * Shared timeline chrome — editor (1 lane, sample space) + sequencer (ticks).
 * Zoom math: @glane/gestures applyVerticalZoom / applyPinchZoom (pxPerUnit ≡ pxPerTick).
 */
import type { StretchMode } from "@glane/core-model";
import { applyPinchZoom, applyVerticalZoom } from "@glane/gestures";
import { WaveformRenderer, type WaveformView } from "@glane/waveform";
import type { PeakPyramid } from "@glane/audio-io";
import { css } from "lit";

export const TRACK_LABEL_PX = 176;
export const RULER_H = 28;
export const CANCEL_ZONE_H = 36;
export const LANE_PAD_UNITS = 64;

/** Sequencer tick zoom (AudioRoom-ish). */
export const MIN_PX_PER_TICK = 0.008;
export const MAX_PX_PER_TICK = 2;

/** Editor sample zoom — wide enough for long masters, tight for sample edit. */
export const MIN_PX_PER_SAMPLE = 0.00005;
export const MAX_PX_PER_SAMPLE = 8;

export type TimelineZoomState = {
  pxPerUnit: number;
  scrollLeft: number;
};

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function zoomAtClientX(
  el: HTMLElement,
  pxPerUnit: number,
  dy: number,
  clientX: number,
  contentOriginPx: number,
  minPx: number,
  maxPx: number,
): TimelineZoomState | null {
  const rect = el.getBoundingClientRect();
  const next = applyVerticalZoom(
    { pxPerTick: pxPerUnit, scrollLeft: el.scrollLeft },
    dy,
    el.clientWidth,
    clientX - rect.left,
    contentOriginPx,
    minPx,
    maxPx,
  );
  if (next.pxPerTick === pxPerUnit) return null;
  return { pxPerUnit: next.pxPerTick, scrollLeft: next.scrollLeft };
}

/** Pinch zoom about clientX (typically midpoint of two fingers). */
export function pinchZoomAtClientX(
  el: HTMLElement,
  pxPerUnit: number,
  distance0: number,
  distance1: number,
  clientX: number,
  contentOriginPx: number,
  minPx: number,
  maxPx: number,
): TimelineZoomState | null {
  const rect = el.getBoundingClientRect();
  const next = applyPinchZoom(
    { pxPerTick: pxPerUnit, scrollLeft: el.scrollLeft },
    distance0,
    distance1,
    clientX - rect.left,
    contentOriginPx,
    minPx,
    maxPx,
  );
  if (next.pxPerTick === pxPerUnit) return null;
  return { pxPerUnit: next.pxPerTick, scrollLeft: next.scrollLeft };
}

/** Active pointer samples for lane pan / vertical zoom / pinch. */
export type LanePointerSample = { x: number; y: number };

export function lanePointerDistance(
  a: LanePointerSample,
  b: LanePointerSample,
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lanePointerMidpoint(
  a: LanePointerSample,
  b: LanePointerSample,
): LanePointerSample {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function bindTimelineWheel(
  el: HTMLElement,
  opts: {
    getPxPerUnit: () => number;
    onZoom: (next: TimelineZoomState) => void;
    contentOriginPx: number;
    minPx: number;
    maxPx: number;
  },
): () => void {
  const onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX))) return;
    e.preventDefault();
    const next = zoomAtClientX(
      el,
      opts.getPxPerUnit(),
      e.deltaY,
      e.clientX,
      opts.contentOriginPx,
      opts.minPx,
      opts.maxPx,
    );
    if (next) opts.onZoom(next);
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}

export type TimeRulerMark = {
  unit: number;
  label: string;
  clock: string;
  major: boolean;
};

/** Sample-space ruler (ms clocks). */
export function sampleRulerMarks(
  lengthSamples: number,
  sampleRate: number,
  pxPerSample: number,
): TimeRulerMark[] {
  if (lengthSamples < 1 || sampleRate < 1) return [];
  const durMs = (lengthSamples / sampleRate) * 1000;
  const pxPerSec = sampleRate * pxPerSample;
  // Choose major step so marks stay ~64–120 px apart.
  const candidatesMs = [
    10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000,
  ];
  let stepMs = 1000;
  for (const c of candidatesMs) {
    const px = (c / 1000) * pxPerSec;
    if (px >= 64) {
      stepMs = c;
      break;
    }
    stepMs = c;
  }
  const out: TimeRulerMark[] = [];
  for (let ms = 0; ms <= durMs + 0.5; ms += stepMs) {
    const sample = Math.round((ms / 1000) * sampleRate);
    if (sample > lengthSamples) break;
    out.push({
      unit: sample,
      label: formatClock(ms),
      clock: "",
      major: true,
    });
  }
  if (pxPerSec >= 200) {
    const sub = stepMs / 4;
    if (sub >= 1) {
      for (let ms = sub; ms < durMs; ms += sub) {
        if (Math.abs(ms % stepMs) < 0.1) continue;
        const sample = Math.round((ms / 1000) * sampleRate);
        out.push({
          unit: sample,
          label: "",
          clock: "",
          major: false,
        });
      }
    }
  }
  return out;
}

/** Fit `length` units into `viewW` (minus gutter), clamped. */
export function fitPxPerUnit(
  lengthUnits: number,
  viewWidthPx: number,
  contentOriginPx: number,
  minPx: number,
  maxPx: number,
  padUnits = LANE_PAD_UNITS,
): number {
  const usable = Math.max(64, viewWidthPx - contentOriginPx);
  const raw = usable / Math.max(1, lengthUnits + padUnits);
  return Math.min(maxPx, Math.max(minPx, raw));
}

/**
 * scrollLeft that keeps `unit` at the horizontal center of the timeline viewport.
 * Clamps at edges — playhead then moves within the view instead of overscrolling.
 */
export function scrollLeftToCenterUnit(
  unit: number,
  pxPerUnit: number,
  clientWidth: number,
  contentOriginPx: number,
  scrollWidth: number,
): number {
  const playheadX = contentOriginPx + unit * pxPerUnit;
  const ideal = playheadX - clientWidth / 2;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  return Math.min(maxScroll, Math.max(0, ideal));
}

/** Map timeline sample t → source index for stretch modes (null = silence). */
export function approxSrcIndex(
  mode: StretchMode,
  t: number,
  offset: number,
  pcmLen: number,
  clipSamples: number,
): number | null {
  if (t < 0 || t >= clipSamples) return null;
  if (mode === "off" || mode === "copy") {
    if (pcmLen <= 0) return null;
    // Circular contentOffset (instance phase) — same wrap as editor rotate.
    return (((offset + t) % pcmLen) + pcmLen) % pcmLen;
  }
  const buf = offset + t;
  if (buf < 0 || buf >= clipSamples) return null;
  return (buf * pcmLen) / Math.max(1, clipSamples);
}

/** Approx min/max wave for stretched sequencer clips. */
export function paintStretchedWave(
  canvas: HTMLCanvasElement,
  pcm: Float32Array,
  mode: StretchMode,
  clipSamples: number,
  offsetSamples: number,
  cssW: number,
  cssH: number,
): void {
  const w = Math.max(1, Math.floor(cssW));
  const h = Math.max(1, Math.floor(cssH));
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || pcm.length === 0 || clipSamples < 1) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const spp = clipSamples / w;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const t0 = x * spp;
    const t1 = (x + 1) * spp;
    let min = 1;
    let max = -1;
    // Sample every source-ish step in the pixel (cap only pathological zooms).
    const steps = Math.max(1, Math.min(4096, Math.ceil(t1 - t0)));
    for (let s = 0; s < steps; s++) {
      const t = t0 + ((s + 0.5) / steps) * (t1 - t0);
      const src = approxSrcIndex(mode, t, offsetSamples, pcm.length, clipSamples);
      if (src == null) {
        min = Math.min(min, 0);
        max = Math.max(max, 0);
        continue;
      }
      const i0 = Math.floor(src);
      const i1 = Math.min(pcm.length - 1, i0 + 1);
      const f = src - i0;
      const v = (pcm[i0] ?? 0) * (1 - f) + (pcm[i1] ?? 0) * f;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max < min) {
      min = 0;
      max = 0;
    }
    ctx.moveTo(x + 0.5, mid - max * mid);
    ctx.lineTo(x + 0.5, mid - min * mid);
  }
  ctx.stroke();
}

export function paintViewportWave(
  renderer: WaveformRenderer,
  pcm: Float32Array,
  pyramid: PeakPyramid,
  view: WaveformView,
): void {
  renderer.drawAdaptive(pyramid, pcm, view);
}

/** Shared chrome styles (editor + sequencer can import subsets). */
export const timelineChromeCss = css`
  .timeline {
    flex: 1;
    overflow: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    background: var(--gl-ink-elevated);
    position: relative;
    touch-action: none;
  }
  .timeline::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  /* Explicit content width so sticky gutters stay pinned for the full
     horizontal scroll (abspos overlays must not outgrow this box). */
  .timeline-canvas {
    position: relative;
    box-sizing: border-box;
  }
  .time-ruler {
    display: flex;
    width: 100%;
    min-width: 100%;
    box-sizing: border-box;
    position: sticky;
    top: 0;
    height: ${RULER_H}px;
    z-index: 6;
    background: var(--gl-ink);
    border-bottom: 1px solid color-mix(in srgb, var(--gl-fg) 14%, transparent);
    user-select: none;
  }
  .ruler-gutter {
    width: ${TRACK_LABEL_PX}px;
    flex-shrink: 0;
    position: sticky;
    left: 0;
    z-index: 3;
    background: var(--gl-ink);
    box-shadow: 4px 0 10px color-mix(in srgb, #000 28%, transparent);
  }
  .ruler-lane {
    position: relative;
    flex: 1;
    min-width: 400px;
    height: 100%;
  }
  .ruler-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid color-mix(in srgb, var(--gl-fg) 22%, transparent);
    pointer-events: none;
  }
  .ruler-mark.major {
    border-left-color: color-mix(in srgb, var(--gl-fg) 45%, transparent);
  }
  .ruler-mark .lbl {
    position: absolute;
    left: 4px;
    top: 2px;
    font-family: var(--gl-font-mono);
    font-size: 0.6rem;
    color: var(--gl-fg-muted);
    white-space: nowrap;
  }
  .track {
    display: flex;
    width: 100%;
    min-width: 100%;
    box-sizing: border-box;
    min-height: 160px;
    border-bottom: 1px solid color-mix(in srgb, var(--gl-fg) 12%, transparent);
  }
  .track-label {
    width: ${TRACK_LABEL_PX}px;
    flex-shrink: 0;
    background: var(--gl-ink);
    position: sticky;
    left: 0;
    /* Above lane chrome (handles / playhead); below sticky ruler. */
    z-index: 5;
    box-shadow: 4px 0 10px color-mix(in srgb, #000 28%, transparent);
  }
  .lane {
    position: relative;
    flex: 1;
    min-width: 400px;
    box-sizing: border-box;
    min-height: 160px;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--gl-accent);
    pointer-events: none;
    z-index: 3;
    box-shadow: 0 0 8px color-mix(in srgb, var(--gl-accent) 55%, transparent);
  }
  /* Progress fill on the ruler — YouTube scrub feel in the scroll view. */
  .ruler-progress {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    background: color-mix(in srgb, var(--gl-accent) 28%, transparent);
    pointer-events: none;
    z-index: 1;
  }
  .loop-sel {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--gl-accent) 18%, transparent);
    border-left: 2px solid var(--gl-accent);
    border-right: 2px solid var(--gl-accent);
    pointer-events: none;
    z-index: 2;
    box-sizing: border-box;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 44px;
    margin-left: -22px;
    pointer-events: auto;
    cursor: ew-resize;
    background: transparent;
    /* Below sticky track tools (5) and ruler (6); above wave / trim. */
    z-index: 4;
    touch-action: none;
  }
  .handle::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 20%;
    bottom: 20%;
    width: 4px;
    margin-left: -2px;
    background: var(--gl-fg);
    border-radius: 2px;
    opacity: 0.7;
  }
  .handle.sel::after {
    background: var(--gl-accent);
  }
  .handle.playhead::after {
    top: 6px;
    bottom: auto;
    left: 50%;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    margin-top: 0;
    border-radius: 50%;
    background: var(--gl-accent);
    opacity: 1;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--gl-ink) 55%, transparent),
      0 0 8px color-mix(in srgb, var(--gl-accent) 50%, transparent);
  }
  .handle.playhead::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 18px;
    bottom: 12%;
    width: 2px;
    margin-left: -1px;
    background: var(--gl-accent);
    opacity: 0.9;
    border-radius: 1px;
  }
  /* Horizontal grip on the time ruler — move whole loop region. */
  .handle.loop-move {
    top: 4px;
    bottom: auto;
    height: calc(100% - 8px);
    margin-left: 0;
    width: auto;
    cursor: grab;
    z-index: 4;
  }
  .handle.loop-move:active {
    cursor: grabbing;
  }
  .handle.loop-move::after {
    left: 8px;
    right: 8px;
    top: 50%;
    bottom: auto;
    width: auto;
    height: 6px;
    margin-left: 0;
    margin-top: -3px;
    border-radius: 3px;
    background: var(--gl-accent);
    opacity: 0.85;
  }
`;

export const timeline = {
  TRACK_LABEL_PX,
  RULER_H,
  formatClock,
  zoomAtClientX,
  bindTimelineWheel,
  sampleRulerMarks,
  fitPxPerUnit,
  scrollLeftToCenterUnit,
  paintStretchedWave,
  paintViewportWave,
  timelineChromeCss,
  MIN_PX_PER_TICK,
  MAX_PX_PER_TICK,
  MIN_PX_PER_SAMPLE,
  MAX_PX_PER_SAMPLE,
} as const;
