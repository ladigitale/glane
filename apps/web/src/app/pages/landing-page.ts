import { APP_NAME } from "@glane/core-model";
import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { t } from "../i18n/messages.js";
import { glBrandMark, glIcon } from "../icon.js";
import { pathFor } from "../router.js";
import "../locale-switch.js";
import "./landing-flow.js";

@customElement("gl-landing-page")
export class GlLandingPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        min-height: 100%;
      }
      .hero-brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
        font-variation-settings: "wdth" var(--gl-font-display-wdth);
        letter-spacing: var(--gl-font-display-tracking);
      }
      .flow-stage {
        min-height: min(42dvh, 22rem);
      }
    `,
  ];

  override render() {
    return html`
      <div
        class="relative flex min-h-[100dvh] flex-col bg-gradient-to-b from-neutral-100 via-neutral-0 to-neutral-100"
      >
        <div
          class="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-[2] md:right-6"
        >
          <gl-locale-switch size="sm"></gl-locale-switch>
        </div>
        <section
          class="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 pb-10 pt-[max(2rem,env(safe-area-inset-top))]"
        >
          <div class="flow-stage relative -mx-2">
            <gl-landing-flow class="absolute inset-0"></gl-landing-flow>
          </div>
          <div class="relative z-[1] flex flex-col items-start gap-4">
            <div
              class="hero-brand inline-flex items-center gap-3 text-primary"
            >
              ${glBrandMark({ size: "2.75rem" })}
              <span class="text-5xl leading-none md:text-6xl">${APP_NAME}</span>
            </div>
            <p class="max-w-md text-lg text-neutral-11">
              ${t("landing.tagline")}
            </p>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <sonic-button
                type="primary"
                size="lg"
                href=${pathFor({ name: "capture" })}
                ?pushState=${true}
              >
                ${glIcon("mic", { slot: "prefix" })}
                ${t("landing.openInstrument")}
              </sonic-button>
              <sonic-button
                variant="outline"
                type="neutral"
                size="lg"
                href=${pathFor({ name: "account" })}
                ?pushState=${true}
              >
                ${glIcon("user", { slot: "prefix" })}
                ${t("landing.account")}
              </sonic-button>
            </div>
          </div>
        </section>
        <section
          class="mx-auto w-full max-w-3xl border-t border-neutral-3 px-6 py-10"
        >
          <h2 class="font-display text-xl">${t("landing.localTitle")}</h2>
          <p class="mt-2 max-w-prose text-neutral-11">
            ${t("landing.localBody")}
          </p>
        </section>
        <footer
          class="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 text-sm text-neutral-9"
        >
          <span>${APP_NAME}</span>
          <a
            class="underline-offset-2 hover:underline"
            href=${pathFor({ name: "privacy" })}
            @click=${(e: Event) => {
              e.preventDefault();
              history.pushState({}, "", pathFor({ name: "privacy" }));
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            ${t("nav.privacy")}
          </a>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-page": GlLandingPage;
  }
}
