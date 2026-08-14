import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";

/** Map linear amplitude to a −48…0 dB meter width. */
function linToPct(lin: number): number {
  if (!(lin > 1e-6)) return 0;
  const db = 20 * Math.log10(lin);
  return Math.min(100, Math.max(0, ((db + 48) / 48) * 100));
}

function peakDbLabel(peak: number): string {
  if (peak < 1e-6) return "−∞";
  const db = 20 * Math.log10(peak);
  return `${Math.max(-60, Math.min(6, db)).toFixed(0)}`;
}

/** Hold new peaks this long before decay starts. */
const PEAK_HOLD_MS = 420;
/** Linear decay rate once hold expires (~1.6 s from 1 → 0). */
const PEAK_DECAY_PER_S = 0.62;

/**
 * Discrete master VU (RMS fill + peak tick). Reads an AnalyserNode tap
 * on its own rAF so the host page does not re-render at 60 fps.
 */
@customElement("gl-vu-meter")
export class GlVuMeter extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        box-sizing: border-box;
        width: 0.35rem;
        height: 56px;
        flex-shrink: 0;
        color: var(--gl-fg);
      }
      .track {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border-radius: 2px;
        background: color-mix(in srgb, var(--gl-fg) 18%, var(--gl-ink-elevated));
        border: 1px solid color-mix(in srgb, var(--gl-fg) 22%, transparent);
        overflow: hidden;
      }
      .rms,
      .peak-tick {
        position: absolute;
        left: 0;
        right: 0;
      }
      .rms {
        bottom: 0;
        border-radius: 1px;
        background: color-mix(in srgb, var(--gl-accent) 65%, transparent);
      }
      .peak-tick {
        height: 1.5px;
        background: color-mix(in srgb, var(--gl-fg) 75%, transparent);
      }
      :host([hot]) .rms {
        background: color-mix(in srgb, var(--gl-danger) 70%, var(--gl-accent));
      }
      :host([hot]) .peak-tick {
        background: var(--gl-danger);
      }
    `,
  ];

  @property({ attribute: false }) analyser: AnalyserNode | null = null;
  @property({ type: Boolean }) active = false;
  @property() label = "Niveau";

  @state() private rms = 0;
  @state() private peak = 0;

  #raf = 0;
  #buf: Float32Array<ArrayBuffer> | null = null;
  /** Held peak (linear); falls slowly after a short hold. */
  #peakHold = 0;
  #peakHoldUntil = 0;
  #lastTickMs = 0;

  override updated(): void {
    if (this.analyser && (this.active || this.rms > 0.001 || this.peak > 0.001)) {
      this.#arm();
    }
  }

  override disconnectedCallback(): void {
    this.#cancel();
    super.disconnectedCallback();
  }

  override render() {
    const rmsPct = linToPct(this.rms);
    const peakPct = linToPct(this.peak);
    return html`
      <div
        class="track"
        role="meter"
        aria-label=${this.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${Math.round(peakPct)}
        aria-valuetext=${`${peakDbLabel(this.peak)} dB`}
      >
        <i class="rms" style="height:${rmsPct}%"></i>
        <i class="peak-tick" style="bottom:calc(${peakPct}% - 1px)"></i>
      </div>
    `;
  }

  #arm(): void {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  #cancel(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#lastTickMs = 0;
  }

  #tick = (now: number): void => {
    this.#raf = 0;
    const dt = this.#lastTickMs
      ? Math.min(0.05, (now - this.#lastTickMs) / 1000)
      : 0.016;
    this.#lastTickMs = now;

    if (this.active && this.analyser) {
      this.#read(this.analyser, now, dt);
    } else {
      this.rms = this.rms < 0.003 ? 0 : this.rms * Math.exp(-12 * dt);
      this.#decayPeak(now, dt);
    }
    const hot = this.peak > 0.95;
    if (hot) this.setAttribute("hot", "");
    else this.removeAttribute("hot");
    if (this.active || this.rms > 0 || this.peak > 0) this.#arm();
  };

  #decayPeak(now: number, dt: number): void {
    if (now < this.#peakHoldUntil) {
      this.peak = this.#peakHold;
      return;
    }
    if (this.#peakHold <= 0.001) {
      this.#peakHold = 0;
      this.peak = 0;
      return;
    }
    this.#peakHold = Math.max(
      0,
      this.#peakHold - PEAK_DECAY_PER_S * dt,
    );
    this.peak = this.#peakHold;
  }

  #read(a: AnalyserNode, now: number, dt: number): void {
    const n = a.fftSize;
    if (!this.#buf || this.#buf.length !== n) {
      this.#buf = new Float32Array(new ArrayBuffer(n * 4));
    }
    a.getFloatTimeDomainData(this.#buf);
    let sumSq = 0;
    let instant = 0;
    for (let i = 0; i < n; i++) {
      const v = this.#buf[i]!;
      const abs = Math.abs(v);
      if (abs > instant) instant = abs;
      sumSq += v * v;
    }
    this.rms = Math.sqrt(sumSq / n);
    if (instant >= this.#peakHold) {
      this.#peakHold = instant;
      this.#peakHoldUntil = now + PEAK_HOLD_MS;
      this.peak = instant;
    } else {
      this.#decayPeak(now, dt);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-vu-meter": GlVuMeter;
  }
}
