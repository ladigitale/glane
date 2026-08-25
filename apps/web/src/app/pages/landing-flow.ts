import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  landingHandoff,
  landingHandoffMotion,
  landingHandoffOpacity,
  landingPhaseAt,
  landingPhaseClock,
  landingPhaseMotionClock,
  landingPhaseProgress,
  landingPhaseVisibility,
} from "./landing-flow-phases.js";
import type { LandingFlowTheme, LandingFlowViz } from "./landing-flow-three.js";
import { resolveCssColor } from "./landing-flow-color.js";
import {
  BAR_N,
  BAR_SPAN,
  WAVE_SPEED,
  barX,
  createBarTape,
  type BarTape,
  waveTravel,
} from "./landing-flow-scroll.js";

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
  #tape: BarTape = createBarTape();

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

  /** Keep 2D focal plane centered (matches Three contentRoot). */
  #layoutBias(_w: number, _h: number): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  /** Canvas2D fallback — same narrative phases as Three. */
  #paint2d(t: number): void {
    const c = this.#canvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = this.#cssW;
    const h = this.#cssH;
    const bias = this.#layoutBias(w, h);
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

    const vis = landingPhaseVisibility(phase);

    if (vis.capture > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.capture;
      this.#paint2dCapture(ctx, w, h, t, primary, bias, vis.capture);
      ctx.restore();
    }
    if (vis.detect > 0.001) {
      ctx.save();
      ctx.globalAlpha = vis.detect;
      const detectMix = Math.min(
        1,
        landingPhaseProgress(t, "detect") * 1.4 + 0.15,
      );
      this.#paint2dWaveBg(
        ctx,
        w,
        h,
        t,
        primary,
        muted,
        mid,
        tags,
        detectMix,
        bias,
      );
      this.#paint2dDetectOverlay(ctx, w, h, t, primary, muted, bias);
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
        bias,
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
        bias,
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
        bias,
      );
      ctx.restore();
    }
  }

  #paint2dCapture(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    primary: string,
    bias: { x: number; y: number },
    weight: number,
  ): void {
    const cx = w * 0.5 + bias.x;
    const cy = h * 0.5 + bias.y;
    // Flatten toward a mid line as weight drops (morph into detect).
    const flatten = 1 - weight;
    ctx.fillStyle = primary;
    for (let i = 0; i < 48; i++) {
      const a = i * 1.37 + t * 0.9;
      const r = 40 + (i % 7) * 18 + Math.sin(t + i) * 12;
      const x = cx + Math.cos(a) * r * (1 - flatten * 0.35);
      const y =
        cy +
        Math.sin(a * 1.3) * r * 0.45 * (1 - flatten * 0.92) +
        flatten * Math.sin(i + t) * 4;
      ctx.globalAlpha = 0.25 + (i % 5) * 0.08;
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
    bias: { x: number; y: number },
  ): void {
    const midY = h * 0.5 + bias.y;
    const maxAmp = h * 0.36;
    const travel = waveTravel(landingPhaseClock(t, "detect"), WAVE_SPEED);
    this.#tape.sync(travel);
    const filterX = w * 0.42 + bias.x;
    const filterW = Math.max(18, w * 0.045);

    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    ctx.lineCap = "round";
    for (let i = 0; i < BAR_N; i++) {
      const xWorld = barX(i, travel);
      const x = ((xWorld / BAR_SPAN) + 0.5) * w + bias.x;
      if (x < -4 || x > w + 4) continue;
      const mag = this.#tape.heights[i]!;
      const silent = mag < 0.05;
      const half = silent ? 1.5 : Math.max(2, mag * maxAmp);
      const past = detectMix > 0.02 && x < filterX - filterW / 2;
      const tag = this.#tape.tags[i]!;

      if (past && !silent && tag >= 0 && detectMix > 0.5) {
        ctx.strokeStyle = tags[tag as 0 | 1 | 2];
        ctx.globalAlpha = 0.35 + detectMix * 0.35;
        ctx.lineWidth = 1.75;
      } else {
        ctx.strokeStyle = silent ? muted : mag > 0.5 ? mid : muted;
        ctx.globalAlpha = silent ? 0.12 : 0.18 + mag * 0.2;
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
    bias: { x: number; y: number },
  ): void {
    const midY = h * 0.5 + bias.y;
    const maxAmp = h * 0.36;
    const filterX = w * 0.42 + bias.x;
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
    bias: { x: number; y: number },
  ): void {
    const N = 12;
    const CLIP = 12;
    const perCol = Math.ceil(N / 3);
    const cellW = Math.min(w * 0.12, 44);
    const cellH = Math.min(h * 0.07, 28);
    const gapX = Math.min(w * 0.22, 90);
    const gapY = cellH + 8;
    const cx = w * 0.5 + bias.x;
    const cy = h * 0.5 + bias.y;
    const lanes = 4;
    const laneH = Math.min(h * 0.07, 36);
    const oy = h * 0.32 + bias.y;
    const ox = w * 0.08 + bias.x * 0.5;
    const tw = Math.min(w * 0.84, w - ox - w * 0.06);
    const handoff = landingHandoff(t, "library", "arrange");
    const scroll = landingPhaseMotionClock(t, "arrange") * 0.55;

    for (let c = 0; c < 3; c++) {
      const bx = cx + (c - 1) * gapX;
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.28 * (1 - handoff * 0.9);
      ctx.lineWidth = 1.5;
      const bayH = perCol * gapY + 12;
      ctx.strokeRect(bx - cellW * 0.65, cy - bayH / 2, cellW * 1.3, bayH);
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < N; i++) {
      const tag = i % 3;
      const rank = Math.floor(i / 3);
      const stagger = Math.min(
        1,
        Math.max(0, local * 1.35 - rank * 0.07 - tag * 0.04),
      );
      const settle = 1 - Math.pow(1 - stagger, 3);
      const ax = cx + (tag - 1) * gapX - cellW / 2;
      const ay = cy + (rank - (perCol - 1) / 2) * gapY - cellH / 2;
      const chaosX = Math.sin(i * 2.1 + t * 1.2) * 70;
      const chaosY = Math.cos(i * 1.6 + t * 0.9) * 50;
      let x = ax * settle + (cx + chaosX - cellW / 2) * (1 - settle);
      let y = ay * settle + (cy + chaosY - cellH / 2) * (1 - settle);
      let pw = cellW * 0.72;
      let ph = cellH;
      let fade = 0.55 + settle * 0.4;

      if (i < CLIP) {
        const lane = i % lanes;
        const seed = (i * 0.71) % 0.82;
        const u = (((seed - scroll / tw) % 1) + 1) % 1;
        const gen = Math.floor(scroll / tw + 1 - seed);
        const cw = tw * (0.07 + ((i * 3 + gen * 2) % 5) * 0.02);
        const bx = ox + u * tw;
        const by = oy + lane * (laneH + 10) + laneH * 0.15;
        const d = landingHandoffMotion(t, "library", "arrange", i);
        const o = landingHandoffOpacity(t, "library", "arrange", i);
        x = x + (bx - x) * d;
        y = y + (by - y) * d;
        pw = pw + (cw - pw) * d;
        ph = ph + (laneH * 0.7 - ph) * d;
        fade *= 1 - o;
      }

      ctx.fillStyle = tags[tag]!;
      ctx.globalAlpha = fade;
      ctx.fillRect(x, y, pw, ph);
      ctx.globalAlpha = 1;
    }
  }

  #paint2dArrange(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    _local: number,
    tags: readonly [string, string, string],
    primary: string,
    muted: string,
    bias: { x: number; y: number },
  ): void {
    const lanes = 4;
    const CLIP = 12;
    const handoff = landingHandoff(t, "library", "arrange");
    const laneH = Math.min(h * 0.07, 36);
    const oy = h * 0.32 + bias.y;
    const ox = w * 0.08 + bias.x * 0.5;
    const tw = Math.min(w * 0.84, w - ox - w * 0.06);
    const scroll = landingPhaseMotionClock(t, "arrange") * 0.55;
    const head = ox + 0.08 * tw + ((scroll * 0.4) % 0.85) * tw;
    const libLocal = landingPhaseProgress(t, "library");
    const cx = w * 0.5 + bias.x;
    const cy = h * 0.5 + bias.y;
    const gapX = Math.min(w * 0.22, 90);
    const cellW = Math.min(w * 0.12, 44);
    const cellH = Math.min(h * 0.07, 28);
    const gapY = cellH + 8;
    const perCol = Math.ceil(CLIP / 3);

    for (let l = 0; l < lanes; l++) {
      const y = oy + l * (laneH + 10);
      ctx.fillStyle = muted;
      ctx.globalAlpha = 0.06 + handoff * 0.12;
      ctx.fillRect(ox, y, tw, laneH);
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < CLIP; i++) {
      const lane = i % lanes;
      const tag0 = i % 3;
      const rank = Math.floor(i / 3);
      const stagger = Math.min(
        1,
        Math.max(0, libLocal * 1.35 - rank * 0.07 - tag0 * 0.04),
      );
      const settle = 1 - Math.pow(1 - stagger, 3);
      const ax = cx + (tag0 - 1) * gapX - cellW / 2;
      const ay = cy + (rank - (perCol - 1) / 2) * gapY - cellH / 2;
      const seed = (i * 0.71) % 0.82;
      const u = (((seed - scroll / tw) % 1) + 1) % 1;
      const gen = Math.floor(scroll / tw + 1 - seed);
      const cw = tw * (0.07 + ((i * 3 + gen * 2) % 5) * 0.02);
      const tag = (i + Math.max(0, gen)) % 3;
      const bx = ox + u * tw;
      const by = oy + lane * (laneH + 10) + laneH * 0.15;
      const d = landingHandoffMotion(t, "library", "arrange", i);
      const o = landingHandoffOpacity(t, "library", "arrange", i);
      const x = ax * settle + (bx - ax * settle) * d;
      const y = ay * settle + (by - ay * settle) * d;
      const enter = Math.min(1, Math.max(0, (1 - u) / 0.14));
      const exit = Math.min(1, Math.max(0, u / 0.14));
      ctx.fillStyle = tags[tag]!;
      ctx.globalAlpha = o * enter * exit * (0.45 + o * 0.5);
      ctx.fillRect(
        x,
        y,
        cellW * 0.72 + (cw - cellW * 0.72) * d,
        cellH + (laneH * 0.7 - cellH) * d,
      );
    }

    ctx.strokeStyle = primary;
    ctx.globalAlpha = 0.25 + handoff * 0.55;
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
    bias: { x: number; y: number },
  ): void {
    const cx = w * 0.5 + bias.x;
    const cy = h * 0.5 + bias.y;
    const maxR = Math.min(w, h) * 0.16;
    for (let i = 0; i < 4; i++) {
      const phase = (local + t * 0.25 + i * 0.15) % 1;
      const r = 20 + phase * maxR;
      ctx.strokeStyle = i % 2 === 0 ? primary : tags[1]!;
      ctx.globalAlpha = (1 - phase) * 0.45;
      ctx.lineWidth = 0.5;
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
