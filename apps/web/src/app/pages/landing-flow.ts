import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  landingPhaseAt,
  landingPhaseClock,
  landingPhaseProgress,
  landingPhaseVisibility,
} from "./landing-flow-phases.js";
import type { LandingFlowTheme, LandingFlowViz } from "./landing-flow-three.js";
import { resolveCssColor } from "./landing-flow-color.js";

/** Timeline length (samples) for the 2D waveform loop. */
const CYCLE = 520;
const BLOCKS: ReadonlyArray<{
  start: number;
  end: number;
  kind: "silence" | "sound";
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

/**
 * Landing backdrop — full pipeline story (capture → export).
 * Prefers Three.js; Canvas2D fallback when WebGL fails or reduced motion.
 */
@customElement("gl-landing-flow")
export class GlLandingFlow extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 0;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
      background: var(--sc-base, #0e1116);
    }
    canvas {
      display: block;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
    }
    .flow-host {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  `;

  #host: HTMLDivElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #three: LandingFlowViz | null = null;
  #threeInit = false;
  #raf = 0;
  #running = false;
  #reduced = false;
  #t0 = 0;
  #cssW = 0;
  #cssH = 0;

  #onResize = (): void => {
    this.#measure();
    if (this.#three) this.#three.resize(this.#cssW, this.#cssH);
  };

  #onMotion = (e: MediaQueryListEvent): void => {
    this.#reduced = e.matches;
    void this.#syncThree();
    this.#syncLoop();
    if (this.#reduced) this.#paint(0);
  };

  #onVis = (): void => this.#syncLoop();

  override render() {
    return html`<div class="flow-host" aria-hidden="true"></div>`;
  }

  override firstUpdated(): void {
    this.#host = this.renderRoot.querySelector(".flow-host");
    this.#reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.#measure();
    void this.#boot();
    window.addEventListener("resize", this.#onResize);
    window.visualViewport?.addEventListener("resize", this.#onResize);
    window.visualViewport?.addEventListener("scroll", this.#onResize);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", this.#onMotion);
    document.addEventListener("visibilitychange", this.#onVis);
  }

  async #boot(): Promise<void> {
    this.#measure();
    if (this.#reduced) {
      this.#ensureCanvas();
      this.#paint(0);
      this.#syncLoop();
      return;
    }
    await this.#initThree();
    if (this.#three) {
      this.#three.render(0);
      this.#syncLoop();
      return;
    }
    this.#ensureCanvas();
    this.#paint(0);
    this.#syncLoop();
  }

  #ensureCanvas(): void {
    if (this.#canvas || !this.#host) return;
    this.#canvas = document.createElement("canvas");
    this.#canvas.setAttribute("aria-hidden", "true");
    this.#host.replaceChildren(this.#canvas);
    this.#measure();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
    this.#three?.dispose();
    this.#three = null;
    window.removeEventListener("resize", this.#onResize);
    window.visualViewport?.removeEventListener("resize", this.#onResize);
    window.visualViewport?.removeEventListener("scroll", this.#onResize);
    document.removeEventListener("visibilitychange", this.#onVis);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .removeEventListener("change", this.#onMotion);
  }

  async #initThree(): Promise<void> {
    if (this.#threeInit || this.#reduced) return;
    this.#threeInit = true;
    try {
      const { createLandingFlowThree } = await import("./landing-flow-three.js");
      const viz = await createLandingFlowThree(
        this.#cssW,
        this.#cssH,
        this.#readTheme(),
      );
      if (!viz || !this.#host) {
        viz?.dispose();
        return;
      }
      this.#three = viz;
      this.#host.replaceChildren(viz.canvas);
      this.#fitCanvas();
      viz.resize(this.#cssW, this.#cssH);
    } catch {
      this.#three = null;
    }
  }

  async #syncThree(): Promise<void> {
    if (this.#reduced && this.#three) {
      this.#three.dispose();
      this.#three = null;
      this.#threeInit = false;
      this.#ensureCanvas();
      this.#paint(0);
      return;
    }
    if (!this.#reduced && !this.#threeInit) {
      await this.#initThree();
      if (this.#three) {
        this.#three.render(0);
      }
    }
  }

  #readTheme(): LandingFlowTheme {
    const s = getComputedStyle(this);
    return {
      primary: resolveCssColor(
        s.getPropertyValue("--sc-primary"),
        "#04d289",
      ),
      base: resolveCssColor(s.getPropertyValue("--sc-base"), "#0e1116"),
      muted: resolveCssColor(
        s.getPropertyValue("--sc-base-400"),
        "#505060",
      ),
      tags: ["#5b8def", "#e8a04a", "#04d289"],
    };
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

  #measure(): void {
    const r = this.getBoundingClientRect();
    this.#cssW = Math.max(1, Math.floor(r.width));
    this.#cssH = Math.max(1, Math.floor(r.height));
  }

  #fitCanvas(): void {
    const c = this.#three?.canvas ?? this.#canvas;
    if (!c) return;
    this.#measure();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.width = `${this.#cssW}px`;
    c.style.height = `${this.#cssH}px`;
    if (!this.#three) {
      c.width = Math.floor(this.#cssW * dpr);
      c.height = Math.floor(this.#cssH * dpr);
      const ctx = c.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  #paint(t: number): void {
    if (this.#three) {
      this.#three.render(t);
      return;
    }
    this.#paint2d(t);
  }

  #block(sample: number) {
    const local = ((sample % CYCLE) + CYCLE) % CYCLE;
    for (const b of BLOCKS) {
      if (local >= b.start && local < b.end) {
        return { ...b, t: (local - b.start) / (b.end - b.start) };
      }
    }
    return { start: 0, end: CYCLE, kind: "silence" as const, tag: -1, t: 0 };
  }

  #amp(sample: number): number {
    const b = this.#block(sample);
    if (b.kind === "silence") return 0.02;
    const env = Math.sin(b.t * Math.PI);
    const s = sample * 0.09;
    const texture =
      Math.abs(Math.sin(s * 1.2 + b.tag) * 0.35) +
      Math.abs(Math.sin(s * 2.7 - 0.5) * 0.22) +
      Math.abs(Math.sin(s * 6.1) * 0.1);
    const peak = 0.55 + (b.tag % 3) * 0.12;
    return Math.min(1, 0.02 + env * (peak * 0.55 + texture));
  }

  #tagIndex(sample: number): number {
    const b = this.#block(sample);
    if (b.kind !== "sound") return -1;
    const cycle = Math.floor(sample / CYCLE);
    return (b.tag + cycle) % 3;
  }

  /** Canvas2D fallback — same narrative phases as Three. */
  #paint2d(t: number): void {
    const c = this.#canvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = this.#cssW;
    const h = this.#cssH;
    const phase = landingPhaseAt(t);

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

    ctx.clearRect(0, 0, w, h);
    const bg = resolveCssColor(
      getComputedStyle(this).getPropertyValue("--sc-base"),
      "#0e1116",
    );
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const detectVis = landingPhaseVisibility(phase).detect;
    const detectMix =
      detectVis > 0.001
        ? detectVis *
          Math.min(1, landingPhaseProgress(t, "detect") * 1.4 + 0.15)
        : 0;
    this.#paint2dWaveBg(ctx, w, h, t, primary, muted, mid, tags, detectMix);

    const vis = landingPhaseVisibility(phase);
    if (vis.detect > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.detect;
      this.#paint2dDetectOverlay(ctx, w, h, t, primary, muted);
      ctx.restore();
    }
    if (vis.library > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.library;
      this.#paint2dLibrary(
        ctx,
        w,
        h,
        t,
        landingPhaseProgress(t, "library"),
        tags,
        muted,
      );
      ctx.restore();
    }
    if (vis.arrange > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.arrange;
      this.#paint2dArrange(
        ctx,
        w,
        h,
        t,
        landingPhaseProgress(t, "arrange"),
        tags,
        primary,
        muted,
      );
      ctx.restore();
    }
    if (vis.export > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.export;
      this.#paint2dExport(
        ctx,
        w,
        h,
        t,
        landingPhaseProgress(t, "export"),
        primary,
        tags,
      );
      ctx.restore();
    }
  }

  #paint2dWaveBg(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    _primary: string,
    muted: string,
    mid: string,
    tags: readonly [string, string, string],
    detectMix: number,
  ): void {
    const midY = h * 0.5;
    const maxAmp = h * 0.22;
    const step = 3;
    const pxPerSample = 2.5;
    const span = 130 * 2.5;
    const scroll = (t * 130) % span;
    const filterX = w * 0.42;
    const filterW = Math.max(18, w * 0.045);

    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    ctx.lineCap = "round";
    for (let x = 0; x <= w; x += step) {
      const sample = (x + scroll) / pxPerSample;
      const a = this.#amp(sample);
      const silent = a < 0.04;
      const half = silent ? 1.5 : Math.max(2, a * maxAmp);
      const past = detectMix > 0.02 && x < filterX - filterW / 2;
      const tag = this.#tagIndex(sample);

      if (past && !silent && tag >= 0 && detectMix > 0.5) {
        ctx.strokeStyle = tags[tag as 0 | 1 | 2];
        ctx.globalAlpha = 0.35 + detectMix * 0.35;
        ctx.lineWidth = 1.75;
      } else {
        ctx.strokeStyle = silent ? muted : a > 0.5 ? mid : muted;
        ctx.globalAlpha = silent ? 0.12 : 0.18 + a * 0.2;
        ctx.lineWidth = 1.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, midY - half);
      ctx.lineTo(x, midY + half);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  #paint2dDetectOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    primary: string,
    _muted: string,
  ): void {
    const midY = h * 0.5;
    const maxAmp = h * 0.22;
    const filterX = w * 0.42;
    const filterW = Math.max(18, w * 0.045);
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
    ctx.moveTo(filterX + Math.sin(t * 2.8) * 4, midY - maxAmp - 10);
    ctx.lineTo(filterX + Math.sin(t * 2.8) * 4, midY + maxAmp + 10);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  #paint2dLibrary(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    local: number,
    tags: readonly [string, string, string],
    muted: string,
  ): void {
    const settle = Math.min(1, local * 1.2);
    const cols = 4;
    const rows = 4;
    const cell = Math.min(w * 0.14, 52);
    const ox = w * 0.5 - (cols * cell) / 2;
    const oy = h * 0.38;
    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 8, oy + rows * cell + 4, cols * cell + 16, 0);
    ctx.beginPath();
    ctx.moveTo(ox - 8, oy + rows * cell + 8);
    ctx.lineTo(ox + cols * cell + 8, oy + rows * cell + 8);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tx = ox + col * cell + cell * 0.12;
      const ty = oy + row * cell + cell * 0.12;
      const fly = 1 - settle;
      const x = tx + Math.sin(i + t * 0.5) * fly * 40;
      const y = ty - fly * (80 + (i % 3) * 20);
      ctx.fillStyle = tags[i % 3]!;
      ctx.globalAlpha = 0.55 + settle * 0.4;
      ctx.fillRect(x, y, cell * 0.76, cell * 0.76);
      ctx.globalAlpha = 1;
    }
  }

  #paint2dArrange(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    local: number,
    tags: readonly [string, string, string],
    primary: string,
    muted: string,
  ): void {
    const lanes = 4;
    const laneH = Math.min(h * 0.07, 36);
    const oy = h * 0.28;
    const ox = w * 0.08;
    const tw = w * 0.84;
    const head =
      ox + ((landingPhaseClock(t, "arrange") * 0.12) % 1) * tw;

    for (let l = 0; l < lanes; l++) {
      const y = oy + l * (laneH + 10);
      ctx.fillStyle = muted;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(ox, y, tw, laneH);
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < 12; i++) {
      const lane = i % lanes;
      const y = oy + lane * (laneH + 10) + laneH * 0.15;
      const x = ox + (i % 6) * (tw / 6.5);
      const cw = tw / 7 + (i % 3) * 12;
      ctx.fillStyle = tags[i % 3]!;
      ctx.globalAlpha = head >= x && head <= x + cw ? 0.95 : 0.55;
      ctx.fillRect(x, y, cw, laneH * 0.7);
    }

    ctx.strokeStyle = primary;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(head, oy - 6);
    ctx.lineTo(head, oy + lanes * (laneH + 10));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  #paint2dExport(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    local: number,
    primary: string,
    tags: readonly [string, string, string],
  ): void {
    const cx = w * 0.5;
    const cy = h * 0.48;
    const maxR = Math.min(w, h) * 0.16;
    for (let i = 0; i < 4; i++) {
      const phase = (local + t * 0.25 + i * 0.15) % 1;
      const r = 20 + phase * maxR;
      ctx.strokeStyle = i % 2 === 0 ? primary : tags[1]!;
      ctx.globalAlpha = (1 - phase) * 0.4;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, 14 + Math.sin(t * 4) * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-flow": GlLandingFlow;
  }
}
