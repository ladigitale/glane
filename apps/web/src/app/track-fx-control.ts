import {
  COMPRESS_RATIO_MAX,
  COMPRESS_RATIO_MIN,
  COMPRESS_THRESHOLD_DB_MAX,
  COMPRESS_THRESHOLD_DB_MIN,
  DEFAULT_TRACK_FX,
  TRACK_ATTACK_MS_MAX,
  TRACK_DECAY_MS_MAX,
  TRACK_HP_HZ_MAX,
  TRACK_HP_HZ_MIN,
  TRACK_LP_HZ_MAX,
  TRACK_LP_HZ_MIN,
  TRACK_RELEASE_MS_MAX,
  normalizeTrackFx,
  trackFxHasEnvelope,
  trackFxHasHp,
  trackFxHasLp,
  trackFxIsActive,
  trackFxToggleAdsr,
  trackFxToggleHp,
  trackFxToggleLp,
  type TrackFx,
  type TrackFxType,
} from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { glIcon } from "./icon.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "./modal-layout.js";
import "@supersoniks/concorde/fieldset";

const FX_LABEL: Record<TrackFxType, string> = {
  none: "Aucun",
  eq: "EQ",
  echo: "Écho",
  reverb: "Réverb",
  chorus: "Chorus",
  tremolo: "Tremolo",
  vibrato: "Vibrato",
  compressor: "Compresseur",
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

function hzLabel(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10_000 ? 0 : 1)} k`;
  return `${Math.round(hz)} Hz`;
}

function wetHint(fx: TrackFx): string {
  if (fx.type === "eq") {
    return `${fx.low.toFixed(1)}/${fx.mid.toFixed(1)}/${fx.high.toFixed(1)}`;
  }
  if (fx.type === "echo") {
    return `${echoDelayLabel(fx.delayBeats)} · damp ${fx.damping.toFixed(2)}`;
  }
  if (fx.type === "reverb") {
    return `decay ${fx.decay.toFixed(2)} · damp ${fx.damping.toFixed(2)}`;
  }
  if (fx.type === "chorus") {
    return `${fx.rateHz.toFixed(1)} Hz · mix ${fx.mix.toFixed(2)}`;
  }
  if (fx.type === "tremolo" || fx.type === "vibrato") {
    return `${fx.rateHz.toFixed(1)} Hz · depth ${fx.depth.toFixed(2)}`;
  }
  if (fx.type === "compressor") {
    return `${Math.round(fx.thresholdDb)} dB · ${fx.ratio.toFixed(1)}:1`;
  }
  return "";
}

function fxHint(fx: TrackFx): string {
  const parts: string[] = [];
  const wet = wetHint(fx);
  if (wet) parts.push(wet);
  if (trackFxHasHp(fx)) parts.push(`HP ${hzLabel(fx.hpHz)}`);
  if (trackFxHasLp(fx)) parts.push(`LP ${hzLabel(fx.lpHz)}`);
  if (trackFxHasEnvelope(fx)) {
    parts.push(
      `A${Math.round(fx.attackMs)}/D${Math.round(fx.decayMs)}/S${Math.round(fx.sustain * 100)}/R${Math.round(fx.releaseMs)}`,
    );
  }
  return parts.join(" · ");
}

function triggerLabel(fx: TrackFx, hasWet: boolean): string {
  if (hasWet) return FX_LABEL[fx.type];
  const bits: string[] = [];
  if (trackFxHasHp(fx)) bits.push("HP");
  if (trackFxHasLp(fx)) bits.push("LP");
  if (trackFxHasEnvelope(fx)) bits.push("ADSR");
  return bits.length > 0 ? bits.join(" + ") : "FX";
}

/** Condensed FX reminder for track / master gutters (empty if inactive). */
export function formatTrackFxSummary(
  fx: TrackFx,
  wetOnly = false,
): string {
  return formatTrackFxSummaryLines(fx, wetOnly).join(" · ");
}

/** One line per FX family for track gutters (wet, then HP / LP / ADSR). */
export function formatTrackFxSummaryLines(
  fx: TrackFx,
  wetOnly = false,
): string[] {
  const n = normalizeTrackFx(fx);
  const lines: string[] = [];
  if (n.type !== "none") lines.push(FX_LABEL[n.type]);
  if (!wetOnly) {
    if (trackFxHasHp(n)) lines.push("HP");
    if (trackFxHasLp(n)) lines.push("LP");
    if (trackFxHasEnvelope(n)) lines.push("ADSR");
  }
  return lines;
}

/**
 * Track FX — sonic-pop type picker + optional params modal. ADR-0016.
 * Wet insert is exclusive; HP, LP and ADSR are independent filters.
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
      :host([inline]) {
        display: block;
        width: 100%;
        font-size: 0.85rem;
      }
      input[type="range"] {
        accent-color: var(--gl-accent);
      }
      :host([inline]) sonic-fieldset {
        --sc-fieldset-mb: 0;
      }
    `,
  ];

  @property({ attribute: false }) fx: TrackFx = { ...DEFAULT_TRACK_FX };
  /** Show « Paramètres » (wet + selected filters). */
  @property({ type: Boolean }) showSettings = true;
  /** Show « Appliquer » action (editor bake). */
  @property({ type: Boolean }) showApply = false;
  @property({ type: Boolean }) applyDisabled = false;
  @property() applyLabel = "Appliquer";
  @property() size: "2xs" | "xs" | "sm" | "md" = "2xs";
  /** Sequencer gutter — type only, hint stays on the title. */
  @property({ type: Boolean }) compact = false;
  /**
   * Master bus / wet-only: hide HP / LP / ADSR (tone + envelope stay track-only).
   */
  @property({ type: Boolean }) wetOnly = false;
  /**
   * Flat panel (arrangement modals): type + params in fieldsets, no pop / nested modal.
   */
  @property({ type: Boolean, reflect: true }) inline = false;
  /** Accessible name for the trigger button. */
  @property() fxAriaLabel = "Effet piste";

  @state() private settingsOpen = false;

  override render() {
    const fx = normalizeTrackFx(this.fx);
    const hasWet = fx.type !== "none";
    const hasHp = !this.wetOnly && trackFxHasHp(fx);
    const hasLp = !this.wetOnly && trackFxHasLp(fx);
    const hasEnv = !this.wetOnly && trackFxHasEnvelope(fx);
    const hasFilters = hasHp || hasLp || hasEnv;
    const active = this.wetOnly
      ? hasWet
      : trackFxIsActive(fx);
    const hint = this.wetOnly ? wetHint(fx) : fxHint(fx);
    const trigger = this.wetOnly
      ? FX_LABEL[fx.type]
      : triggerLabel(fx, hasWet);
    const canEdit = hasWet || hasFilters;
    const showActions =
      (this.showSettings && canEdit) || (this.showApply && (hasWet || active));
    if (this.inline) return this.#renderInline(fx, hasHp, hasLp, hasEnv);
    return html`
      <sonic-pop
        placement="bottom-start"
        shadow="md"
        @show=${this.#onPopShow}
        @hide=${this.#onPopHide}
      >
        <sonic-button
          size=${this.size}
          variant=${active ? "default" : "outline"}
          type=${active ? "primary" : "neutral"}
          data-aria-label=${this.fxAriaLabel}
          title=${hint ? `${trigger} · ${hint}` : this.fxAriaLabel}
          ?active=${active}
        >
          ${this.compact
            ? trigger
            : html`${trigger}${hint ? ` · ${hint}` : ""}
          ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}`}
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
          ${this.wetOnly
            ? nothing
            : html`
                <sonic-divider></sonic-divider>
                <sonic-menu direction="column" align="left" size="sm">
                  <sonic-menu-item
                    ?active=${hasHp}
                    @click=${() => this.#toggle(trackFxToggleHp)}
                  >
                    Passe-haut
                  </sonic-menu-item>
                  <sonic-menu-item
                    ?active=${hasLp}
                    @click=${() => this.#toggle(trackFxToggleLp)}
                  >
                    Passe-bas
                  </sonic-menu-item>
                  <sonic-menu-item
                    ?active=${hasEnv}
                    @click=${() => this.#toggle(trackFxToggleAdsr)}
                  >
                    ADSR
                  </sonic-menu-item>
                </sonic-menu>
              `}
          ${showActions
            ? html`
                <sonic-divider></sonic-divider>
                <sonic-menu direction="column" align="left" size="sm">
                  ${this.showSettings && canEdit
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
      ${this.#renderSettingsModal(fx, hasWet, hasFilters)}
    `;
  }


  #renderInline(
    fx: TrackFx,
    hasHp: boolean,
    hasLp: boolean,
    hasEnv: boolean,
  ) {
    return html`
      <div class="flex w-full flex-col gap-3 text-content">
        <sonic-fieldset label=${this.fxAriaLabel} tight>
          <div class="flex flex-col gap-2">
            <label
              class="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-sm text-neutral-500"
            >
              <span>Type</span>
              <span class="font-mono text-xs">${FX_LABEL[fx.type]}</span>
              <select
                class="col-span-full m-0 w-full rounded border border-neutral-200 bg-neutral-0 px-2 py-1 text-sm text-content"
                .value=${fx.type}
                aria-label=${this.fxAriaLabel}
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement)
                    .value as TrackFxType;
                  this.#setType(v);
                }}
              >
                ${FX_TYPES.map(
                  (k) => html`
                    <option value=${k} ?selected=${fx.type === k}>
                      ${FX_LABEL[k]}
                    </option>
                  `,
                )}
              </select>
            </label>
            ${this.#wetParams(fx)}
          </div>
        </sonic-fieldset>
        ${this.wetOnly
          ? nothing
          : html`
              <sonic-fieldset label="Passe-haut" tight>
                <div class="flex flex-col gap-2">
                  <label
                    class="flex cursor-pointer items-center gap-2 text-sm text-content"
                  >
                    <input
                      type="checkbox"
                      class="m-0"
                      .checked=${hasHp}
                      @change=${() => this.#toggle(trackFxToggleHp)}
                    />
                    <span>Activer</span>
                  </label>
                  ${hasHp
                    ? this.#slider(
                        "Fréquence",
                        fx.hpHz,
                        TRACK_HP_HZ_MIN,
                        TRACK_HP_HZ_MAX,
                        1,
                        (v) => this.#patch({ hpHz: v }, false),
                        hzLabel(fx.hpHz),
                      )
                    : nothing}
                </div>
              </sonic-fieldset>
              <sonic-fieldset label="Passe-bas" tight>
                <div class="flex flex-col gap-2">
                  <label
                    class="flex cursor-pointer items-center gap-2 text-sm text-content"
                  >
                    <input
                      type="checkbox"
                      class="m-0"
                      .checked=${hasLp}
                      @change=${() => this.#toggle(trackFxToggleLp)}
                    />
                    <span>Activer</span>
                  </label>
                  ${hasLp
                    ? this.#slider(
                        "Fréquence",
                        fx.lpHz,
                        TRACK_LP_HZ_MIN,
                        TRACK_LP_HZ_MAX,
                        10,
                        (v) => this.#patch({ lpHz: v }, false),
                        hzLabel(fx.lpHz),
                      )
                    : nothing}
                </div>
              </sonic-fieldset>
              <sonic-fieldset label="ADSR" tight>
                <div class="flex flex-col gap-2">
                  <label
                    class="flex cursor-pointer items-center gap-2 text-sm text-content"
                  >
                    <input
                      type="checkbox"
                      class="m-0"
                      .checked=${hasEnv}
                      @change=${() => this.#toggle(trackFxToggleAdsr)}
                    />
                    <span>Activer</span>
                  </label>
                  ${hasEnv
                    ? html`
                        ${this.#slider(
                          "Attaque (ms)",
                          fx.attackMs,
                          0,
                          TRACK_ATTACK_MS_MAX,
                          1,
                          (v) => this.#patch({ attackMs: v }, false),
                        )}
                        ${this.#slider(
                          "Decay (ms)",
                          fx.decayMs,
                          0,
                          TRACK_DECAY_MS_MAX,
                          1,
                          (v) => this.#patch({ decayMs: v }, false),
                        )}
                        ${this.#slider(
                          "Sustain",
                          fx.sustain,
                          0,
                          1,
                          0.01,
                          (v) => this.#patch({ sustain: v }, false),
                          `${Math.round(fx.sustain * 100)}%`,
                        )}
                        ${this.#slider(
                          "Release (ms)",
                          fx.releaseMs,
                          0,
                          TRACK_RELEASE_MS_MAX,
                          1,
                          (v) => this.#patch({ releaseMs: v }, false),
                        )}
                      `
                    : nothing}
                </div>
              </sonic-fieldset>
            `}
        ${this.showApply
          ? html`
              <sonic-button
                type="primary"
                size="sm"
                ?disabled=${this.applyDisabled}
                @click=${this.#apply}
              >
                ${this.applyLabel}
              </sonic-button>
            `
          : nothing}
      </div>
    `;
  }

  #onPopShow = (): void => {
    this.#emitPop(true);
  };

  #onPopHide = (): void => {
    this.#emitPop(false);
  };

  #emitPop(open: boolean) {
    this.dispatchEvent(
      new CustomEvent("gl-fx-pop", {
        detail: { open },
        bubbles: true,
        composed: true,
      }),
    );
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

  #renderSettingsModal(fx: TrackFx, hasWet: boolean, hasFilters: boolean) {
    const m = GL_MODAL_PRESETS.form;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.settingsOpen}
        @hide=${this.#onHideSettings}
      >
        <sonic-modal-title
          >${hasWet
            ? `${FX_LABEL[fx.type]} — paramètres`
            : hasFilters
              ? "Filtres"
              : "Paramètres"}</sonic-modal-title
        >
        <sonic-modal-content>
          ${this.#params(fx)}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            Fermer
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

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
    return html`
      <div class="flex flex-col gap-3 text-content">
        ${this.#wetParams(fx)}
        ${this.wetOnly ? nothing : this.#filterParams(fx)}
      </div>
    `;
  }

  #wetParams(fx: TrackFx) {
    if (fx.type === "eq") {
      return html`
        <div class="flex flex-col gap-2">
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
        <div class="flex flex-col gap-2">
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
          ${this.#slider("Damping", fx.damping, 0, 1, 0.01, (v) =>
            this.#patch({ damping: v }, false),
          )}
        </div>
      `;
    }
    if (fx.type === "reverb") {
      return html`
        <div class="flex flex-col gap-2">
          ${this.#slider("Mix", fx.mix, 0, 1, 0.01, (v) =>
            this.#patch({ mix: v }, false),
          )}
          ${this.#slider("Decay", fx.decay, 0, 1, 0.01, (v) =>
            this.#patch({ decay: v }, false),
          )}
          ${this.#slider("Damping", fx.damping, 0, 1, 0.01, (v) =>
            this.#patch({ damping: v }, false),
          )}
        </div>
      `;
    }
    if (fx.type === "chorus") {
      return html`
        <div class="flex flex-col gap-2">
          ${this.#slider("Mix", fx.mix, 0, 1, 0.01, (v) =>
            this.#patch({ mix: v }, false),
          )}
          ${this.#slider("Vitesse (Hz)", fx.rateHz, 0.1, 8, 0.05, (v) =>
            this.#patch({ rateHz: v }, false),
          )}
          ${this.#slider("Profondeur", fx.depth, 0, 1, 0.01, (v) =>
            this.#patch({ depth: v }, false),
          )}
        </div>
      `;
    }
    if (fx.type === "tremolo" || fx.type === "vibrato") {
      return html`
        <div class="flex flex-col gap-2">
          ${this.#slider("Vitesse (Hz)", fx.rateHz, 0.1, 12, 0.05, (v) =>
            this.#patch({ rateHz: v }, false),
          )}
          ${this.#slider("Profondeur", fx.depth, 0, 1, 0.01, (v) =>
            this.#patch({ depth: v }, false),
          )}
        </div>
      `;
    }
    if (fx.type === "compressor") {
      return html`
        <div class="flex flex-col gap-2">
          ${this.#slider(
            "Seuil (dB)",
            fx.thresholdDb,
            COMPRESS_THRESHOLD_DB_MIN,
            COMPRESS_THRESHOLD_DB_MAX,
            1,
            (v) => this.#patch({ thresholdDb: v }, false),
            `${Math.round(fx.thresholdDb)} dB`,
          )}
          ${this.#slider(
            "Ratio",
            fx.ratio,
            COMPRESS_RATIO_MIN,
            COMPRESS_RATIO_MAX,
            0.1,
            (v) => this.#patch({ ratio: v }, false),
            `${fx.ratio.toFixed(1)}:1`,
          )}
          ${this.#slider(
            "Makeup",
            fx.mix,
            0,
            1,
            0.01,
            (v) => this.#patch({ mix: v }, false),
            `+${(fx.mix * 12).toFixed(1)} dB`,
          )}
        </div>
      `;
    }
    return nothing;
  }

  #filterParams(fx: TrackFx) {
    const hasHp = trackFxHasHp(fx);
    const hasLp = trackFxHasLp(fx);
    const hasEnv = trackFxHasEnvelope(fx);
    if (!hasHp && !hasLp && !hasEnv) return nothing;
    const showHead = fx.type !== "none";
    return html`
      <div class="flex flex-col gap-2">
        ${showHead
          ? html`
              <p
                class="m-0 border-t border-neutral-200 pt-2 text-xs font-medium text-neutral-500"
              >
                Filtres
              </p>
            `
          : nothing}
        ${hasHp
          ? this.#slider(
              "Passe-haut",
              fx.hpHz,
              TRACK_HP_HZ_MIN,
              TRACK_HP_HZ_MAX,
              1,
              (v) => this.#patch({ hpHz: v }, false),
              hzLabel(fx.hpHz),
            )
          : nothing}
        ${hasLp
          ? this.#slider(
              "Passe-bas",
              fx.lpHz,
              TRACK_LP_HZ_MIN,
              TRACK_LP_HZ_MAX,
              10,
              (v) => this.#patch({ lpHz: v }, false),
              hzLabel(fx.lpHz),
            )
          : nothing}
        ${hasEnv
          ? html`
              ${hasHp || hasLp
                ? html`
                    <p
                      class="m-0 pt-1 text-xs font-medium text-neutral-500"
                    >
                      ADSR
                    </p>
                  `
                : nothing}
              ${this.#slider(
                "Attaque (ms)",
                fx.attackMs,
                0,
                TRACK_ATTACK_MS_MAX,
                1,
                (v) => this.#patch({ attackMs: v }, false),
              )}
              ${this.#slider(
                "Decay (ms)",
                fx.decayMs,
                0,
                TRACK_DECAY_MS_MAX,
                1,
                (v) => this.#patch({ decayMs: v }, false),
              )}
              ${this.#slider(
                "Sustain",
                fx.sustain,
                0,
                1,
                0.01,
                (v) => this.#patch({ sustain: v }, false),
                `${Math.round(fx.sustain * 100)}%`,
              )}
              ${this.#slider(
                "Release (ms)",
                fx.releaseMs,
                0,
                TRACK_RELEASE_MS_MAX,
                1,
                (v) => this.#patch({ releaseMs: v }, false),
              )}
            `
          : nothing}
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
    display?: string,
  ) {
    const disp =
      display ??
      (step >= 1 ? String(Math.round(value)) : value.toFixed(2));
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
    if (!this.inline) this.#hidePop();
    const next = normalizeTrackFx({ ...this.fx, type });
    this.fx = next;
    this.#emit(next, true);
  }

  #toggle(fn: (fx: TrackFx) => TrackFx) {
    const next = fn(this.fx);
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
