import { css } from "lit";

/**
 * Shared shell for access pages (account / privacy / sync / connector / diagnostic).
 * Flex column owns rhythm: title → lede → form stack → form-actions (siblings, never inside fieldset).
 */
export const ACCESS_PAGE_STYLES = css`
  :host {
    display: block;
    box-sizing: border-box;
    padding: 0.75rem 1rem 1rem;
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }
  .access-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 40rem;
    margin-inline: auto;
    box-sizing: border-box;
  }
  .access-page > h1 {
    margin: 0;
    font-family: var(--gl-font-display);
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  @media (min-width: 640px) {
    .access-page > h1 {
      font-size: 1.5rem;
    }
  }
  .access-lede {
    margin: 0;
    max-width: 40rem;
    font-size: 0.925rem;
    line-height: 1.45;
    color: var(--sc-base-400, var(--sc-neutral-500));
  }
  /* Form footer is a sibling of gl-form-stack — keep Concorde actions flush with stack gap. */
  .access-page sonic-form-actions {
    margin-block: 0;
  }
`;
