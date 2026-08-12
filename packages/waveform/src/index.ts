import {
  pickPeakLevelIndex,
  type PeakPyramid,
} from "@glane/audio-io";

export type WaveformView = {
  scrollSample: number;
  samplesPerPixel: number;
  widthPx: number;
  heightPx: number;
  color: string;
  playheadSample?: number;
  /**
   * Circular read offset: display index `i` reads `pcm[(i + offset) % n]`.
   * When set (non-zero), adaptive LOD uses PCM paths so wrap stays correct.
   */
  circularOffsetSamples?: number;
};

function wrapReadIndex(i: number, n: number, offset: number): number {
  if (n <= 0) return 0;
  let x = (i + offset) % n;
  if (x < 0) x += n;
  return x;
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
): void {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.floor(widthPx * dpr);
  canvas.height = Math.floor(heightPx * dpr);
  canvas.style.width = `${widthPx}px`;
  canvas.style.height = `${heightPx}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, widthPx, heightPx);
}

function strokePlayhead(
  ctx: CanvasRenderingContext2D,
  view: WaveformView,
): void {
  if (view.playheadSample == null) return;
  const px =
    (view.playheadSample - view.scrollSample) / view.samplesPerPixel;
  if (px < 0 || px > view.widthPx) return;
  ctx.strokeStyle = "#e8f0ef";
  ctx.beginPath();
  ctx.moveTo(px + 0.5, 0);
  ctx.lineTo(px + 0.5, view.heightPx);
  ctx.stroke();
}

/**
 * Canvas2D renderer with pyramid LOD (WebGL path can wrap same interface later).
 */
export class WaveformRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  #gl: WebGLRenderingContext | null = null;
  useWebGL = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2D unavailable");
    this.ctx = ctx;
    this.#gl = canvas.getContext("webgl");
    this.useWebGL = false; // enable when shader path lands; 2D is correct fallback
  }

  /**
   * Peak bars from a pyramid level, aggregating every bucket that covers each
   * pixel so zoom mid-points stay sharp (no stretched single buckets).
   */
  drawPeaks(pyramid: PeakPyramid, view: WaveformView): void {
    const { widthPx, heightPx, samplesPerPixel, scrollSample, color } = view;
    prepareCanvas(this.canvas, this.ctx, widthPx, heightPx);

    const levelIdx = pickPeakLevelIndex(pyramid, samplesPerPixel);
    if (levelIdx < 0) return;

    const level = pyramid.levels[levelIdx];
    const factor = pyramid.factors[levelIdx] ?? 256;
    if (!level) return;

    const mid = heightPx / 2;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    for (let x = 0; x < widthPx; x++) {
      const s0 = scrollSample + x * samplesPerPixel;
      const s1 = scrollSample + (x + 1) * samplesPerPixel;
      let b0 = Math.floor(s0 / factor);
      let b1 = Math.floor((s1 - 1e-9) / factor);
      if (b1 < b0) b1 = b0;
      let min = 1;
      let max = -1;
      for (let b = b0; b <= b1; b++) {
        if (b < 0 || b * 2 + 1 >= level.length) continue;
        const lo = level[b * 2] ?? 0;
        const hi = level[b * 2 + 1] ?? 0;
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      if (max < min) {
        min = 0;
        max = 0;
      }
      this.ctx.moveTo(x + 0.5, mid - max * mid);
      this.ctx.lineTo(x + 0.5, mid - min * mid);
    }
    this.ctx.stroke();
    strokePlayhead(this.ctx, view);
  }

  /**
   * Per-pixel min/max from raw PCM — used when zoomed finer than the densest
   * pyramid level (avoids 32–sample “block” pixels).
   */
  drawMinMax(samples: Float32Array, view: WaveformView): void {
    const { widthPx, heightPx, samplesPerPixel, scrollSample, color } = view;
    const offset = view.circularOffsetSamples ?? 0;
    const n = samples.length;
    prepareCanvas(this.canvas, this.ctx, widthPx, heightPx);
    const mid = heightPx / 2;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    for (let x = 0; x < widthPx; x++) {
      const s0 = Math.floor(scrollSample + x * samplesPerPixel);
      const s1 = Math.ceil(scrollSample + (x + 1) * samplesPerPixel);
      let min = 1;
      let max = -1;
      if (offset !== 0 && n > 0) {
        const start = s0;
        const end = Math.max(start + 1, s1);
        for (let i = start; i < end; i++) {
          const v = samples[wrapReadIndex(i, n, offset)] ?? 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      } else {
        const start = Math.max(0, s0);
        const end = Math.min(n, Math.max(start + 1, s1));
        for (let i = start; i < end; i++) {
          const v = samples[i] ?? 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (max < min) {
        min = 0;
        max = 0;
      }
      this.ctx.moveTo(x + 0.5, mid - max * mid);
      this.ctx.lineTo(x + 0.5, mid - min * mid);
    }
    this.ctx.stroke();
    strokePlayhead(this.ctx, view);
  }

  /** Sample-accurate polyline when zoomed in past 1 sample/pixel. */
  drawSamples(samples: Float32Array, view: WaveformView): void {
    const { widthPx, heightPx, samplesPerPixel, scrollSample, color } = view;
    const offset = view.circularOffsetSamples ?? 0;
    const n = samples.length;
    prepareCanvas(this.canvas, this.ctx, widthPx, heightPx);
    const mid = heightPx / 2;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    let started = false;
    for (let x = 0; x < widthPx; x++) {
      const i = Math.floor(scrollSample + x * samplesPerPixel);
      let sampleIndex = i;
      if (offset !== 0 && n > 0) {
        sampleIndex = wrapReadIndex(i, n, offset);
      } else if (i < 0 || i >= n) {
        continue;
      }
      const y = mid - (samples[sampleIndex] ?? 0) * mid;
      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
    strokePlayhead(this.ctx, view);
  }

  /**
   * LOD by zoom:
   * - spp < 1 → sample polyline
   * - denser than finest mip → PCM min/max for the viewport
   * - else → pyramid level closest under spp, with per-pixel bucket aggregation
   */
  drawAdaptive(
    pyramid: PeakPyramid,
    samples: Float32Array,
    view: WaveformView,
    sampleAccurateBelowSpp = 1,
  ): void {
    const circular = (view.circularOffsetSamples ?? 0) !== 0;
    if (circular || view.samplesPerPixel < sampleAccurateBelowSpp) {
      if (view.samplesPerPixel < sampleAccurateBelowSpp) {
        this.drawSamples(samples, view);
        return;
      }
      if (circular) {
        this.drawMinMax(samples, view);
        return;
      }
    }
    const levelIdx = pickPeakLevelIndex(pyramid, view.samplesPerPixel);
    if (levelIdx < 0) {
      this.drawMinMax(samples, view);
      return;
    }
    this.drawPeaks(pyramid, view);
  }
}
