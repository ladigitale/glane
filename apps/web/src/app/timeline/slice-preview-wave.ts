/**
 * Compact file-slice preview — WaveformRenderer chrome, fit-to-width (no zoom).
 * Zoom was removed: high px/sample on long files ballooned the DOM and froze the tab.
 */
import { CLASS_COLORS } from "@glane/core-model";
import { buildPeakPyramid, type PeakPyramid } from "@glane/audio-io";
import { WaveformRenderer } from "@glane/waveform";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type { SlicePreviewRegion } from "../slice-preview.js";
import {
  MAX_PX_PER_SAMPLE,
  MIN_PX_PER_SAMPLE,
  fitPxPerUnit,
  paintViewportWave,
  sampleRulerMarks,
  timelineChromeCss,
} from "./timeline.js";

const LANE_H = 120;

@customElement("gl-slice-preview-wave")
export class GlSlicePreviewWave extends LitElement {
  static override styles = [
    timelineChromeCss,
    css`
      :host {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        height: ${LANE_H + 28}px;
        min-height: ${LANE_H + 28}px;
        background: transparent;
        overflow: hidden;
      }
      .timeline {
        height: 100%;
        min-height: ${LANE_H + 28}px;
        flex: none;
        border-radius: 6px;
        overflow: hidden;
      }
      .time-ruler {
        top: 0;
      }
      .track,
      .lane {
        min-height: ${LANE_H}px;
        height: ${LANE_H}px;
      }
      canvas.wave {
        position: sticky;
        left: 0;
        display: block;
        height: ${LANE_H}px;
        width: 100%;
        max-width: none;
        pointer-events: none;
        z-index: 1;
      }
      .slice {
        position: absolute;
        top: 6px;
        height: calc(100% - 12px);
        box-sizing: border-box;
        border-radius: 3px;
        pointer-events: auto;
        z-index: 2;
        cursor: pointer;
      }
      .slice[data-kept="false"] {
        opacity: 0.38;
        z-index: 2;
      }
      .slice[data-selected="true"] {
        top: 2px;
        height: calc(100% - 4px);
        opacity: 1;
        z-index: 4;
        outline: 3px solid var(--sc-primary, #04d289);
        outline-offset: 0;
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--sc-primary, #04d289) 80%, transparent),
          inset 0 0 0 999px color-mix(in srgb, var(--sc-primary, #04d289) 28%, transparent);
      }
      .slice[data-selected="true"]::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: -4px;
        height: 4px;
        border-radius: 2px 2px 0 0;
        background: var(--sc-primary, #04d289);
      }
    `,
  ];

  @property({ attribute: false }) pcm: Float32Array | null = null;
  @property({ type: Number }) sampleRate = 48_000;
  @property({ attribute: false }) regions: SlicePreviewRegion[] = [];
  @property({ type: Number }) selectedIndex = -1;

  @state() private pxPerSample = 0.02;
  @state() private viewW = 800;

  #renderer: WaveformRenderer | null = null;
  #pyramid: PeakPyramid | null = null;
  #pyramidSrc: Float32Array | null = null;
  #fittedForLen = -1;
  #ro: ResizeObserver | null = null;

  override firstUpdated(): void {
    const canvas = this.renderRoot.querySelector("canvas.wave");
    if (canvas instanceof HTMLCanvasElement) {
      this.#renderer = new WaveformRenderer(canvas);
    }
    const tl = this.#timelineEl();
    if (tl) {
      const syncViewW = () => {
        const w = Math.max(64, tl.clientWidth || this.viewW);
        this.viewW = w;
        this.#fittedForLen = -1;
        this.#fitIfNeeded(true);
        this.#paint();
      };
      syncViewW();
      if (typeof ResizeObserver !== "undefined") {
        this.#ro = new ResizeObserver(syncViewW);
        this.#ro.observe(tl);
      }
    }
    this.#fitIfNeeded(true);
    this.#paint();
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("pcm") && this.pcm !== this.#pyramidSrc) {
      this.#pyramid = this.pcm
        ? buildPeakPyramid(this.pcm, this.sampleRate)
        : null;
      this.#pyramidSrc = this.pcm;
      this.#fittedForLen = -1;
      this.#fitIfNeeded(true);
    }
    if (
      changed.has("pcm") ||
      changed.has("pxPerSample") ||
      changed.has("regions") ||
      changed.has("selectedIndex") ||
      changed.has("viewW") ||
      !this.hasUpdated
    ) {
      this.#paint();
    }
  }

  override disconnectedCallback(): void {
    this.#ro?.disconnect();
    this.#ro = null;
    super.disconnectedCallback();
  }

  #timelineEl(): HTMLElement | null {
    return this.renderRoot.querySelector(".timeline");
  }

  #length(): number {
    return Math.max(1, this.pcm?.length ?? 1);
  }

  #fitIfNeeded(force = false): void {
    const len = this.#length();
    if (!force && this.#fittedForLen === len) return;
    const tl = this.#timelineEl();
    const viewW = Math.max(
      64,
      tl?.clientWidth || this.clientWidth || this.viewW,
    );
    this.viewW = viewW;
    // Fit whole file in the viewport — no zoom, no huge scroll canvas.
    this.pxPerSample = fitPxPerUnit(
      len,
      viewW,
      0,
      MIN_PX_PER_SAMPLE,
      MAX_PX_PER_SAMPLE,
      0,
    );
    this.#fittedForLen = len;
  }

  #paint(): void {
    if (!this.#renderer || !this.pcm || !this.#pyramid) return;
    const viewportW = Math.max(64, this.viewW);
    const canvas = this.#renderer.canvas;
    canvas.style.width = `${viewportW}px`;
    const spp = 1 / Math.max(1e-9, this.pxPerSample);
    paintViewportWave(this.#renderer, this.pcm, this.#pyramid, {
      scrollSample: 0,
      samplesPerPixel: spp,
      widthPx: viewportW,
      heightPx: LANE_H,
      color: "#9aa3ad",
    });
  }

  #onSliceClick = (index: number): void => {
    this.dispatchEvent(
      new CustomEvent("gl-slice-preview-play", {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    );
  };

  override render() {
    const len = this.#length();
    const marks = sampleRulerMarks(len, this.sampleRate, this.pxPerSample);
    const toPx = (s: number) => s * this.pxPerSample;
    return html`
      <div class="timeline">
        <div class="timeline-canvas" style="width:${this.viewW}px">
          <div class="time-ruler">
            <div class="ruler-lane" style="width:${this.viewW}px">
              ${marks.map(
                (m) => html`
                  <div
                    class="ruler-mark ${m.major ? "major" : ""}"
                    style="left:${toPx(m.unit)}px"
                  >
                    ${m.label
                      ? html`<span class="lbl">${m.label}</span>`
                      : nothing}
                  </div>
                `,
              )}
            </div>
          </div>
          <div class="track">
            <div class="lane" style="width:${this.viewW}px">
              <canvas class="wave" aria-hidden="true"></canvas>
              ${this.regions.map((r, i) => {
                const color = r.kept
                  ? CLASS_COLORS[r.class]
                  : CLASS_COLORS.unclassified;
                const w = Math.max(2, toPx(r.endFrame - r.startFrame));
                const dash = r.kept ? "solid" : "dashed";
                return html`
                  <div
                    class="slice"
                    data-kept=${r.kept ? "true" : "false"}
                    data-selected=${this.selectedIndex === i ? "true" : "false"}
                    style="left:${toPx(r.startFrame)}px;width:${w}px;background:color-mix(in srgb, ${color} 28%, transparent);outline:1px ${dash} color-mix(in srgb, ${color} 55%, transparent)"
                    title=${`${r.class} · ${r.durationMs} ms · ★${Math.round(r.interestScore * 100)}${r.kept ? "" : " · −"}`}
                    @click=${() => this.#onSliceClick(i)}
                  ></div>
                `;
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-slice-preview-wave": GlSlicePreviewWave;
  }
}
