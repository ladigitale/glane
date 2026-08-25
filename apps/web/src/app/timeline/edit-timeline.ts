/**
 * Mono-track sample timeline — same chrome/zoom as sequencer, sample space.
 * Precise waveform LOD via WaveformRenderer.drawAdaptive.
 */
import { buildPeakPyramid, type PeakPyramid } from "@glane/audio-io";
import { WaveformRenderer } from "@glane/waveform";
import {
  GestureFsm,
  LONGPRESS_MS,
  type GestureKind,
} from "@glane/gestures";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { tip } from "../tip.js";
import {
  LANE_PAD_UNITS,
  MAX_PX_PER_SAMPLE,
  MIN_PX_PER_SAMPLE,
  TRACK_GUTTER_PX,
  bindTimelineWheel,
  fitPxPerUnit,
  lanePointerDistance,
  lanePointerMidpoint,
  paintViewportWave,
  pinchZoomAtClientX,
  sampleRulerMarks,
  scrollLeftToCenterUnit,
  timelineChromeCss,
  TimelineScrollInertia,
  zoomAtClientX,
} from "./timeline.js";
import { glIcon } from "../icon.js";

type DragMode =
  | "none"
  | "select"
  | "trim-start"
  | "trim-end"
  | "sel-start"
  | "sel-end"
  | "sel-move"
  | "scrub"
  | "scroll"
  | "zoom"
  | "pinch"
  | "pinch-done"
  | "rotate";

@customElement("gl-edit-timeline")
export class GlEditTimeline extends LitElement {
  static override styles = [
    timelineChromeCss,
    css`
      :host {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        height: 280px;
        min-height: 280px;
        touch-action: none;
        background: transparent;
        overflow: visible;
      }
      .timeline {
        /* Not flex:1 — fixed host height; avoid collapse with Tailwind/flex parents. */
        height: 100%;
        min-height: 220px;
        flex: none;
        border-radius: 6px;
      }
      .time-ruler {
        top: 0;
      }
      .track {
        min-height: 180px;
        height: 180px;
      }
      /* Arrangement-style: lane first, narrow sticky gutter on the right. */
      .ruler-gutter,
      .track-label {
        width: ${TRACK_GUTTER_PX}px;
        flex-shrink: 0;
        position: sticky;
        right: 0;
        left: auto;
        z-index: 5;
        background: var(--gl-ink);
        box-shadow: -4px 0 10px color-mix(in srgb, #000 28%, transparent);
        box-sizing: border-box;
      }
      .ruler-gutter {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 0.25rem;
        font-family: var(--gl-font-mono);
        font-size: 0.55rem;
        color: var(--gl-fg-muted, var(--sc-base-500));
        z-index: 3;
      }
      .track-label {
        display: flex;
        position: sticky;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
        padding: 0.25rem 1.65rem 0.25rem 0.25rem;
        font-family: var(--gl-font-mono);
        font-size: 0.6rem;
        line-height: 1.25;
        color: var(--gl-fg-muted, var(--sc-base-500));
        overflow: visible;
      }
      .track-label .conf-line {
        display: block;
        overflow: visible;
        white-space: nowrap;
      }
      .track-label .settings {
        position: absolute;
        top: 2px;
        right: 2px;
      }
      .lane {
        min-height: 180px;
        height: 180px;
      }
      canvas.wave {
        position: sticky;
        left: 0;
        display: block;
        height: 180px;
        width: calc(var(--gl-tl-view-w, 100%) - ${TRACK_GUTTER_PX}px);
        max-width: none;
        pointer-events: none;
        z-index: 1;
      }
      .trim-dim {
        position: absolute;
        top: 0;
        bottom: 0;
        background: color-mix(in srgb, #000 45%, transparent);
        pointer-events: none;
        z-index: 2;
      }
      .trim-body {
        position: absolute;
        top: 8px;
        height: calc(100% - 16px);
        border-radius: 4px;
        outline: 1px solid color-mix(in srgb, var(--gl-fg) 35%, transparent);
        pointer-events: none;
        z-index: 2;
        box-sizing: border-box;
      }
    `,
  ];

  @property({ attribute: false }) pcm: Float32Array | null = null;
  @property({ type: Number }) sampleRate = 48_000;
  @property({ type: String }) label = "Sample";
  @property({ type: String }) color = "#04d289";
  @property({ type: Number }) startSample = 0;
  @property({ type: Number }) endSample = 0;
  @property({ type: Number }) selStart = 0;
  @property({ type: Number }) selEnd = 0;
  /** Absolute playhead in master sample index. */
  @property({ type: Number }) playheadSample = 0;
  @property({ type: Boolean }) playing = false;
  /** When true, lane drag circular-shifts the waveform instead of pan/zoom. */
  @property({ type: Boolean }) rotateMode = false;
  /** Condensed conf lines (duration / stretch / FX) — arrangement gutter. */
  @property({ attribute: false }) confLines: string[] = [];
  @property({ type: String }) settingsHint = "Réglages";

  @state() private pxPerSample = 0.02;
  @state() private viewW = 800;
  /** Live circular offset while dragging in rotate mode (samples). */
  @state() private rotateOffsetSamples = 0;

  #renderer: WaveformRenderer | null = null;
  #pyramid: PeakPyramid | null = null;
  #pyramidSrc: Float32Array | null = null;
  #pendingScrollLeft: number | null = null;
  #unsubWheel: (() => void) | null = null;
  #drag: DragMode = "none";
  #dragOriginSample = 0;
  #selBeforeDrag = { start: 0, end: 0 };
  #fsm = new GestureFsm();
  #panOriginX = 0;
  #panScroll0 = 0;
  #fittedForLen = -1;
  #ro: ResizeObserver | null = null;
  #followPlayhead = true;
  #scrubLastX = 0;
  #rotateOriginX = 0;
  #lanePtrs = new Map<number, { x: number; y: number }>();
  #lanePinchDist = 0;
  #laneLastY = 0;
  #holdTimer = 0;
  /** Long-press opened a host menu — ignore tap-seek / pan until pointer up. */
  #longpressOpened = false;
  #holdLastX = 0;
  #holdLastY = 0;
  #scrollInertia = new TimelineScrollInertia();

  override firstUpdated(): void {
    const canvas = this.renderRoot.querySelector("canvas.wave");
    if (canvas instanceof HTMLCanvasElement) {
      this.#renderer = new WaveformRenderer(canvas);
    }
    this.#bindWheel();
    const tl = this.#timelineEl();
    if (tl) {
      const syncViewW = () => {
        const w = tl.clientWidth || this.viewW;
        this.viewW = w;
        tl.style.setProperty("--gl-tl-view-w", `${Math.max(1, w)}px`);
        this.#paint();
        this.#emitView();
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
      if (this.rotateOffsetSamples !== 0) this.rotateOffsetSamples = 0;
    }
    const pending = this.#pendingScrollLeft;
    if (pending != null) {
      this.#pendingScrollLeft = null;
      const tl = this.#timelineEl();
      if (tl) tl.scrollLeft = pending;
    }
    if (
      changed.has("pcm") ||
      changed.has("color") ||
      changed.has("pxPerSample") ||
      changed.has("startSample") ||
      changed.has("endSample") ||
      changed.has("rotateOffsetSamples") ||
      !this.hasUpdated
    ) {
      this.#paint();
    }
    if (
      this.#followPlayhead &&
      (changed.has("playheadSample") ||
        changed.has("playing") ||
        changed.has("pxPerSample"))
    ) {
      if (changed.has("playing") && this.playing) this.#setFollowPlayhead(true);
      this.#syncFollowScroll();
    }
  }

  override disconnectedCallback(): void {
    this.#scrollInertia.cancel();
    this.#unsubWheel?.();
    this.#unsubWheel = null;
    const tl = this.#timelineEl();
    tl?.removeEventListener("scroll", this.#onScroll);
    tl?.removeEventListener("wheel", this.#onUserWheel);
    this.#ro?.disconnect();
    this.#ro = null;
    super.disconnectedCallback();
  }

  #timelineEl(): HTMLElement | null {
    return this.renderRoot.querySelector(".timeline");
  }

  #bindWheel(): void {
    this.#unsubWheel?.();
    const tl = this.#timelineEl();
    if (!tl) return;
    this.#unsubWheel = bindTimelineWheel(tl, {
      getPxPerUnit: () => this.pxPerSample,
      contentOriginPx: 0,
      minPx: MIN_PX_PER_SAMPLE,
      maxPx: MAX_PX_PER_SAMPLE,
      onZoom: (next) => {
        this.#pendingScrollLeft = next.scrollLeft;
        this.pxPerSample = next.pxPerUnit;
        queueMicrotask(() => this.#emitView());
      },
    });
    tl.addEventListener("scroll", this.#onScroll, { passive: true });
    tl.addEventListener("wheel", this.#onUserWheel, { passive: true });
    this.#emitView();
  }

  #onScroll = (): void => {
    this.#paint();
    this.#emitView();
  };

  #onUserWheel = (e: WheelEvent): void => {
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return;
    if (Math.abs(e.deltaX) < 0.5) return;
    this.#setFollowPlayhead(false);
  };

  #setFollowPlayhead(follow: boolean): void {
    this.#followPlayhead = follow;
    this.#emitView();
  }

  #emitView(): void {
    const tl = this.#timelineEl();
    if (!tl) return;
    const max = this.#length();
    const usableW = Math.max(64, tl.clientWidth - TRACK_GUTTER_PX);
    const start = tl.scrollLeft / this.pxPerSample;
    const end = (tl.scrollLeft + usableW) / this.pxPerSample;
    this.dispatchEvent(
      new CustomEvent("gl-view", {
        detail: {
          start: Math.max(0, Math.min(max, start)),
          end: Math.max(0, Math.min(max, end)),
          follow: this.#followPlayhead,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #syncFollowScroll(force = false): void {
    if (!force) {
      if (!this.#followPlayhead) return;
      if (this.#drag === "scroll" || this.#drag === "zoom") return;
    }
    const tl = this.#timelineEl();
    if (!tl) return;
    const next = scrollLeftToCenterUnit(
      this.playheadSample,
      this.pxPerSample,
      tl.clientWidth,
      0,
      tl.scrollWidth,
    );
    if (tl.scrollLeft !== next) {
      tl.scrollLeft = next;
      this.#paint();
    }
    this.#emitView();
  }

  /** Seek-bar / external scrub: force center on playhead (priority over pan). */
  followPlayheadNow(): void {
    this.#setFollowPlayhead(true);
    this.#syncFollowScroll(true);
  }

  /** Drop live circular-shift preview (e.g. commit aborted). */
  clearRotateOffset(): void {
    if (this.rotateOffsetSamples === 0) return;
    this.rotateOffsetSamples = 0;
  }

  #length(): number {
    return Math.max(1, this.pcm?.length ?? this.endSample ?? 1);
  }

  #laneW(): number {
    return Math.max(
      400,
      Math.ceil((this.#length() + LANE_PAD_UNITS) * this.pxPerSample),
    );
  }

  #fitIfNeeded(force = false): void {
    const len = this.#length();
    if (!force && this.#fittedForLen === len) return;
    const tl = this.#timelineEl();
    const viewW = tl?.clientWidth || this.clientWidth || this.viewW;
    this.viewW = viewW;
    this.pxPerSample = fitPxPerUnit(
      len,
      viewW,
      TRACK_GUTTER_PX,
      MIN_PX_PER_SAMPLE,
      MAX_PX_PER_SAMPLE,
    );
    this.#fittedForLen = len;
  }

  #sampleAtClientX(clientX: number): number {
    const tl = this.#timelineEl();
    if (!tl) return 0;
    const rect = tl.getBoundingClientRect();
    const contentX =
      tl.scrollLeft + (clientX - rect.left);
    return Math.max(
      0,
      Math.min(this.#length(), Math.round(contentX / this.pxPerSample)),
    );
  }

  #paint(): void {
    if (!this.#renderer || !this.pcm || !this.#pyramid) return;
    const tl = this.#timelineEl();
    const canvas = this.#renderer.canvas;
    const viewportW = Math.max(
      64,
      (tl?.clientWidth ?? this.viewW) - TRACK_GUTTER_PX,
    );
    const scrollLeft = tl?.scrollLeft ?? 0;
    const scrollSample = scrollLeft / this.pxPerSample;
    const spp = 1 / Math.max(1e-9, this.pxPerSample);
    canvas.style.width = `${viewportW}px`;
    paintViewportWave(this.#renderer, this.pcm, this.#pyramid, {
      scrollSample,
      samplesPerPixel: spp,
      widthPx: viewportW,
      heightPx: 180,
      color: this.color,
      circularOffsetSamples: this.rotateOffsetSamples || undefined,
    });
  }

  #emitTrim(live: boolean): void {
    this.dispatchEvent(
      new CustomEvent("gl-trim", {
        detail: {
          startSample: this.startSample,
          endSample: this.endSample,
          commit: !live,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitSel(commit: boolean): void {
    this.dispatchEvent(
      new CustomEvent("gl-sel", {
        detail: {
          selStart: this.selStart,
          selEnd: this.selEnd,
          commit,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitSeek(sample: number): void {
    this.dispatchEvent(
      new CustomEvent("gl-seek", {
        detail: { sample },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const laneW = this.#laneW();
    const len = this.#length();
    const marks = sampleRulerMarks(len, this.sampleRate, this.pxPerSample);
    const toPx = (s: number) => s * this.pxPerSample;
    const selL = Math.min(this.selStart, this.selEnd);
    const selR = Math.max(this.selStart, this.selEnd);
    const hasSel = selR > selL + 1;
    const trimL = Math.min(this.startSample, this.endSample);
    const trimR = Math.max(this.startSample, this.endSample);

    const canvasMinW = TRACK_GUTTER_PX + laneW;
    return html`
      <div class="timeline">
        <div class="timeline-canvas" style="min-width:${canvasMinW}px">
          <div class="time-ruler">
            <div
              class="ruler-lane"
              style="min-width:${laneW}px"
              @pointerdown=${this.#rulerDown}
              @pointermove=${this.#laneMove}
              @pointerup=${this.#laneUp}
              @pointercancel=${this.#laneUp}
            >
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
              <div
                class="ruler-progress"
                style="width:${Math.max(0, toPx(this.playheadSample))}px"
                aria-hidden="true"
              ></div>
              ${hasSel
                ? html`<div
                    class="handle loop-move"
                    style="left:${toPx(selL)}px;width:${Math.max(2, toPx(selR - selL))}px"
                    title="Déplacer la boucle"
                    @pointerdown=${(e: PointerEvent) =>
                      this.#beginHandle(e, "sel-move")}
                  ></div>`
                : nothing}
            </div>
            <div class="ruler-gutter" aria-hidden="true"></div>
          </div>
          <div class="track">
            <div
              class="lane"
              style="min-width:${laneW}px;cursor:${this.rotateMode
                ? "ew-resize"
                : "default"}"
              @pointerdown=${this.#laneDown}
              @pointermove=${this.#laneMove}
              @pointerup=${this.#laneUp}
              @pointercancel=${this.#laneUp}
            >
              <canvas class="wave" aria-hidden="true"></canvas>
              ${trimL > 0
                ? html`<div
                    class="trim-dim"
                    style="left:0;width:${toPx(trimL)}px"
                  ></div>`
                : nothing}
              ${trimR < len
                ? html`<div
                    class="trim-dim"
                    style="left:${toPx(trimR)}px;width:${toPx(len - trimR)}px"
                  ></div>`
                : nothing}
              <div
                class="trim-body"
                style="left:${toPx(trimL)}px;width:${Math.max(2, toPx(trimR - trimL))}px;background:color-mix(in srgb, ${this.color} 22%, transparent)"
              ></div>
              ${hasSel
                ? html`<div
                    class="loop-sel"
                    style="left:${toPx(selL)}px;width:${Math.max(2, toPx(selR - selL))}px"
                    title="Boucle"
                  ></div>`
                : nothing}
              <div
                class="playhead"
                style="left:${toPx(this.playheadSample)}px"
              ></div>
              <div
                class="handle"
                style="left:${toPx(trimL)}px"
                @pointerdown=${(e: PointerEvent) =>
                  this.#beginHandle(e, "trim-start")}
              ></div>
              <div
                class="handle"
                style="left:${toPx(trimR)}px"
                @pointerdown=${(e: PointerEvent) =>
                  this.#beginHandle(e, "trim-end")}
              ></div>
              ${hasSel
                ? html`
                    <div
                      class="handle sel"
                      style="left:${toPx(selL)}px"
                      title="Entrée de boucle"
                      @pointerdown=${(e: PointerEvent) =>
                        this.#beginHandle(e, "sel-start")}
                    ></div>
                    <div
                      class="handle sel"
                      style="left:${toPx(selR)}px"
                      title="Sortie de boucle"
                      @pointerdown=${(e: PointerEvent) =>
                        this.#beginHandle(e, "sel-end")}
                    ></div>
                  `
                : nothing}
              <div
                class="handle playhead"
                style="left:${toPx(this.playheadSample)}px"
                title="Tête de lecture"
                @pointerdown=${(e: PointerEvent) =>
                  this.#beginHandle(e, "scrub")}
              ></div>
            </div>
            <div
              class="track-label"
              title=${this.confLines.join(" · ") || this.label}
            >
              <div>
                ${this.confLines.length
                  ? this.confLines.map(
                      (line) => html`<span class="conf-line">${line}</span>`,
                    )
                  : html`<span class="conf-line">${this.label}</span>`}
              </div>
              ${tip(
                this.settingsHint,
                html`
                  <sonic-button
                    shape="circle"
                    variant="ghost"
                    type="neutral"
                    size="xs"
                    icon
                    class="settings"
                    data-aria-label=${this.settingsHint}
                    @click=${this.#onSettings}
                  >
                    ${glIcon("sliders", { size: "xs" })}
                  </sonic-button>
                `,
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  #onSettings = (): void => {
    this.dispatchEvent(
      new CustomEvent("gl-settings", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  #beginHandle(e: PointerEvent, mode: DragMode): void {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.#drag = mode;
    this.#dragOriginSample = this.#sampleAtClientX(e.clientX);
    if (mode === "sel-move") {
      this.#selBeforeDrag = { start: this.selStart, end: this.selEnd };
    }
    if (mode === "scrub") {
      // Delta scrub + center follow (same as play), priority over pan.
      this.#setFollowPlayhead(true);
      this.#scrubLastX = e.clientX;
      this.#syncFollowScroll(true);
      this.dispatchEvent(
        new CustomEvent("gl-scrub-start", { bubbles: true, composed: true }),
      );
    }
  }

  /** Click-drag on the time ruler creates / redraws the loop region. */
  #rulerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".handle")) return;
    if (e.button !== 0) return;
    const ruler = e.currentTarget as HTMLElement;
    ruler.setPointerCapture(e.pointerId);
    const sample = this.#sampleAtClientX(e.clientX);
    this.#drag = "select";
    this.#dragOriginSample = sample;
    this.#selBeforeDrag = { start: this.selStart, end: this.selEnd };
    this.selStart = sample;
    this.selEnd = sample;
    this.#emitSel(false);
  };

  #clearHoldTimer(): void {
    if (this.#holdTimer) {
      window.clearTimeout(this.#holdTimer);
      this.#holdTimer = 0;
    }
  }

  #laneDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".handle")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const lane = e.currentTarget as HTMLElement;
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* already captured */
    }

    this.#clearHoldTimer();
    this.#longpressOpened = false;
    this.#scrollInertia.cancel();
    this.#lanePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.rotateMode && this.#lanePtrs.size === 1) {
      this.#drag = "rotate";
      this.#rotateOriginX = e.clientX;
      this.rotateOffsetSamples = 0;
      this.#setFollowPlayhead(false);
      return;
    }

    if (this.#lanePtrs.size >= 2) {
      this.#drag = "pinch";
      this.#fsm.reset();
      const pts = [...this.#lanePtrs.values()];
      this.#lanePinchDist = lanePointerDistance(pts[0]!, pts[1]!);
      this.#setFollowPlayhead(false);
      return;
    }

    const sample = this.#sampleAtClientX(e.clientX);
    this.#dragOriginSample = sample;

    this.#fsm.reset();
    this.#fsm.push({
      type: "down",
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      target: "background",
    });

    // Lane: pan / zoom / tap-seek / longpress — never establish a loop here.
    this.#drag = "none";
    this.#panOriginX = e.clientX;
    this.#panScroll0 = this.#timelineEl()?.scrollLeft ?? 0;
    this.#laneLastY = e.clientY;
    this.#lanePinchDist = 0;
    this.#holdLastX = e.clientX;
    this.#holdLastY = e.clientY;
    const t0 = e.timeStamp;
    const pointerId = e.pointerId;
    this.#holdTimer = window.setTimeout(() => {
      this.#holdTimer = 0;
      const resolved = this.#fsm.push({
        type: "hold",
        pointerId,
        x: this.#holdLastX,
        y: this.#holdLastY,
        t: t0 + LONGPRESS_MS,
        target: "background",
      });
      if (resolved.status === "resolved" && resolved.kind === "longpress") {
        this.#longpressOpened = true;
        this.#drag = "none";
        this.dispatchEvent(
          new CustomEvent("gl-lane-longpress", {
            detail: { x: this.#holdLastX, y: this.#holdLastY },
            bubbles: true,
            composed: true,
          }),
        );
        if (navigator.vibrate) navigator.vibrate(8);
      }
    }, LONGPRESS_MS);
  };

  #laneMove = (e: PointerEvent): void => {
    if (this.#lanePtrs.has(e.pointerId)) {
      this.#lanePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    this.#holdLastX = e.clientX;
    this.#holdLastY = e.clientY;

    if (this.#longpressOpened) return;
    if (this.#drag === "pinch-done") return;

    if (this.#lanePtrs.size >= 2 || this.#drag === "pinch") {
      this.#clearHoldTimer();
      if (this.#lanePtrs.size < 2) {
        if (this.#drag === "pinch") this.#drag = "pinch-done";
        return;
      }
      this.#drag = "pinch";
      const pts = [...this.#lanePtrs.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist1 = lanePointerDistance(a, b);
      const mid = lanePointerMidpoint(a, b);
      const dist0 = this.#lanePinchDist > 0 ? this.#lanePinchDist : dist1;
      this.#lanePinchDist = dist1;
      const tl = this.#timelineEl();
      if (!tl) return;
      const next = pinchZoomAtClientX(
        tl,
        this.pxPerSample,
        dist0,
        dist1,
        mid.x,
        0,
        MIN_PX_PER_SAMPLE,
        MAX_PX_PER_SAMPLE,
      );
      if (next) {
        this.#pendingScrollLeft = next.scrollLeft;
        this.pxPerSample = next.pxPerUnit;
        this.#setFollowPlayhead(false);
      }
      return;
    }

    if (this.#drag === "rotate") {
      const dx = e.clientX - this.#rotateOriginX;
      // Drag left (dx < 0) → waveform moves left → positive rotate offset.
      const next = Math.round(-dx / this.pxPerSample);
      if (next !== this.rotateOffsetSamples) {
        this.rotateOffsetSamples = next;
      }
      return;
    }
    if (this.#drag === "trim-start") {
      const sample = this.#sampleAtClientX(e.clientX);
      this.startSample = Math.min(sample, this.endSample - 1);
      this.requestUpdate();
      this.#emitTrim(true);
      return;
    }
    if (this.#drag === "trim-end") {
      const sample = this.#sampleAtClientX(e.clientX);
      this.endSample = Math.max(sample, this.startSample + 1);
      this.requestUpdate();
      this.#emitTrim(true);
      return;
    }
    if (this.#drag === "sel-start") {
      const end = Math.max(this.selStart, this.selEnd);
      this.selStart = Math.min(this.#sampleAtClientX(e.clientX), end - 1);
      this.selEnd = end;
      this.requestUpdate();
      this.#emitSel(false);
      return;
    }
    if (this.#drag === "sel-end") {
      const start = Math.min(this.selStart, this.selEnd);
      this.selStart = start;
      this.selEnd = Math.max(this.#sampleAtClientX(e.clientX), start + 1);
      this.requestUpdate();
      this.#emitSel(false);
      return;
    }
    if (this.#drag === "sel-move") {
      const sample = this.#sampleAtClientX(e.clientX);
      const a0 = Math.min(this.#selBeforeDrag.start, this.#selBeforeDrag.end);
      const b0 = Math.max(this.#selBeforeDrag.start, this.#selBeforeDrag.end);
      const width = Math.max(1, b0 - a0);
      const delta = sample - this.#dragOriginSample;
      let nextA = a0 + delta;
      let nextB = nextA + width;
      const minS = this.startSample;
      const maxS = this.endSample;
      if (nextA < minS) {
        nextA = minS;
        nextB = nextA + width;
      }
      if (nextB > maxS) {
        nextB = maxS;
        nextA = Math.max(minS, nextB - width);
      }
      this.selStart = nextA;
      this.selEnd = nextB;
      this.requestUpdate();
      this.#emitSel(false);
      return;
    }
    if (this.#drag === "select") {
      this.selEnd = this.#sampleAtClientX(e.clientX);
      this.requestUpdate();
      this.#emitSel(false);
      return;
    }
    if (this.#drag === "scrub") {
      const dx = e.clientX - this.#scrubLastX;
      this.#scrubLastX = e.clientX;
      const next = Math.max(
        0,
        Math.min(
          this.#length(),
          Math.round(this.playheadSample + dx / this.pxPerSample),
        ),
      );
      this.playheadSample = next;
      this.#setFollowPlayhead(true);
      this.#emitSeek(next);
      this.#syncFollowScroll(true);
      return;
    }
    if (this.#drag === "scroll") {
      const tl = this.#timelineEl();
      if (tl) tl.scrollLeft = this.#panScroll0 - (e.clientX - this.#panOriginX);
      this.#scrollInertia.push(e.clientX, e.timeStamp);
      return;
    }
    if (this.#drag === "zoom") {
      const tl = this.#timelineEl();
      if (!tl) return;
      const dy = e.clientY - this.#laneLastY;
      this.#laneLastY = e.clientY;
      const next = zoomAtClientX(
        tl,
        this.pxPerSample,
        dy,
        e.clientX,
        0,
        MIN_PX_PER_SAMPLE,
        MAX_PX_PER_SAMPLE,
      );
      if (next) {
        this.#pendingScrollLeft = next.scrollLeft;
        this.pxPerSample = next.pxPerUnit;
      }
      return;
    }

    // Resolve pending gesture — pan / zoom only (loop is ruler-only).
    if (this.#drag === "none" && (e.buttons || this.#lanePtrs.size > 0)) {
      const st = this.#fsm.push({
        type: "move",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        target: "background",
        pointerCount: this.#lanePtrs.size,
      });
      if (st.status === "resolved") {
        const kind: GestureKind = st.kind;
        if (kind === "scroll" || kind === "zoom") {
          this.#clearHoldTimer();
          this.#drag = kind;
          this.#laneLastY = e.clientY;
          if (kind === "scroll") {
            this.#panOriginX = e.clientX;
            this.#panScroll0 = this.#timelineEl()?.scrollLeft ?? 0;
            this.#scrollInertia.push(e.clientX, e.timeStamp);
          }
        }
      }
    }
  };

  #laneUp = (e: PointerEvent): void => {
    this.#clearHoldTimer();
    if (this.#lanePtrs.has(e.pointerId)) {
      this.#lanePtrs.delete(e.pointerId);
    }

    if (
      this.#lanePtrs.size >= 1 &&
      (this.#drag === "pinch" || this.#drag === "pinch-done")
    ) {
      if (this.#lanePtrs.size >= 2) {
        const pts = [...this.#lanePtrs.values()];
        this.#lanePinchDist = lanePointerDistance(pts[0]!, pts[1]!);
      } else {
        this.#drag = "pinch-done";
        this.#lanePinchDist = 0;
      }
      return;
    }

    const mode = this.#drag;
    const longpressOpened = this.#longpressOpened;
    this.#longpressOpened = false;
    if (mode === "rotate") {
      const offset = this.rotateOffsetSamples;
      this.#drag = "none";
      // Always notify host so one-shot rotate tool can disarm (seq parity).
      this.dispatchEvent(
        new CustomEvent("gl-rotate", {
          detail: { offsetSamples: offset },
          bubbles: true,
          composed: true,
        }),
      );
      if (offset === 0) this.rotateOffsetSamples = 0;
      return;
    }
    if (mode === "pinch" || mode === "pinch-done") {
      this.#drag = "none";
      this.#lanePinchDist = 0;
      this.#fsm.reset();
      return;
    }
    if (mode === "none" && e.type === "pointerup" && !longpressOpened) {
      const st = this.#fsm.push({
        type: "up",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        target: "background",
      });
      if (st.status === "resolved" && st.kind === "tap") {
        this.#emitSeek(this.#dragOriginSample);
      }
    }
    this.#drag = "none";
    this.#lanePinchDist = 0;
    this.#fsm.reset();
    if (mode === "scroll") {
      this.#setFollowPlayhead(false);
      const tl = this.#timelineEl();
      if (tl) this.#scrollInertia.release(tl);
    }
    if (mode === "scrub") {
      this.#setFollowPlayhead(true);
      this.#syncFollowScroll(true);
      this.dispatchEvent(
        new CustomEvent("gl-scrub-end", { bubbles: true, composed: true }),
      );
    }
    if (mode === "trim-start" || mode === "trim-end") {
      this.#emitTrim(false);
    }
    if (
      mode === "select" ||
      mode === "sel-start" ||
      mode === "sel-end" ||
      mode === "sel-move"
    ) {
      const a = Math.min(this.selStart, this.selEnd);
      const b = Math.max(this.selStart, this.selEnd);
      if (mode === "select" && b <= a + 1) {
        this.selStart = this.#selBeforeDrag.start;
        this.selEnd = this.#selBeforeDrag.end;
        this.#emitSeek(this.#dragOriginSample || a);
        this.requestUpdate();
        return;
      }
      this.#emitSel(true);
    }
  };

}

declare global {
  interface HTMLElementTagNameMap {
    "gl-edit-timeline": GlEditTimeline;
  }
}
