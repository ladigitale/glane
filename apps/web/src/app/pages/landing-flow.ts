import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Playback waveform (R→L): sound bursts + silence, detect filter colours
 * each section after amp rises then returns near zero.
 * Paused when prefers-reduced-motion.
 */
@customElement("gl-landing-flow")
export class GlLandingFlow extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 12rem;
      pointer-events: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  #canvas: HTMLCanvasElement | null = null;
  #raf = 0;
  #running = false;
  #reduced = false;
  #t0 = 0;
  #cssW = 0;
  #cssH = 0;

  #onResize = (): void => {
    this.#fit();
    if (!this.#running) this.#paint(0);
  };

  #onMotion = (e: MediaQueryListEvent): void => {
    this.#reduced = e.matches;
    this.#syncLoop();
    if (this.#reduced) this.#paint(0);
  };

  #onVis = (): void => this.#syncLoop();

  override firstUpdated(): void {
    this.#canvas = this.renderRoot.querySelector("canvas");
    this.#reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.#fit();
    window.addEventListener("resize", this.#onResize);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", this.#onMotion);
    document.addEventListener("visibilitychange", this.#onVis);
    this.#syncLoop();
    if (this.#reduced) this.#paint(0);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
    window.removeEventListener("resize", this.#onResize);
    document.removeEventListener("visibilitychange", this.#onVis);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .removeEventListener("change", this.#onMotion);
  }

  #syncLoop(): void {
    const should =
      !this.#reduced && document.visibilityState === "visible";
    if (should && !this.#running) this.#start();
    if (!should && this.#running) this.#stop();
  }

  #start(): void {
    this.#running = true;
    this.#t0 = performance.now();
    const tick = (now: number) => {
      if (!this.#running) return;
      this.#paint((now - this.#t0) / 1000);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
  }

  #fit(): void {
    const c = this.#canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.getBoundingClientRect();
    this.#cssW = Math.max(1, r.width);
    this.#cssH = Math.max(1, r.height);
    c.width = Math.floor(this.#cssW * dpr);
    c.height = Math.floor(this.#cssH * dpr);
    const ctx = c.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Timeline blocks: activity bursts separated by silence.
   * A new coloured section starts each time amp rises from ~0 then returns.
   */
  static readonly #CYCLE = 520;
  static readonly #BLOCKS: ReadonlyArray<{
    start: number;
    end: number;
    kind: "silence" | "sound";
    /** Colour index for sound blocks (-1 = silence). */
    tag: number;
  }> = [
    { start: 0, end: 55, kind: "silence", tag: -1 },
    { start: 55, end: 145, kind: "sound", tag: 0 },
    { start: 145, end: 195, kind: "silence", tag: -1 },
    { start: 195, end: 250, kind: "sound", tag: 1 },
    { start: 250, end: 310, kind: "silence", tag: -1 },
    { start: 310, end: 420, kind: "sound", tag: 2 },
    { start: 420, end: 470, kind: "silence", tag: -1 },
    { start: 470, end: 520, kind: "sound", tag: 0 },
  ];

  #block(sample: number) {
    const local =
      ((sample % GlLandingFlow.#CYCLE) + GlLandingFlow.#CYCLE) %
      GlLandingFlow.#CYCLE;
    for (const b of GlLandingFlow.#BLOCKS) {
      if (local >= b.start && local < b.end) {
        return {
          ...b,
          t: (local - b.start) / (b.end - b.start),
        };
      }
    }
    return {
      start: 0,
      end: GlLandingFlow.#CYCLE,
      kind: "silence" as const,
      tag: -1,
      t: 0,
    };
  }

  /** Envelope: rise → texture → fall to ~0 (section boundary at silences). */
  #amp(sample: number): number {
    const b = this.#block(sample);
    if (b.kind === "silence") return 0.02;
    const floor = 0.02;
    const env = Math.sin(b.t * Math.PI); // 0 → 1 → 0
    const s = sample * 0.09;
    const texture =
      Math.abs(Math.sin(s * 1.2 + b.tag) * 0.35) +
      Math.abs(Math.sin(s * 2.7 - 0.5) * 0.22) +
      Math.abs(Math.sin(s * 6.1) * 0.1);
    const peak = 0.55 + (b.tag % 3) * 0.12;
    return Math.min(1, floor + env * (peak * 0.55 + texture));
  }

  #tagIndex(sample: number): number {
    const b = this.#block(sample);
    if (b.kind !== "sound") return -1;
    // Rotate palette across cycles so successive bursts stay distinct
    const cycle = Math.floor(sample / GlLandingFlow.#CYCLE);
    return (b.tag + cycle) % 3;
  }

  #paint(t: number): void {
    const c = this.#canvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = this.#cssW;
    const h = this.#cssH;
    ctx.clearRect(0, 0, w, h);

    const primary =
      getComputedStyle(this).getPropertyValue("--sc-primary").trim() ||
      "#04d289";
    const muted =
      getComputedStyle(this).getPropertyValue("--sc-neutral-4").trim() ||
      "rgba(128,128,140,0.4)";
    const mid =
      getComputedStyle(this).getPropertyValue("--sc-neutral-7").trim() ||
      "rgba(120,120,130,0.55)";

    const tags = [primary, "#5b8def", "#e8a04a"] as const;

    const midY = h * 0.52;
    const maxAmp = h * 0.32;
    const step = 3;
    const pxPerSample = 2.5;
    const speed = this.#reduced ? 0 : 130; // css-px / s, scroll R→L
    const scroll = t * speed;
    const filterX = w * 0.42;
    const filterW = Math.max(18, w * 0.045);

    // Zero line
    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Filter band (detect window)
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(
      filterX - filterW / 2,
      midY - maxAmp - 8,
      filterW,
      maxAmp * 2 + 16,
    );
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(filterX, midY - maxAmp - 10);
    ctx.lineTo(filterX, midY + maxAmp + 10);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Soft section washes left of filter (clear colour blocks)
    {
      let x = 0;
      let prevTag = this.#tagIndex((0 + scroll) / pxPerSample);
      let runStart = 0;
      const flush = (endX: number, tag: number) => {
        if (tag < 0 || endX <= runStart) return;
        if (endX > filterX - filterW / 2) endX = filterX - filterW / 2;
        if (endX <= runStart) return;
        ctx.fillStyle = tags[tag as 0 | 1 | 2];
        ctx.globalAlpha = 0.14;
        ctx.fillRect(runStart, midY - maxAmp - 4, endX - runStart, maxAmp * 2 + 8);
      };
      for (; x <= filterX - filterW / 2 + step; x += step) {
        const tag = this.#tagIndex((x + scroll) / pxPerSample);
        if (tag !== prevTag) {
          flush(x, prevTag);
          runStart = x;
          prevTag = tag;
        }
      }
      flush(filterX - filterW / 2, prevTag);
      ctx.globalAlpha = 1;
    }

    // Waveform bars scrolling right → left
    ctx.lineCap = "round";
    ctx.lineWidth = 1.75;
    for (let x = 0; x <= w; x += step) {
      const sample = (x + scroll) / pxPerSample;
      const a = this.#amp(sample);
      const silent = a < 0.04;
      const half = silent ? 1.5 : Math.max(2, a * maxAmp);
      const inFilter = Math.abs(x - filterX) <= filterW / 2;
      const past = x < filterX - filterW / 2;
      const tag = this.#tagIndex(sample);

      if (past) {
        if (silent || tag < 0) {
          ctx.strokeStyle = muted;
          ctx.globalAlpha = 0.2;
        } else {
          ctx.strokeStyle = tags[tag as 0 | 1 | 2];
          ctx.globalAlpha = 0.75 + a * 0.25;
          ctx.lineWidth = 2;
        }
      } else if (inFilter) {
        ctx.strokeStyle = silent ? muted : primary;
        ctx.globalAlpha = silent ? 0.35 : 0.95;
        ctx.lineWidth = silent ? 1.5 : 2.4;
      } else {
        ctx.strokeStyle = silent ? muted : a > 0.5 ? mid : muted;
        ctx.globalAlpha = silent ? 0.18 : 0.35 + a * 0.4;
        ctx.lineWidth = 1.75;
      }

      ctx.beginPath();
      ctx.moveTo(x, midY - half);
      ctx.lineTo(x, midY + half);
      ctx.stroke();
      ctx.lineWidth = 1.75;
    }
    ctx.globalAlpha = 1;
  }

  override render() {
    return html`<canvas aria-hidden="true"></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-flow": GlLandingFlow;
  }
}
