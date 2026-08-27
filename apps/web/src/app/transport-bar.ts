/**
 * Shared transport chrome — editor + sequencer.
 * One large centered play/pause; no stop (pause keeps position).
 *
 * Both glyphs stay mounted; visibility is toggled via host `[playing]` so we
 * never depend on Concorde active/swap or sonic-icon remount races.
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { glIcon } from "./icon.js";
import { tip } from "./tip.js";

export type TransportAction = "play" | "pause";

@customElement("gl-transport-bar")
export class GlTransportBar extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        overflow: visible;
      }
      .toolbar,
      .end,
      .end ::slotted(*) {
        overflow: visible;
      }
      /* Right-pointing triangle reads left-heavy; nudge for optical center. */
      .play-glyph {
        display: inline-flex;
        transform: translateX(0.1em);
      }
      .play-btn {
        --sc-btn-min-height: 3.25rem;
      }
      :host(:not([playing])) .glyph-pause {
        display: none !important;
      }
      :host([playing]) .glyph-play {
        display: none !important;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) playing = false;
  @property({ type: Boolean }) loading = false;
  /** e.g. "0:12" — optional position readout */
  @property({ type: String }) clock = "";
  @property({ type: Boolean }) disabled = false;

  /** Imperative clock — no Lit re-render (transport rAF). */
  paintClock(clock: string): void {
    const el = this.renderRoot.querySelector<HTMLElement>(".clock-readout");
    if (el && el.textContent !== clock) el.textContent = clock;
  }

  override render() {
    const label = this.playing ? "Pause" : "Play";
    const title = `${label} (Espace)`;
    return html`
      <div
        class="toolbar grid min-h-[5.5rem] grid-cols-[1fr_auto_1fr] items-center gap-2.5 overflow-visible px-3.5 py-3"
        role="toolbar"
        aria-label="Transport"
      >
        <div class="flex min-w-0 items-center justify-start gap-2">
          ${this.clock
            ? html`<span
                class="clock-readout min-w-14 font-mono text-sm text-neutral-500 tabular-nums"
                aria-live="off"
                >${this.clock}</span
              >`
            : nothing}
        </div>
        <div class="flex items-center justify-center">
          ${tip(
            title,
            html`
              <sonic-button
                class="play-btn"
                shape="circle"
                size="2xl"
                type="primary"
                icon
                data-aria-label=${label}
                ?disabled=${this.disabled}
                ?loading=${this.loading}
                @click=${() => this.#emit(this.playing ? "pause" : "play")}
              >
                <span class="glyph-pause" aria-hidden="true"
                  >${glIcon("pause", { size: "xl" })}</span
                >
                <span class="glyph-play play-glyph" aria-hidden="true"
                  >${glIcon("play", { size: "xl" })}</span
                >
              </sonic-button>
            `,
          )}
        </div>
        <div
          class="end flex items-center justify-end gap-x-2.5 overflow-visible"
        >
          <slot></slot>
        </div>
      </div>
    `;
  }

  #emit(action: TransportAction): void {
    this.dispatchEvent(
      new CustomEvent("gl-transport", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-transport-bar": GlTransportBar;
  }
}
