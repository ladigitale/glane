import { html, nothing, type TemplateResult } from "lit";
import { glIcon } from "./icon.js";

export type MoreMenuItem = {
  label: string;
  icon?: string;
  /** Secondary value shown after the label (e.g. stretch ratio). */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Radio-like: current choice highlighted. */
  active?: boolean;
  onClick: () => void;
};

export type MoreMenuEntry =
  | MoreMenuItem
  | "divider"
  | { section: string };

/** Page chrome more (breadcrumb row) — published by the active page. */
export type ChromeMoreState = {
  ariaLabel: string;
  items: readonly MoreMenuEntry[];
};

const CHROME_MORE_EMPTY: ChromeMoreState = { ariaLabel: "", items: [] };

function chromeMoreSig(state: ChromeMoreState): string {
  return [
    state.ariaLabel,
    ...state.items.map((e) => {
      if (e === "divider") return "|";
      if ("section" in e) return `s:${e.section}`;
      return [
        e.label,
        e.hint ?? "",
        e.icon ?? "",
        e.disabled ? "1" : "0",
        e.active ? "1" : "0",
        e.danger ? "1" : "0",
      ].join(":");
    }),
  ].join("\0");
}

type ChromeMoreListener = () => void;

let chromeMoreCurrent: ChromeMoreState = CHROME_MORE_EMPTY;
let chromeMoreLastSig = "";
const chromeMoreListeners = new Set<ChromeMoreListener>();

/**
 * Single source for the breadcrumb-row more-vertical.
 * Module store (not DataProvider) — items carry onClick callbacks.
 * Pages: `chromeMore.set` from `updated`, `clear` on disconnect.
 * App: `chromeMore.subscribe` → local @state.
 */
export const chromeMore = {
  get(): ChromeMoreState {
    return chromeMoreCurrent;
  },
  set(state: ChromeMoreState): void {
    const next: ChromeMoreState = {
      ariaLabel: state.ariaLabel,
      items: state.items ?? [],
    };
    const sig = chromeMoreSig(next);
    if (sig === chromeMoreLastSig) return;
    chromeMoreLastSig = sig;
    chromeMoreCurrent = next;
    for (const listener of chromeMoreListeners) listener();
  },
  clear(): void {
    if (chromeMoreLastSig === "") return;
    chromeMoreLastSig = "";
    chromeMoreCurrent = CHROME_MORE_EMPTY;
    for (const listener of chromeMoreListeners) listener();
  },
  subscribe(listener: ChromeMoreListener): () => void {
    chromeMoreListeners.add(listener);
    return () => {
      chromeMoreListeners.delete(listener);
    };
  },
} as const;

/**
 * Ellipsis actions menu — vertical by default; horizontal for list-row actions.
 * Page chrome: prefer `chromeMore.set` so the trigger sits on the breadcrumb row.
 */
export function renderMoreMenu(opts: {
  ariaLabel: string;
  items: readonly MoreMenuEntry[];
  size?: "2xs" | "xs" | "sm" | "md";
  /** List-row menus keep horizontal; toolbars / batch use vertical (default). */
  icon?: "vertical" | "horizontal";
}): TemplateResult {
  const size = opts.size ?? "sm";
  const icon =
    opts.icon === "horizontal" ? "more-horizontal" : "more-vertical";
  const items = opts.items ?? [];
  return html`
    <sonic-pop placement="bottom">
      <sonic-button
        shape="circle"
        variant="ghost"
        type="neutral"
        size=${size}
        icon
        data-aria-label=${opts.ariaLabel}
      >
        ${glIcon(icon, { size: "sm" })}
      </sonic-button>
      <div
        slot="content"
        class="max-h-[min(70dvh,24rem)] overflow-y-auto overscroll-contain"
      >
        <sonic-menu direction="column" align="left" size=${size}>
          ${items.map((item) => {
            if (item === "divider") {
              return html`<sonic-divider></sonic-divider>`;
            }
            if ("section" in item) {
              return html`
                <sonic-divider
                  label=${item.section}
                  align="left"
                  size=${size}
                ></sonic-divider>
              `;
            }
            return html`
              <sonic-menu-item
                ?disabled=${item.disabled}
                ?active=${item.active}
                type=${item.danger ? "danger" : "default"}
                @click=${item.onClick}
              >
                ${item.icon
                  ? glIcon(item.icon, { slot: "prefix", size: "xs" })
                  : nothing}
                ${item.hint ? `${item.label} · ${item.hint}` : item.label}
              </sonic-menu-item>
            `;
          })}
        </sonic-menu>
      </div>
    </sonic-pop>
  `;
}
