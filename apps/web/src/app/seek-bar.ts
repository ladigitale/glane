/**
 * YouTube-style progress scrubber — fixed under transport, above the DAW scroll.
 * Click / drag seeks; optional view window = visible timeline slice on the global bar.
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";

@customElement("gl-seek-bar")
export class GlSeekBar extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        --gl-seek-accent: var(--gl-accent, #c45);
      }
      .wrap:focus-visible .track {
        outline: 2px solid
          color-mix(in srgb, var(--gl-seek-accent) 70%, transparent);
        outline-offset: 3px;
      }
      .wrap[aria-disabled="true"] {
        opacity: 0.45;
        pointer-events: none;
        cursor: default;
      }
      .track {
        position: relative;
        width: 100%;
        height: 3px;
        border-radius: 2px;
        background: color-mix(in srgb, var(--gl-fg) 22%, transparent);
        transition: height 120ms ease;
      }
      .wrap:hover .track,
      .wrap.dragging .track {
        height: 5px;
      }
      .view {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: inherit;
        background: color-mix(in srgb, var(--gl-fg) 28%, transparent);
        box-shadow: inset 0 0 0 1px
          color-mix(in srgb, var(--gl-fg) 18%, transparent);
        pointer-events: none;
      }
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        background: var(--gl-seek-accent);
        pointer-events: none;
      }
      .thumb {
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        margin-top: -6px;
        border-radius: 50%;
        background: var(--gl-seek-accent);
        box-shadow: 0 0 0 1px
          color-mix(in srgb, var(--gl-ink) 35%, transparent);
        pointer-events: none;
        transform: scale(1);
        transition: transform 120ms ease;
      }
      .wrap:hover .thumb,
      .wrap.dragging .thumb {
        transform: scale(1.25);
      }
    `,
  ];

  /** Current position (same unit as `max`). */
  @property({ type: Number }) value = 0;
  /** Duration / end (exclusive upper bound for seek). */
  @property({ type: Number }) max = 1;
  @property({ type: Boolean }) disabled = false;
  /** Visible timeline window start (same unit as `value`). */
  @property({ type: Number }) viewStart = 0;
  /** Visible timeline window end (same unit as `value`). */
  @property({ type: Number }) viewEnd = 0;

  @state() private dragging = false;

  override render() {
    const max = Math.max(1e-9, this.max);
    const pct = Math.min(100, Math.max(0, (this.value / max) * 100));
    const v0 = Math.min(this.viewStart, this.viewEnd);
    const v1 = Math.max(this.viewStart, this.viewEnd);
    const showView = v1 > v0 + max * 1e-6;
    const leftPct = showView
      ? Math.min(100, Math.max(0, (v0 / max) * 100))
      : 0;
    const widthPct = showView
      ? Math.min(100 - leftPct, Math.max(0, ((v1 - v0) / max) * 100))
      : 0;
    return html`
      <div
        class="wrap relative flex h-touch cursor-pointer select-none items-center px-3 touch-none outline-none ${this
          .dragging
          ? "dragging"
          : ""}"
        role="slider"
        tabindex="0"
        aria-valuemin="0"
        aria-valuemax=${Math.round(max)}
        aria-valuenow=${Math.round(this.value)}
        aria-label="Position"
        aria-disabled=${this.disabled ? "true" : "false"}
        @pointerdown=${this.#onDown}
        @keydown=${this.#onKey}
      >
        <div class="track">
          ${showView
            ? html`<div
                class="view"
                style="left:${leftPct}%;width:${widthPct}%"
              ></div>`
            : nothing}
          <div class="fill" style="width:${pct}%"></div>
          <div class="thumb" style="left:${pct}%"></div>
        </div>
      </div>
    `;
  }

  #ratioAtClientX(clientX: number): number {
    const track = this.renderRoot.querySelector(".track") as HTMLElement | null;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  #emitSeek(ratio: number): void {
    const max = Math.max(0, this.max);
    const value = ratio * max;
    this.dispatchEvent(
      new CustomEvent("gl-seek", {
        detail: { value, ratio },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitPhase(name: "gl-seek-start" | "gl-seek-end"): void {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }

  #onDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.#emitPhase("gl-seek-start");
    this.#emitSeek(this.#ratioAtClientX(e.clientX));
    const move = (ev: PointerEvent) => {
      this.#emitSeek(this.#ratioAtClientX(ev.clientX));
    };
    const up = () => {
      this.dragging = false;
      this.#emitPhase("gl-seek-end");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  #onKey = (e: KeyboardEvent): void => {
    if (this.disabled) return;
    const max = Math.max(0, this.max);
    const step = max / 100;
    let next = this.value;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = this.value - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = this.value + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    this.#emitSeek(Math.min(max, Math.max(0, next)) / Math.max(1e-9, max));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-seek-bar": GlSeekBar;
  }
}
