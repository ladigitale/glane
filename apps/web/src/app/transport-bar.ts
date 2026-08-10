/**
 * Shared transport chrome — editor + sequencer.
 * One large centered play/pause; no stop (pause keeps position).
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { glIcon } from "./icon.js";

export type TransportAction = "play" | "pause";

@customElement("gl-transport-bar")
export class GlTransportBar extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
      }
      /* Right-pointing triangle reads left-heavy; nudge for optical center. */
      .play-glyph {
        display: inline-flex;
        transform: translateX(0.1em);
      }
      .play-btn {
        --sc-btn-min-height: 3.25rem;
      }
    `,
  ];

  @property({ type: Boolean }) playing = false;
  @property({ type: Boolean }) loading = false;
  /** e.g. "0:12" — optional position readout */
  @property({ type: String }) clock = "";
  @property({ type: Boolean }) disabled = false;

  override render() {
    const label = this.playing ? "Pause" : "Play";
    const title = `${label} (Espace)`;
    return html`
      <div
        class="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 px-3.5 py-2"
        role="toolbar"
        aria-label="Transport"
      >
        <div class="flex min-w-0 items-center justify-start gap-2">
          ${this.clock
            ? html`<span
                class="min-w-14 font-mono text-sm text-neutral-500 tabular-nums"
                aria-live="off"
                >${this.clock}</span
              >`
            : nothing}
        </div>
        <div class="flex items-center justify-center">
          <sonic-button
            class="play-btn"
            shape="circle"
            size="2xl"
            type="primary"
            icon
            data-aria-label=${label}
            title=${title}
            ?disabled=${this.disabled}
            ?loading=${this.loading}
            @click=${() => this.#emit(this.playing ? "pause" : "play")}
          >
            ${this.loading
              ? nothing
              : this.playing
                ? glIcon("pause", { size: "xl" })
                : html`<span class="play-glyph"
                    >${glIcon("play", { size: "xl" })}</span
                  >`}
          </sonic-button>
        </div>
        <div class="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
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
