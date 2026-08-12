import {
  DEFAULT_TRACK_FX,
  normalizeTrackFx,
  type TrackFx,
  type TrackFxType,
} from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { glIcon } from "./icon.js";

const FX_LABEL: Record<TrackFxType, string> = {
  none: "Aucun",
  eq: "EQ",
  echo: "Écho",
  reverb: "Réverb",
};

const FX_TYPES = Object.keys(FX_LABEL) as TrackFxType[];

/** Musical echo delay choices (beats; 1 = quarter note). */
const ECHO_DELAY_CHOICES: ReadonlyArray<{ beats: number; label: string }> = [
  { beats: 0.25, label: "1/16" },
  { beats: 0.5, label: "1/8" },
  { beats: 0.75, label: "1/8." },
  { beats: 1, label: "1/4" },
  { beats: 1.5, label: "1/4." },
  { beats: 2, label: "1/2" },
  { beats: 3, label: "3/4" },
  { beats: 4, label: "1/1" },
];

function echoDelayLabel(beats: number): string {
  const hit = ECHO_DELAY_CHOICES.find(
    (c) => Math.abs(c.beats - beats) < 0.001,
  );
  if (hit) return hit.label;
  return `${beats.toFixed(2)} t`;
}

function nearestEchoDelay(beats: number): number {
  let best = ECHO_DELAY_CHOICES[0]!.beats;
  let bestD = Infinity;
  for (const c of ECHO_DELAY_CHOICES) {
    const d = Math.abs(c.beats - beats);
    if (d < bestD) {
      bestD = d;
      best = c.beats;
    }
  }
  return best;
}

function fxHint(fx: TrackFx): string {
  if (fx.type === "eq") {
    return `${fx.low.toFixed(1)}/${fx.mid.toFixed(1)}/${fx.high.toFixed(1)}`;
  }
  if (fx.type === "echo") {
    return `${echoDelayLabel(fx.delayBeats)} · mix ${fx.mix.toFixed(2)}`;
  }
  if (fx.type === "reverb") {
    return `decay ${fx.decay.toFixed(2)} · mix ${fx.mix.toFixed(2)}`;
  }
  return "";
}

/**
 * Track FX — sonic-pop type picker + optional params modal. ADR-0016.
 * Fires `gl-fx` with `{ fx, commit }`, optional `gl-fx-apply` when showApply.
 */
@customElement("gl-track-fx-control")
export class GlTrackFxControl extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: inline-block;
        font-size: 0.65rem;
        color: var(--gl-fg);
        vertical-align: middle;
      }
      input[type="range"] {
        accent-color: var(--gl-accent);
      }
    `,
  ];

  @property({ attribute: false }) fx: TrackFx = { ...DEFAULT_TRACK_FX };
  /** Show « Paramètres » when type ≠ none. */
  @property({ type: Boolean }) showSettings = true;
  /** Show « Appliquer » action (editor bake). */
  @property({ type: Boolean }) showApply = false;
  @property({ type: Boolean }) applyDisabled = false;
  @property() applyLabel = "Appliquer";
  @property() size: "2xs" | "xs" | "sm" | "md" = "2xs";

  @state() private settingsOpen = false;

  override render() {
    const fx = normalizeTrackFx(this.fx);
    const hasParams = fx.type !== "none";
    const hint = fxHint(fx);
    const trigger = fx.type === "none" ? "FX" : FX_LABEL[fx.type];
    return html`
      <sonic-pop placement="bottom-start" shadow="md">
        <sonic-button
          size=${this.size}
          variant=${hasParams ? "default" : "outline"}
          type=${hasParams ? "primary" : "neutral"}
          data-aria-label="Effet piste"
          title=${hint ? `${trigger} · ${hint}` : "Effet piste"}
          ?active=${hasParams}
        >
          ${trigger}${hint ? ` · ${hint}` : ""}
          ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}
        </sonic-button>
        <div
          slot="content"
          class="flex min-w-40 flex-col gap-1.5 bg-neutral-0 p-1.5 text-content"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <sonic-menu direction="column" align="left" size="sm">
            ${FX_TYPES.map(
              (k) => html`
                <sonic-menu-item
                  ?active=${fx.type === k}
                  @click=${() => this.#setType(k)}
                >
                  ${FX_LABEL[k]}
                </sonic-menu-item>
              `,
            )}
          </sonic-menu>
          ${hasParams && (this.showSettings || this.showApply)
            ? html`
                <sonic-divider></sonic-divider>
                <sonic-menu direction="column" align="left" size="sm">
                  ${this.showSettings
                    ? html`
                        <sonic-menu-item @click=${this.#openSettings}>
                          ${glIcon("sliders", {
                            slot: "prefix",
                            size: "xs",
                          })}
                          Paramètres${hint ? ` · ${hint}` : ""}
                        </sonic-menu-item>
                      `
                    : nothing}
                  ${this.showApply
                    ? html`
                        <sonic-menu-item
                          ?disabled=${this.applyDisabled}
                          @click=${this.#apply}
                        >
                          ${glIcon("check", { slot: "prefix", size: "xs" })}
                          ${this.applyLabel}
                        </sonic-menu-item>
                      `
                    : nothing}
                </sonic-menu>
              `
            : nothing}
        </div>
      </sonic-pop>
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${this.settingsOpen}
        @hide=${this.#onHideSettings}
      >
        <sonic-modal-title
          >${FX_LABEL[fx.type]} — paramètres</sonic-modal-title
        >
        <sonic-modal-content>
          ${hasParams ? this.#params(fx) : nothing}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            Fermer
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #hidePop() {
    const pop = this.renderRoot.querySelector("sonic-pop") as
      | { hide?: () => void }
      | null;
    pop?.hide?.();
  }

  #openSettings = (): void => {
    this.#hidePop();
    this.settingsOpen = true;
  };

  #onHideSettings = (): void => {
    this.settingsOpen = false;
  };

  #apply = (): void => {
    this.#hidePop();
    this.dispatchEvent(
      new CustomEvent("gl-fx-apply", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  #params(fx: TrackFx) {
    if (fx.type === "eq") {
      return html`
        <div class="flex flex-col gap-2 text-content">
          ${this.#slider("Graves", fx.low, 0, 2, 0.01, (v) =>
            this.#patch({ low: v }, false),
          )}
          ${this.#slider("Médiums", fx.mid, 0, 2, 0.01, (v) =>
            this.#patch({ mid: v }, false),
          )}
          ${this.#slider("Aigus", fx.high, 0, 2, 0.01, (v) =>
            this.#patch({ high: v }, false),
          )}
        </div>
      `;
    }
    if (fx.type === "echo") {
      const delayBeats = nearestEchoDelay(fx.delayBeats);
      return html`
        <div class="flex flex-col gap-2 text-content">
          ${this.#slider("Mix", fx.mix, 0, 1, 0.01, (v) =>
            this.#patch({ mix: v }, false),
          )}
          <label
            class="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-sm text-neutral-500"
          >
            <span>Délai</span>
            <span class="font-mono text-xs">${echoDelayLabel(delayBeats)}</span>
            <select
              class="col-span-full m-0 w-full rounded border border-neutral-200 bg-neutral-0 px-2 py-1 text-sm text-content"
              .value=${String(delayBeats)}
              @change=${(e: Event) => {
                const v = Number((e.target as HTMLSelectElement).value);
                this.#patch({ delayBeats: v }, true);
              }}
            >
              ${ECHO_DELAY_CHOICES.map(
                (c) => html`
                  <option value=${c.beats} ?selected=${c.beats === delayBeats}>
                    ${c.label}
                  </option>
                `,
              )}
            </select>
          </label>
          ${this.#slider("Feedback", fx.feedback, 0, 0.9, 0.01, (v) =>
            this.#patch({ feedback: v }, false),
          )}
        </div>
      `;
    }
    return html`
      <div class="flex flex-col gap-2 text-content">
        ${this.#slider("Mix", fx.mix, 0, 1, 0.01, (v) =>
          this.#patch({ mix: v }, false),
        )}
        ${this.#slider("Decay", fx.decay, 0, 1, 0.01, (v) =>
          this.#patch({ decay: v }, false),
        )}
      </div>
    `;
  }

  #slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onInput: (v: number) => void,
  ) {
    const disp =
      step >= 1 ? String(Math.round(value)) : value.toFixed(2);
    return html`
      <label
        class="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-sm text-neutral-500"
      >
        <span>${label}</span>
        <span class="font-mono text-xs">${disp}</span>
        <input
          class="col-span-full m-0 w-full"
          type="range"
          min=${min}
          max=${max}
          step=${step}
          .valueAsNumber=${value}
          @input=${(e: Event) =>
            onInput((e.target as HTMLInputElement).valueAsNumber)}
          @change=${() => this.#emit(normalizeTrackFx(this.fx), true)}
        />
      </label>
    `;
  }

  #setType(type: TrackFxType) {
    this.#hidePop();
    const next = normalizeTrackFx({ ...this.fx, type });
    this.fx = next;
    this.#emit(next, true);
  }

  #patch(partial: Partial<TrackFx>, commit: boolean) {
    const next = normalizeTrackFx({ ...this.fx, ...partial });
    this.fx = next;
    this.#emit(next, commit);
  }

  #emit(fx: TrackFx, commit: boolean) {
    this.dispatchEvent(
      new CustomEvent("gl-fx", {
        detail: { fx, commit },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-track-fx-control": GlTrackFxControl;
  }
}
