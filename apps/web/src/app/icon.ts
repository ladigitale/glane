import { html, nothing, type TemplateResult } from "lit";

/** Lucide via Concorde CDN — short helper for icon-heavy UI. */
export function glIcon(
  name: string,
  opts?: { size?: string; slot?: "prefix" | "suffix" },
): TemplateResult {
  return html`<sonic-icon
    library="lucide"
    name=${name}
    size=${opts?.size ?? "sm"}
    slot=${opts?.slot ?? nothing}
  ></sonic-icon>`;
}

/**
 * Brand mark — three gleaned stalks / VU peaks (currentColor).
 * Stem + diamond head as separate closed paths (stable at small sizes).
 */
export function glBrandMark(opts?: {
  size?: string;
  slot?: "prefix" | "suffix";
}): TemplateResult {
  const size = opts?.size ?? "1.25rem";
  return html`<svg
    class="gl-brand-mark"
    width=${size}
    height=${size}
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
    slot=${opts?.slot ?? nothing}
    style="display:block;flex-shrink:0"
  >
    <path d="M7 26h3V14.5H7z" />
    <path d="M8.5 8.2L11.2 11.6 8.5 14.2 5.8 11.6z" />
    <path d="M14.5 26h3V11H14.5z" />
    <path d="M16 3.8L19 7.8 16 10.6 13 7.8z" />
    <path d="M22 26h3V16.5H22z" />
    <path d="M23.5 10.2L26 13.4 23.5 15.8 21 13.4z" />
  </svg>`;
}
