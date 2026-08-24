import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { t } from "./i18n/messages.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "./modal-layout.js";

export type GlConfirmOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirm (delete…). */
  danger?: boolean;
};

export type GlUnsavedOpts = {
  title?: string;
  message: string;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
};

export type GlUnsavedChoice = "save" | "discard" | "cancel";

export type GlPromptOpts = {
  title?: string;
  message?: string;
  label?: string;
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type GlAlertOpts = {
  title?: string;
  message: string;
  okLabel?: string;
};

export type GlChooseOption = {
  value: string;
  label: string;
};

export type GlChooseOpts = {
  title?: string;
  message?: string;
  options: GlChooseOption[];
  /** Pre-selected value (defaults to first option). */
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type GlChooseManyOpts = {
  title?: string;
  message?: string;
  options: GlChooseOption[];
  /** Pre-checked values (defaults to all). */
  values?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogKind =
  | "confirm"
  | "prompt"
  | "alert"
  | "unsaved"
  | "choose"
  | "chooseMany";

type Pending = {
  kind: DialogKind;
  title: string;
  message: string;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  discardLabel: string;
  danger: boolean;
  initial: string;
  options: GlChooseOption[];
  values: string[];
  resolve: (value: unknown) => void;
};

/**
 * App dialogs via sonic-modal (never window.alert / confirm / prompt).
 */
export const glDialog = {
  confirm(opts: GlConfirmOpts | string): Promise<boolean> {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return openDialog({
      kind: "confirm",
      title: o.title ?? t("dialog.confirmTitle"),
      message: o.message,
      label: "",
      confirmLabel: o.confirmLabel ?? t("dialog.confirm"),
      cancelLabel: o.cancelLabel ?? t("dialog.cancel"),
      discardLabel: "",
      danger: o.danger ?? false,
      initial: "",
      options: [],
      values: [],
    }) as Promise<boolean>;
  },

  /** Save / discard / cancel — for leaving a dirty editor. */
  unsaved(opts: GlUnsavedOpts | string): Promise<GlUnsavedChoice> {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return openDialog({
      kind: "unsaved",
      title: o.title ?? t("dialog.unsavedTitle"),
      message: o.message,
      label: "",
      confirmLabel: o.saveLabel ?? t("dialog.save"),
      cancelLabel: o.cancelLabel ?? t("dialog.cancel"),
      discardLabel: o.discardLabel ?? t("dialog.discard"),
      danger: false,
      initial: "",
      options: [],
      values: [],
    }) as Promise<GlUnsavedChoice>;
  },

  prompt(opts: GlPromptOpts | string): Promise<string | null> {
    const o = typeof opts === "string" ? { label: opts } : opts;
    return openDialog({
      kind: "prompt",
      title: o.title ?? t("dialog.promptTitle"),
      message: o.message ?? "",
      label: o.label ?? "",
      confirmLabel: o.confirmLabel ?? t("dialog.ok"),
      cancelLabel: o.cancelLabel ?? t("dialog.cancel"),
      discardLabel: "",
      danger: false,
      initial: o.value ?? "",
      options: [],
      values: [],
    }) as Promise<string | null>;
  },

  /** Pick one option from a list — returns value or null if cancelled. */
  choose(opts: GlChooseOpts): Promise<string | null> {
    const options = opts.options.filter((o) => o.value && o.label);
    if (options.length === 0) return Promise.resolve(null);
    const initial =
      opts.value && options.some((o) => o.value === opts.value)
        ? opts.value
        : options[0]!.value;
    return openDialog({
      kind: "choose",
      title: opts.title ?? t("dialog.chooseTitle"),
      message: opts.message ?? "",
      label: "",
      confirmLabel: opts.confirmLabel ?? t("dialog.ok"),
      cancelLabel: opts.cancelLabel ?? t("dialog.cancel"),
      discardLabel: "",
      danger: false,
      initial,
      options,
      values: [],
    }) as Promise<string | null>;
  },

  /** Pick several options — returns checked values, or null if cancelled. */
  chooseMany(opts: GlChooseManyOpts): Promise<string[] | null> {
    const options = opts.options.filter((o) => o.value && o.label);
    if (options.length === 0) return Promise.resolve([]);
    const allowed = new Set(options.map((o) => o.value));
    const values = (opts.values ?? options.map((o) => o.value)).filter((v) =>
      allowed.has(v),
    );
    return openDialog({
      kind: "chooseMany",
      title: opts.title ?? t("dialog.chooseTitle"),
      message: opts.message ?? "",
      label: "",
      confirmLabel: opts.confirmLabel ?? t("dialog.ok"),
      cancelLabel: opts.cancelLabel ?? t("dialog.cancel"),
      discardLabel: "",
      danger: false,
      initial: "",
      options,
      values,
    }) as Promise<string[] | null>;
  },

  alert(opts: GlAlertOpts | string): Promise<void> {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return openDialog({
      kind: "alert",
      title: o.title ?? t("dialog.alertTitle"),
      message: o.message,
      label: "",
      confirmLabel: o.okLabel ?? t("dialog.ok"),
      cancelLabel: "",
      discardLabel: "",
      danger: false,
      initial: "",
      options: [],
      values: [],
    }).then(() => undefined);
  },
} as const;

function openDialog(
  partial: Omit<Pending, "resolve">,
): Promise<unknown> {
  return new Promise((resolve) => {
    const host = document.createElement("gl-dialog-host") as GlDialogHost;
    host.pending = { ...partial, resolve };
    const root =
      document.querySelector("sonic-theme") ??
      document.querySelector("gl-app") ??
      document.body;
    root.appendChild(host);
  });
}

@customElement("gl-dialog-host")
export class GlDialogHost extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: contents;
      }
    `,
  ];

  @property({ attribute: false }) pending: Pending | null = null;

  @state() private open = false;
  @state() private draft = "";
  @state() private picked: string[] = [];

  #settled = false;

  override connectedCallback(): void {
    super.connectedCallback();
    const p = this.pending;
    if (p) {
      this.draft = p.initial;
      this.picked = [...p.values];
      // Open after mount so sonic-modal picks up visible transition.
      queueMicrotask(() => {
        this.open = true;
      });
    }
  }

  override render() {
    const p = this.pending;
    if (!p) return nothing;
    const modalPreset =
      p.kind === "chooseMany" ? "wide" : p.kind === "choose" ? "form" : "compact";
    const m = GL_MODAL_PRESETS[modalPreset];
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.open}
        @hide=${this.#onHide}
      >
        <sonic-modal-title>${p.title}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex flex-col gap-3">
            ${p.message
              ? html`<p class="m-0 whitespace-pre-wrap leading-[1.4]">${p.message}</p>`
              : nothing}
            ${p.kind === "prompt"
              ? html`
                  <input
                    class="rounded-lg border border-neutral-500/25 bg-neutral-0 px-2.5 py-2 text-inherit [font:inherit]"
                    type="text"
                    autofocus
                    aria-label=${p.label || p.title}
                    placeholder=${p.label}
                    .value=${this.draft}
                    @input=${(e: Event) => {
                      this.draft = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        this.#accept();
                      }
                    }}
                  />
                `
              : nothing}
            ${p.kind === "choose"
              ? html`
                  <select
                    class="cursor-pointer rounded-lg border border-neutral-500/25 bg-neutral-0 px-2.5 py-2 text-inherit [font:inherit]"
                    autofocus
                    aria-label=${p.title}
                    .value=${this.draft}
                    @change=${(e: Event) => {
                      this.draft = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    ${p.options.map(
                      (o) =>
                        html`<option value=${o.value}>${o.label}</option>`,
                    )}
                  </select>
                `
              : nothing}
            ${p.kind === "chooseMany" ? this.#renderChooseMany(p) : nothing}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          ${p.kind !== "alert"
            ? html`
                <sonic-button
                  variant="outline"
                  type="neutral"
                  @click=${this.#dismiss}
                >
                  ${p.cancelLabel}
                </sonic-button>
              `
            : nothing}
          ${p.kind === "unsaved"
            ? html`
                <sonic-button
                  variant="outline"
                  type="neutral"
                  @click=${this.#discard}
                >
                  ${p.discardLabel}
                </sonic-button>
              `
            : nothing}
          <sonic-button
            type=${p.danger ? "danger" : "primary"}
            @click=${this.#accept}
          >
            ${p.confirmLabel}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #renderChooseMany(p: Pending) {
    const picked = new Set(this.picked);
    const allOn =
      p.options.length > 0 && p.options.every((o) => picked.has(o.value));
    const someOn = p.options.some((o) => picked.has(o.value));
    return html`
      <label
        class="inline-flex cursor-pointer select-none items-center gap-1.5 font-mono text-xs text-neutral-500"
      >
        <input
          type="checkbox"
          class="h-[18px] w-[18px] cursor-pointer accent-primary"
          .checked=${allOn}
          .indeterminate=${someOn && !allOn}
          @change=${() => {
            this.picked = allOn ? [] : p.options.map((o) => o.value);
          }}
        />
        ${t("dialog.selectAll")}
      </label>
      <sonic-table
        size="sm"
        bordered
        rounded
        maxHeight="min(50vh, 22rem)"
        role="group"
        aria-label=${p.title}
      >
        <sonic-tbody>
          ${p.options.map(
            (o) => html`
              <sonic-tr>
                <sonic-td width="2.5rem" align="center" vAlign="middle">
                  <input
                    type="checkbox"
                    class="h-[18px] w-[18px] cursor-pointer accent-primary"
                    .checked=${picked.has(o.value)}
                    @change=${(e: Event) => {
                      const on = (e.target as HTMLInputElement).checked;
                      const next = new Set(this.picked);
                      if (on) next.add(o.value);
                      else next.delete(o.value);
                      this.picked = [...next];
                    }}
                  />
                </sonic-td>
                <sonic-td minWidth="10rem" vAlign="middle">${o.label}</sonic-td>
              </sonic-tr>
            `,
          )}
        </sonic-tbody>
      </sonic-table>
    `;
  }

  #chosenValues(p: Pending): string[] {
    const picked = new Set(this.picked);
    return p.options.map((o) => o.value).filter((v) => picked.has(v));
  }

  #accept = (): void => {
    const p = this.pending;
    if (!p || this.#settled) return;
    this.#settled = true;
    if (p.kind === "confirm") p.resolve(true);
    else if (p.kind === "unsaved") p.resolve("save" satisfies GlUnsavedChoice);
    else if (p.kind === "prompt" || p.kind === "choose") p.resolve(this.draft);
    else if (p.kind === "chooseMany") p.resolve(this.#chosenValues(p));
    else p.resolve(undefined);
    this.open = false;
  };

  #discard = (): void => {
    const p = this.pending;
    if (!p || this.#settled || p.kind !== "unsaved") return;
    this.#settled = true;
    p.resolve("discard" satisfies GlUnsavedChoice);
    this.open = false;
  };

  #dismiss = (): void => {
    const p = this.pending;
    if (!p || this.#settled) return;
    this.#settled = true;
    if (p.kind === "confirm") p.resolve(false);
    else if (p.kind === "unsaved") p.resolve("cancel" satisfies GlUnsavedChoice);
    else if (
      p.kind === "prompt" ||
      p.kind === "choose" ||
      p.kind === "chooseMany"
    ) {
      p.resolve(null);
    } else p.resolve(undefined);
    this.open = false;
  };

  #onHide = (): void => {
    if (!this.#settled) {
      this.#settled = true;
      const p = this.pending;
      if (p?.kind === "confirm") p.resolve(false);
      else if (p?.kind === "unsaved") p.resolve("cancel" satisfies GlUnsavedChoice);
      else if (
        p?.kind === "prompt" ||
        p?.kind === "choose" ||
        p?.kind === "chooseMany"
      ) {
        p.resolve(null);
      } else p?.resolve(undefined);
    }
    this.remove();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-dialog-host": GlDialogHost;
  }
}
