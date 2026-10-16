/**
 * Shared sample-list identity cell — library, capture feed, seq drawer.
 * Clear title vs meta; duration readable; class color as scan cue.
 */
import { CLASS_COLORS, type SampleClass } from "@glane/core-model";
import { html, nothing, type TemplateResult } from "lit";
import { glIcon } from "./icon.js";

export function formatSampleDuration(ms: number): string {
  const n = Math.max(0, Math.round(ms));
  if (n < 1000) return `${n}ms`;
  const sec = n / 1000;
  if (sec < 60) {
    const t = sec >= 10 ? sec.toFixed(0) : sec.toFixed(1).replace(/\.0$/, "");
    return `${t}s`;
  }
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type SampleListStatus = "busy" | "error" | "ok" | null;

export function renderSampleListIdentity(opts: {
  title: string;
  sampleClass: SampleClass | string;
  durationMs: number;
  favorite?: boolean;
  loopProposed?: boolean;
  interestPct?: number | null;
  status?: SampleListStatus;
  statusLabel?: string;
  /** Extra muted crumbs (capture name, tags) — keep short. */
  crumbs?: string[];
}): TemplateResult {
  const color =
    CLASS_COLORS[opts.sampleClass as SampleClass] ??
    CLASS_COLORS.unclassified;
  const crumbs = (opts.crumbs ?? []).filter(Boolean).slice(0, 3);
  return html`
    <div class="flex min-w-0 flex-col gap-0.5 text-left">
      <div class="flex min-w-0 items-center gap-1.5">
        ${opts.favorite
          ? html`<span class="shrink-0 text-warning" aria-hidden="true"
              >${glIcon("star", { size: "xs" })}</span
            >`
          : nothing}
        <span class="min-w-0 truncate font-medium leading-snug"
          >${opts.title}</span
        >
      </div>
      <div
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] leading-snug text-neutral-500"
      >
        <span class="inline-flex items-center gap-1">
          <i
            class="inline-block size-1.5 shrink-0 rounded-full"
            style="background:${color}"
            aria-hidden="true"
          ></i>
          <span>${opts.sampleClass}</span>
        </span>
        <span class="font-mono tabular-nums"
          >${formatSampleDuration(opts.durationMs)}</span
        >
        ${opts.interestPct != null
          ? html`<span class="font-mono tabular-nums"
              >★${opts.interestPct}</span
            >`
          : nothing}
        ${opts.loopProposed
          ? html`<span class="opacity-80">boucle</span>`
          : nothing}
        ${opts.status && opts.statusLabel
          ? html`<span
              class=${opts.status === "error"
                ? "text-warning"
                : opts.status === "busy"
                  ? "text-info"
                  : "opacity-80"}
              >${opts.statusLabel}</span
            >`
          : nothing}
        ${crumbs.map(
          (c) => html`<span class="max-w-[8rem] truncate opacity-70">${c}</span>`,
        )}
      </div>
    </div>
  `;
}
