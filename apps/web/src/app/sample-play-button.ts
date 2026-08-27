/**
 * Play/pause control for sound list rows (library, capture feed, seq drawer).
 *
 * Subscribes to {@link sampleAuditionKey} so glyph + chrome update when audition
 * ends — even inside sonic-queue rows that do not re-render on parent state.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { subscribe } from "@supersoniks/concorde/decorators";
import { get, set } from "@supersoniks/concorde/utils";
import tailwind from "../css/tailwind";
import { sampleAuditionKey } from "./dp-keys.js";
import { t } from "./i18n/messages.js";
import { glIcon } from "./icon.js";
import { tip } from "./tip.js";

export function setSampleAuditionPlaying(id: string | null): void {
  set(sampleAuditionKey.playingId, id);
}

export function getSampleAuditionPlaying(): string | null {
  const v = get(sampleAuditionKey.playingId);
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Clear audition chrome (page leave / stop). */
export function clearSampleAudition(): void {
  setSampleAuditionPlaying(null);
}

set(sampleAuditionKey, { playingId: null });

const ROW_AUDITION_ATTR = "data-gl-audition";

@customElement("gl-sample-play-button")
export class GlSamplePlayButton extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
        /* Neutralize FormCheckable [active] — on nord that paints a white chip
           (--sc-btn-active-bg = --sc-base-content) and sticks after click. */
        --sc-btn-active-bg: var(--sc-base-100);
        --sc-btn-active-color: var(--sc-base-content);
      }
      :host(:not([playing])) .glyph-pause {
        display: none !important;
      }
      :host([playing]) .glyph-play {
        display: none !important;
      }
      :host(:not([playing])) sonic-button::part(button) {
        background: var(--sc-base-100) !important;
        color: var(--sc-base-content) !important;
        border-color: transparent !important;
      }
      :host([playing]) sonic-button::part(button) {
        background: var(--sc-info) !important;
        color: var(--sc-info-content) !important;
        border-color: transparent !important;
      }
      :host([playing]) {
        --sc-btn-active-bg: var(--sc-info);
        --sc-btn-active-color: var(--sc-info-content);
      }
    `,
  ];

  @property({ type: String }) sampleId = "";
  @property({ type: String }) size: "2xs" | "xs" | "sm" = "xs";
  @property({ type: Boolean }) disabled = false;

  @subscribe(sampleAuditionKey.playingId)
  @state()
  auditionPlayingId: string | null = null;

  #isPlaying(): boolean {
    return !!this.sampleId && this.auditionPlayingId === this.sampleId;
  }

  override updated(): void {
    const playing = this.#isPlaying();
    this.toggleAttribute("playing", playing);
    this.#syncRowHighlight(playing);
    // Drop stuck FormCheckable active (white chip on nord when idle).
    const btn = this.renderRoot.querySelector("sonic-button");
    if (btn?.hasAttribute("active")) btn.removeAttribute("active");
  }

  override disconnectedCallback(): void {
    this.#syncRowHighlight(false);
    super.disconnectedCallback();
  }

  /** sonic-tr type=info — queue rows don't re-render, so paint it here. */
  #syncRowHighlight(playing: boolean): void {
    const row = this.closest("sonic-tr");
    if (!row) return;
    if (playing) {
      row.setAttribute(ROW_AUDITION_ATTR, "");
      row.setAttribute("type", "info");
      return;
    }
    if (!row.hasAttribute(ROW_AUDITION_ATTR)) return;
    row.removeAttribute(ROW_AUDITION_ATTR);
    if (row.getAttribute("type") === "info") row.removeAttribute("type");
  }

  override render() {
    const playing = this.#isPlaying();
    const label = playing ? t("sample.pause") : t("sample.play");
    const iconSize = this.size === "2xs" ? "xs" : "sm";
    return tip(
      label,
      html`
        <sonic-button
          type="default"
          size=${this.size}
          shape="circle"
          icon
          ?disabled=${this.disabled}
          data-aria-label=${label}
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @click=${(e: Event) => {
            e.stopPropagation();
            const btn = e.currentTarget as HTMLElement;
            btn.removeAttribute("active");
            this.dispatchEvent(
              new CustomEvent("gl-sample-play", {
                bubbles: true,
                composed: true,
                detail: { sampleId: this.sampleId },
              }),
            );
          }}
        >
          <span class="glyph-pause" aria-hidden="true"
            >${glIcon("pause", { size: iconSize })}</span
          >
          <span class="glyph-play" aria-hidden="true"
            >${glIcon("play", { size: iconSize })}</span
          >
        </sonic-button>
      `,
    );
  }
}

/**
 * Convenience template for list rows — prefers {@link sampleId} so the button
 * tracks shared audition state (required inside sonic-queue).
 */
export function renderSamplePlayButton(opts: {
  onClick: () => void;
  /** Sample id — enables live play/pause via sampleAuditionKey. */
  sampleId?: string;
  /** @deprecated Prefer sampleId; only used when sampleId is omitted (synth). */
  playing?: boolean;
  disabled?: boolean;
  size?: "2xs" | "xs" | "sm";
}) {
  if (opts.sampleId) {
    return html`
      <gl-sample-play-button
        .sampleId=${opts.sampleId}
        .size=${opts.size ?? "xs"}
        ?disabled=${opts.disabled ?? false}
        @gl-sample-play=${(e: Event) => {
          e.stopPropagation();
          opts.onClick();
        }}
      ></gl-sample-play-button>
    `;
  }
  // Synth drafts etc. — no shared audition id.
  const playing = opts.playing === true;
  const label = playing ? t("sample.pause") : t("sample.play");
  const size = opts.size ?? "xs";
  const iconSize = size === "2xs" ? "xs" : "sm";
  return tip(
    label,
    html`
      <sonic-button
        type=${playing ? "info" : "default"}
        size=${size}
        shape="circle"
        icon
        ?disabled=${opts.disabled ?? false}
        data-aria-label=${label}
        @pointerdown=${(e: Event) => e.stopPropagation()}
        @click=${(e: Event) => {
          e.stopPropagation();
          opts.onClick();
        }}
      >
        ${glIcon(playing ? "pause" : "play", { size: iconSize })}
      </sonic-button>
    `,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-sample-play-button": GlSamplePlayButton;
  }
}
