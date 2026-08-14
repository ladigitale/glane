import { LitElement, css, html, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import {
  TRACK_GAIN_LIN_MAX,
  gainDbToLin,
  linToGainDb,
  trackGainAngleToLin,
  trackGainLinToAngle,
} from "./seq-schedule.js";

/**
 * Compact AudioRoom-inspired track volume rotary (0…2× linear → gainDb).
 * Fires `gl-gain` with `{ gainDb, commit }` on drag / release.
 */
@customElement("gl-track-volume-rotary")
export class GlTrackVolumeRotary extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: inline-flex;
        width: 44px;
        height: 44px;
        touch-action: none;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        color: var(--gl-fg);
      }
      :host([compact]) {
        width: 36px;
        height: 36px;
      }
      :host([large]) {
        width: 56px;
        height: 56px;
      }
      :host(:active) {
        cursor: grabbing;
      }
      .ring {
        fill: none;
        stroke: color-mix(in srgb, var(--gl-fg) 28%, transparent);
        stroke-width: 5;
      }
      .fill {
        fill: color-mix(in srgb, var(--gl-accent) 75%, transparent);
      }
      .hub {
        fill: var(--gl-ink-elevated);
        stroke: color-mix(in srgb, var(--gl-fg) 35%, transparent);
        stroke-width: 1;
      }
      .needle {
        stroke: var(--gl-fg);
        stroke-width: 2;
        stroke-linecap: round;
      }
      .tip {
        fill: var(--gl-accent);
      }
    `,
  ];

  @property({ type: Number }) gainDb = 0;
  @property() label = "Volume piste";
  @property({ type: Boolean, reflect: true }) compact = false;
  @property({ type: Boolean, reflect: true }) large = false;

  #dragging = false;

  override render() {
    const lin = gainDbToLin(this.gainDb);
    const angle = trackGainLinToAngle(lin);
    const cx = 22;
    const cy = 22;
    const r = 14;
    const rInner = 9;
    const t0 = Math.PI / 4;
    const arc = this.#arcPath(cx, cy, r, t0, angle);
    const knobX = cx + Math.cos(angle) * (r - 3);
    const knobY = cy + Math.sin(angle) * (r - 3);
    return html`
      <svg
        class="block h-full w-full overflow-visible"
        viewBox="0 0 44 44"
        role="slider"
        aria-valuemin="0"
        aria-valuemax=${TRACK_GAIN_LIN_MAX}
        aria-valuenow=${Number(lin.toFixed(2))}
        aria-label=${this.label}
        @pointerdown=${this.#onDown}
      >
        ${svg`
          <circle class="ring" cx=${cx} cy=${cy} r=${r} />
          ${
            lin > 0
              ? svg`<path class="fill" d=${arc} />`
              : svg``
          }
          <circle class="hub" cx=${cx} cy=${cy} r=${rInner} />
          <line class="needle" x1=${cx} y1=${cy} x2=${knobX} y2=${knobY} />
          <circle class="tip" cx=${knobX} cy=${knobY} r="2.5" />
        `}
      </svg>
    `;
  }

  #arcPath(
    cx: number,
    cy: number,
    r: number,
    t0: number,
    t1: number,
  ): string {
    const steps = 18;
    const span = t1 - t0;
    if (span <= 0.001) return "";
    const pts: string[] = [`M ${cx} ${cy}`];
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (i / steps) * span;
      pts.push(`L ${cx + Math.cos(t) * r} ${cy + Math.sin(t) * r}`);
    }
    pts.push("Z");
    return pts.join(" ");
  }

  #onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    this.#dragging = true;
    const svgEl = e.currentTarget as SVGElement;
    svgEl.setPointerCapture(e.pointerId);
    this.#applyPointer(e);

    const move = (ev: PointerEvent) => {
      if (!this.#dragging) return;
      this.#applyPointer(ev);
    };
    const up = (ev: PointerEvent) => {
      this.#dragging = false;
      this.#applyPointer(ev, true);
      svgEl.removeEventListener("pointermove", move);
      svgEl.removeEventListener("pointerup", up);
      svgEl.removeEventListener("pointercancel", up);
    };
    svgEl.addEventListener("pointermove", move);
    svgEl.addEventListener("pointerup", up);
    svgEl.addEventListener("pointercancel", up);
  };

  #applyPointer(e: PointerEvent, commit = false): void {
    const rect = this.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const lin = trackGainAngleToLin(angle);
    const gainDb = linToGainDb(lin);
    this.gainDb = gainDb;
    this.dispatchEvent(
      new CustomEvent("gl-gain", {
        detail: { gainDb, commit },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-track-volume-rotary": GlTrackVolumeRotary;
  }
}
