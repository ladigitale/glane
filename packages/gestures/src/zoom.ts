/**
 * Timeline zoom / pan math (AudioRoom seqZoom + seqDx model, tick space).
 * Vertical drag → zoom about finger X; horizontal → pan scrollLeft.
 */

export type TimelineZoomView = {
  pxPerTick: number;
  scrollLeft: number;
};

const MIN_RATIO = 0.05;
const MAX_RATIO = 20;

/**
 * AudioRoom: `seqZoom *= (samplesW + samples) / samplesW` with
 * `samples = -dy*2/z`, `samplesW = viewW*0.25/z` → ratio = `1 - 8*dy/viewW`.
 * Finger up (dy < 0) → zoom in.
 */
export function zoomRatioFromVerticalDelta(
  dy: number,
  viewWidthPx: number,
): number {
  const w = Math.max(1, viewWidthPx);
  const ratio = 1 - (dy * 8) / w;
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export function clampPxPerTick(
  pxPerTick: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(pxPerTick)) return min;
  return Math.min(max, Math.max(min, pxPerTick));
}

/**
 * Keep the tick under `anchorXInView` (clientX − timeline rect.left) fixed
 * while changing pxPerTick. `contentOriginPx` is sticky gutter (track labels).
 */
export function zoomAroundAnchor(
  view: TimelineZoomView,
  nextPxPerTick: number,
  anchorXInView: number,
  contentOriginPx: number,
): TimelineZoomView {
  const px = Math.max(1e-9, view.pxPerTick);
  const next = Math.max(1e-9, nextPxPerTick);
  const pointerContentX = view.scrollLeft + anchorXInView;
  const tick = (pointerContentX - contentOriginPx) / px;
  const newContentX = contentOriginPx + tick * next;
  return {
    pxPerTick: next,
    scrollLeft: Math.max(0, newContentX - anchorXInView),
  };
}

/** Apply one vertical-delta zoom step (AudioRoom onSeqContentMoving VERTICAL). */
export function applyVerticalZoom(
  view: TimelineZoomView,
  dy: number,
  viewWidthPx: number,
  anchorXInView: number,
  contentOriginPx: number,
  minPxPerTick: number,
  maxPxPerTick: number,
): TimelineZoomView {
  const ratio = zoomRatioFromVerticalDelta(dy, viewWidthPx);
  if (ratio === 1) return view;
  const next = clampPxPerTick(view.pxPerTick * ratio, minPxPerTick, maxPxPerTick);
  if (next === view.pxPerTick) return view;
  return zoomAroundAnchor(view, next, anchorXInView, contentOriginPx);
}

export const timelineZoom = {
  zoomRatioFromVerticalDelta,
  clampPxPerTick,
  zoomAroundAnchor,
  applyVerticalZoom,
} as const;
