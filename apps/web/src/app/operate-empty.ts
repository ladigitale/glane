/**
 * Shared Operate empty / quiet status — never skeleton-as-empty.
 */
import { html, nothing, type TemplateResult } from "lit";

export function renderOperateEmpty(opts: {
  message: string;
  action?: TemplateResult | typeof nothing;
}): TemplateResult {
  return html`
    <div
      class="flex flex-col items-start gap-3 py-6 text-sm leading-relaxed text-neutral-600"
      role="status"
    >
      <p class="m-0 max-w-prose">${opts.message}</p>
      ${opts.action ?? nothing}
    </div>
  `;
}
