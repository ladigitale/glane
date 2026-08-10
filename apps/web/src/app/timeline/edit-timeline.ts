/**
 * Mono-track sample timeline — same chrome/zoom as sequencer, sample space.
 * Precise waveform LOD via WaveformRenderer.drawAdaptive.
 */
import { buildPeakPyramid, type PeakPyramid } from "@glane/audio-io";
import { WaveformRenderer } from "@glane/waveform";
import { GestureFsm, type GestureKind } from "@glane/gestures";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import {
  LANE_PAD_UNITS,
  MAX_PX_PER_SAMPLE,
  MIN_PX_PER_SAMPLE,
  TRACK_LABEL_PX,
  bindTimelineWheel,
  fitPxPerUnit,
  paintViewportWave,
  sampleRulerMarks,
  scrollLeftToCenterUnit,
  timelineChromeCss,
  zoomAtClientX,
} from "./timeline.js";

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
  | "zoom";

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
        background: var(--gl-ink-elevated, var(--sc-base-100));
        border-radius: 6px;
        overflow: hidden;
      }
      .timeline {
        /* Not flex:1 — fixed host height; avoid collapse with Tailwind/flex parents. */
        height: 100%;
        min-height: 220px;
        flex: none;
      }
      .time-ruler {
        top: 0;
      }
      .track {
        min-height: 180px;
        height: 180px;
      }
      .track-label {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 0.25rem;
        padding: 0.35rem 0.4rem;
        font-size: 0.75rem;
        color: var(--gl-fg-muted, var(--sc-base-500));
        box-sizing: border-box;
      }
      .track-label .name {
        color: var(--gl-fg, var(--sc-base-content));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .track-label .swatch {
        display: inline-block;
        width: 0.65rem;
        height: 0.65rem;
        border-radius: 2px;
      }
      .track-label .meta {
        font-family: var(--gl-font-mono);
        font-size: 0.6rem;
        opacity: 0.75;
      }
      .lane {
        min-height: 180px;
        height: 180px;
      }
      .ruler-gutter {
        display: flex;
        align-items: center;
        padding: 0 0.35rem;
        font-family: var(--gl-font-mono);
        font-size: 0.6rem;
        color: var(--gl-fg-muted, var(--sc-base-500));
      }
      canvas.wave {
        position: sticky;
        left: ${TRACK_LABEL_PX}px;
        display: block;
        height: 180px;
        width: calc(var(--gl-tl-view-w, 100%) - ${TRACK_LABEL_PX}px);
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

  @state() private pxPerSample = 0.02;
  @state() private viewW = 800;

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
      contentOriginPx: TRACK_LABEL_PX,
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
    const usableW = Math.max(64, tl.clientWidth - TRACK_LABEL_PX);
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
      TRACK_LABEL_PX,
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
      TRACK_LABEL_PX,
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
      tl.scrollLeft + (clientX - rect.left) - TRACK_LABEL_PX;
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
      (tl?.clientWidth ?? this.viewW) - TRACK_LABEL_PX,
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

    const canvasMinW = TRACK_LABEL_PX + laneW;
    return html`
      <div class="timeline">
        <div class="timeline-canvas" style="min-width:${canvasMinW}px">
          <div class="time-ruler">
            <div class="ruler-gutter">temps</div>
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
          </div>
          <div class="track">
            <div class="track-label">
              <span class="name">${this.label}</span>
              <span
                class="swatch"
                style="background:${this.color}"
                aria-hidden="true"
              ></span>
              <span class="meta"
                >${len} smp · ${(len / this.sampleRate).toFixed(2)}s</span
              >
            </div>
            <div
              class="lane"
              style="min-width:${laneW}px"
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
          </div>
        </div>
      </div>
    `;
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

  #laneDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest(".handle")) return;
    const lane = e.currentTarget as HTMLElement;
    lane.setPointerCapture(e.pointerId);
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

    // Lane: pan / zoom / tap-seek only — never establish a loop here.
    this.#drag = "none";
    this.#panOriginX = e.clientX;
    this.#panScroll0 = this.#timelineEl()?.scrollLeft ?? 0;
  };

  #laneMove = (e: PointerEvent): void => {
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
      return;
    }
    if (this.#drag === "zoom") {
      const tl = this.#timelineEl();
      if (!tl) return;
      const dy = e.movementY || 0;
      const next = zoomAtClientX(
        tl,
        this.pxPerSample,
        dy,
        e.clientX,
        TRACK_LABEL_PX,
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
    if (this.#drag === "none" && e.buttons) {
      const st = this.#fsm.push({
        type: "move",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        target: "background",
      });
      if (st.status === "resolved") {
        const kind: GestureKind = st.kind;
        if (kind === "scroll" || kind === "zoom") {
          this.#drag = kind;
          if (kind === "scroll") {
            this.#panOriginX = e.clientX;
            this.#panScroll0 = this.#timelineEl()?.scrollLeft ?? 0;
          }
        }
      }
    }
  };

  #laneUp = (e: PointerEvent): void => {
    const mode = this.#drag;
    if (mode === "none" && e.type === "pointerup") {
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
    this.#fsm.reset();
    if (mode === "scroll") this.#setFollowPlayhead(false);
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
