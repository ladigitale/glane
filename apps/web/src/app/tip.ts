import { html, nothing, type TemplateResult } from "lit";

/**
 * Hint on hover/focus via native `title=` — avoids sonic-tooltip clipping
 * inside overflow/stacking contexts (sticky header, tables, timeline).
 */
export function tip(
  label: string,
  content: unknown,
  opts?: {
    /** For non-interactive hosts (plain text / icons). */
    focusable?: boolean;
    class?: string;
  },
): TemplateResult {
  if (!label) return html`${content}`;
  return html`
    <span
      class=${opts?.class ?? "inline-flex items-center"}
      title=${label}
      tabindex=${opts?.focusable ? "0" : nothing}
      >${content}</span
    >
  `;
}
