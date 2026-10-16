/**
 * Shared form / modal action rows — Operate grammar.
 *
 * Order: secondary (cancel / reset) → optional tertiary… → primary (submit / OK).
 * Page forms → `renderFormActions`; modals → `renderModalActions` / `renderModalOk`.
 */
import { html, nothing, type TemplateResult } from "lit";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/form-actions";

export type GlFormAction = {
  /** Plain label, or Lit template (icons + text). */
  label: string | TemplateResult;
  onClick?: (e: Event) => void;
  /** Close sonic-modal on click (Concorde). */
  hideModal?: boolean;
  type?: "primary" | "neutral" | "danger" | "warning";
  variant?: "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
};

function renderButton(a: GlFormAction): TemplateResult {
  return html`
    <sonic-button
      type=${a.type ?? "neutral"}
      variant=${a.variant ?? nothing}
      size=${a.size ?? nothing}
      ?hideModal=${a.hideModal === true}
      ?disabled=${a.disabled === true}
      ?loading=${a.loading === true}
      @click=${a.onClick}
    >
      ${a.label}
    </sonic-button>
  `;
}

function renderTertiary(
  tertiary: GlFormAction | GlFormAction[] | undefined,
): TemplateResult | typeof nothing {
  if (!tertiary) return nothing;
  const list = Array.isArray(tertiary) ? tertiary : [tertiary];
  return html`${list.map((a) => renderButton(a))}`;
}

/** Modal footer — cancel/reset left, primary right. */
export function renderModalActions(opts: {
  secondary?: GlFormAction;
  /** One or more mid actions (e.g. regen, kit). */
  tertiary?: GlFormAction | GlFormAction[];
  primary: GlFormAction;
}): TemplateResult {
  return html`
    <sonic-modal-actions>
      ${opts.secondary ? renderButton(opts.secondary) : nothing}
      ${renderTertiary(opts.tertiary)}
      ${renderButton({
        ...opts.primary,
        type: opts.primary.type ?? "primary",
      })}
    </sonic-modal-actions>
  `;
}

/** In-page form footer (account, privacy, etc.). */
export function renderFormActions(opts: {
  secondary?: GlFormAction;
  tertiary?: GlFormAction | GlFormAction[];
  primary: GlFormAction;
}): TemplateResult {
  return html`
    <sonic-form-actions>
      ${opts.secondary ? renderButton(opts.secondary) : nothing}
      ${renderTertiary(opts.tertiary)}
      ${renderButton({
        ...opts.primary,
        type: opts.primary.type ?? "primary",
      })}
    </sonic-form-actions>
  `;
}

/** Dismiss-only settings modal (live-applied prefs). */
export function renderModalOk(label: string | TemplateResult): TemplateResult {
  return renderModalActions({
    primary: { label, hideModal: true, type: "primary" },
  });
}
