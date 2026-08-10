import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { glIcon } from "./icon.js";

export type PopSelectOption = { value: string; label: string };

export type PopSelectAction = {
  id: string;
  label: string;
  icon?: string;
};

const SEARCH_THRESHOLD = 8;

/**
 * Select via sonic-pop + sonic-menu (preferred over sonic-select).
 * Local search field when options.length >= 8.
 * Fires `gl-change` with `{ value }`.
 */
@customElement("gl-pop-select")
export class GlPopSelect extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: inline-block;
        max-width: 100%;
        vertical-align: middle;
      }
    `,
  ];

  @property() value = "";
  @property({ attribute: false }) options: readonly PopSelectOption[] = [];
  @property({ attribute: false }) actions: readonly PopSelectAction[] = [];
  @property() placeholder = "…";
  @property() size: "2xs" | "xs" | "sm" | "md" | "lg" = "sm";
  @property() variant: "default" | "outline" | "ghost" | "link" = "outline";
  @property() label = "";
  @property() searchPlaceholder = "Rechercher…";
  @property({ type: Boolean }) disabled = false;
  /** Highlight trigger when value differs from empty / default. */
  @property({ type: Boolean }) active = false;

  @state() private searchQ = "";

  get #filtered(): readonly PopSelectOption[] {
    const q = this.searchQ.trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter((o) => o.label.toLowerCase().includes(q));
  }

  override render() {
    const current = this.options.find((o) => o.value === this.value);
    const text = current?.label ?? this.placeholder;
    const searchable = this.options.length >= SEARCH_THRESHOLD;
    const list = this.#filtered;
    const hasActions = this.actions.length > 0;

    return html`
      ${this.label
        ? html`<span class="mb-0.5 block text-[0.7rem] text-neutral-500"
            >${this.label}</span
          >`
        : nothing}
      <sonic-pop
        placement="bottom-start"
        shadow="md"
        @show=${() => {
          this.searchQ = "";
        }}
      >
        <sonic-button
          variant=${this.variant}
          type="neutral"
          size=${this.size}
          ?disabled=${this.disabled}
          ?active=${this.active}
        >
          <span
            class="max-w-[min(12rem,48vw)] overflow-hidden text-ellipsis whitespace-nowrap"
            >${text}</span
          >
          ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}
        </sonic-button>
        <div
          slot="content"
          class="flex min-w-[min(11rem,85vw)] max-w-[min(18rem,92vw)] flex-col gap-1.5 bg-neutral-0 p-2 text-content"
          @click=${(e: Event) => e.stopPropagation()}
        >
          ${searchable
            ? html`
                <sonic-input
                  class="box-border w-full"
                  type="search"
                  size="sm"
                  inlineContent
                  placeholder=${this.searchPlaceholder}
                  .value=${this.searchQ}
                  @change=${(e: Event) => {
                    this.searchQ = String(
                      (e.target as HTMLInputElement).value ?? "",
                    );
                  }}
                  @click=${(e: Event) => e.stopPropagation()}
                >
                  ${glIcon("search", { slot: "prefix", size: "xs" })}
                </sonic-input>
              `
            : nothing}
          <div class="max-h-56 overflow-auto">
            ${list.length === 0
              ? html`<div class="px-2 py-1.5 text-xs text-neutral-500">
                  Aucun résultat
                </div>`
              : html`
                  <sonic-menu direction="column" align="left" size=${this.size}>
                    ${list.map(
                      (o) => html`
                        <sonic-menu-item
                          ?active=${o.value === this.value}
                          @click=${() => this.#pick(o.value)}
                        >
                          ${o.label}
                        </sonic-menu-item>
                      `,
                    )}
                  </sonic-menu>
                `}
          </div>
          ${hasActions
            ? html`
                <sonic-divider></sonic-divider>
                <sonic-menu direction="column" align="left" size=${this.size}>
                  ${this.actions.map(
                    (a) => html`
                      <sonic-menu-item @click=${() => this.#action(a.id)}>
                        ${a.icon
                          ? glIcon(a.icon, { slot: "prefix", size: "xs" })
                          : nothing}
                        ${a.label}
                      </sonic-menu-item>
                    `,
                  )}
                </sonic-menu>
              `
            : nothing}
        </div>
      </sonic-pop>
    `;
  }

  #hidePop() {
    const pop = this.renderRoot.querySelector("sonic-pop") as
      | { hide?: () => void }
      | null;
    pop?.hide?.();
  }

  #pick(value: string) {
    this.#hidePop();
    if (value === this.value) return;
    this.value = value;
    this.searchQ = "";
    this.dispatchEvent(
      new CustomEvent("gl-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #action(id: string) {
    this.#hidePop();
    this.searchQ = "";
    this.dispatchEvent(
      new CustomEvent("gl-action", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-pop-select": GlPopSelect;
  }
}
