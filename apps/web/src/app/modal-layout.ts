import { css } from "lit";

/** Layout presets — Concorde sonic-modal attrs (paddingX, paddingY, maxWidth, maxHeight, align). */
export type GlModalPreset = "compact" | "form" | "panel" | "wide" | "generate";

export type GlModalLayout = {
  align: "left";
  paddingX: string;
  paddingY: string;
  maxWidth: string;
  maxHeight: string;
};

export const GL_MODAL_PRESETS: Record<GlModalPreset, GlModalLayout> = {
  compact: {
    align: "left",
    paddingX: "1.75rem",
    paddingY: "2rem",
    maxWidth: "min(100vw, 26rem)",
    maxHeight: "90vh",
  },
  form: {
    align: "left",
    paddingX: "1.75rem",
    paddingY: "2rem",
    maxWidth: "min(100vw, 28rem)",
    maxHeight: "90vh",
  },
  panel: {
    align: "left",
    paddingX: "2rem",
    paddingY: "2.25rem",
    maxWidth: "min(100vw, 38rem)",
    maxHeight: "min(90vh, 52rem)",
  },
  wide: {
    align: "left",
    paddingX: "2rem",
    paddingY: "2.25rem",
    maxWidth: "min(100vw, 44rem)",
    maxHeight: "min(90vh, 52rem)",
  },
  generate: {
    align: "left",
    paddingX: "2rem",
    paddingY: "2.25rem",
    maxWidth: "min(100vw, 52rem)",
    maxHeight: "min(90vh, 52rem)",
  },
};

/**
 * Optional styleSheet — scroll `sonic-modal-content` only.
 * Keep `#modal-content` overflow visible: Concorde’s `sonic-modal-close`
 * uses negative margins into the padding and is clipped by overflow:hidden.
 */
export const GL_MODAL_SCROLL_LAYOUT = css`
  #modal.custom-scroll {
    overflow: hidden !important;
    display: flex;
    flex-direction: column;
  }

  #modal-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: visible;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  sonic-modal-close,
  ::slotted(sonic-modal-close) {
    flex-shrink: 0;
  }

  ::slotted(sonic-modal-title),
  ::slotted(sonic-modal-subtitle),
  sonic-modal-title,
  sonic-modal-subtitle {
    flex-shrink: 0;
  }

  ::slotted(sonic-modal-content),
  sonic-modal-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }

  ::slotted(sonic-modal-actions),
  sonic-modal-actions {
    flex-shrink: 0;
  }
`;

export function glModalPreset(
  preset: GlModalPreset,
  overrides: Partial<GlModalLayout> = {},
): GlModalLayout {
  return { ...GL_MODAL_PRESETS[preset], ...overrides };
}
