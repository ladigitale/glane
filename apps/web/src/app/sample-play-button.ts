import { html, type TemplateResult } from "lit";
import { t } from "./i18n/messages.js";
import { glIcon } from "./icon.js";
import { tip } from "./tip.js";

/**
 * Explicit play control for sound list rows — same look everywhere
 * (library, capture feed, sequencer drawer, synth validate).
 */
export function renderSamplePlayButton(opts: {
  onClick: () => void;
  /** When true, row is currently auditioning (visual cue). */
  playing?: boolean;
  disabled?: boolean;
  size?: "2xs" | "xs" | "sm";
}): TemplateResult {
  const size = opts.size ?? "xs";
  return tip(
    t("sample.play"),
    html`
      <sonic-button
        type=${opts.playing ? "info" : "default"}
        size=${size}
        shape="circle"
        icon
        ?disabled=${opts.disabled ?? false}
        data-aria-label=${t("sample.play")}
        @pointerdown=${(e: Event) => e.stopPropagation()}
        @click=${(e: Event) => {
          e.stopPropagation();
          opts.onClick();
        }}
      >
        ${glIcon("play", { size: size === "2xs" ? "xs" : "sm" })}
      </sonic-button>
    `,
  );
}
