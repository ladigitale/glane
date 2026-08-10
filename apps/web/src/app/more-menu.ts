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

/**
 * Ellipsis actions menu — vertical by default; horizontal for list-row actions.
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
  return html`
    <sonic-pop placement="bottom-end">
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
      <sonic-menu slot="content" direction="column" align="left" size=${size}>
        ${opts.items.map((item) => {
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
    </sonic-pop>
  `;
}
