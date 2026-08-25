import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import "@supersoniks/concorde/fieldset";

export type GlFormSectionVariant = "default" | "ghost" | "shadow";
export type GlFormStackGap = "sm" | "md" | "lg";

/**
 * Vertical stack for form sections — owns gap; sections zero their own fieldset mb.
 * Put `formDataProvider` on this host when the stack is the form root.
 */
@customElement("gl-form-stack")
export class GlFormStack extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
    }
    :host([gap="sm"]) {
      gap: 0.75rem;
    }
    :host([gap="lg"]) {
      gap: 1.25rem;
    }
  `;

  /** sm = 0.75rem, md = 1rem (default), lg = 1.25rem */
  @property({ reflect: true }) gap: GlFormStackGap = "md";

  override render() {
    return html`<slot></slot>`;
  }
}

/**
 * One labeled form block — thin Glane wrapper over `sonic-fieldset`.
 * Use inside `gl-form-stack`. Prefer `layout` slot content via `sonic-form-layout`.
 *
 * Variants: `default` top-level · `ghost` nested under a bordered section ·
 * `tight` dense inline (FX / mix panels).
 */
@customElement("gl-form-section")
export class GlFormSection extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    sonic-fieldset {
      --sc-fieldset-mb: 0;
    }
  `;

  @property() label?: string;
  @property() description?: string;
  @property() variant: GlFormSectionVariant = "default";
  @property({ type: Boolean, reflect: true }) tight = false;

  override render() {
    return html`
      <sonic-fieldset
        label=${ifDefined(this.label)}
        description=${ifDefined(this.description)}
        variant=${this.variant}
        ?tight=${this.tight}
      >
        <slot></slot>
      </sonic-fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-form-stack": GlFormStack;
    "gl-form-section": GlFormSection;
  }
}
