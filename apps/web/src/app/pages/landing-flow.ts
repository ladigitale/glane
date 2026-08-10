import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Abstract loop: field wave → gleaned peaks → arrange grid → listen pulse.
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

  #paint(t: number): void {
    const c = this.#canvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = this.#cssW;
    const h = this.#cssH;
    ctx.clearRect(0, 0, w, h);

    const cycle = 10;
    const phase = this.#reduced ? 2.5 : t % cycle;
    const primary =
      getComputedStyle(this).getPropertyValue("--sc-primary").trim() ||
      "#04d289";
    const muted =
      getComputedStyle(this).getPropertyValue("--sc-neutral-4").trim() ||
      "rgba(128,128,140,0.35)";

    // 1) Continuous field wave
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const mid = h * 0.55;
    for (let x = 0; x <= w; x += 4) {
      const y =
        mid +
        Math.sin(x * 0.018 + phase * 1.2) * (h * 0.06) +
        Math.sin(x * 0.041 - phase * 0.7) * (h * 0.03);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 2–3) Peaks detach then settle into a light grid
    const settle = Math.min(1, Math.max(0, (phase - 2) / 3));
    const arrange = Math.min(1, Math.max(0, (phase - 5) / 2.5));
    const peaks = [
      { bx: 0.22, h0: 0.22, h1: 0.28 },
      { bx: 0.5, h0: 0.38, h1: 0.42 },
      { bx: 0.78, h0: 0.18, h1: 0.26 },
    ];
    const baseY = mid + h * 0.12;
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i]!;
      const xLoose = w * (0.15 + i * 0.28 + Math.sin(phase + i) * 0.04);
      const xGrid = w * p.bx;
      const x = xLoose + (xGrid - xLoose) * arrange;
      const ph = h * (p.h0 + (p.h1 - p.h0) * settle);
      const alpha = 0.25 + 0.75 * settle;
      ctx.fillStyle = primary;
      ctx.globalAlpha = alpha;
      const bw = Math.max(6, w * 0.028);
      ctx.fillRect(x - bw / 2, baseY - ph, bw, ph);
      // diamond head
      const hy = baseY - ph - bw * 0.15;
      ctx.beginPath();
      ctx.moveTo(x, hy - bw * 0.85);
      ctx.lineTo(x + bw * 0.55, hy);
      ctx.lineTo(x, hy + bw * 0.35);
      ctx.lineTo(x - bw * 0.55, hy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 4) Listen pulse (link ring)
    const pulse = Math.min(1, Math.max(0, (phase - 7.5) / 2));
    if (pulse > 0 || this.#reduced) {
      const px = w * 0.5;
      const py = h * 0.22;
      const r = 10 + pulse * 18;
      ctx.strokeStyle = primary;
      ctx.globalAlpha = 0.15 + 0.55 * (this.#reduced ? 0.7 : pulse);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = primary;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
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
