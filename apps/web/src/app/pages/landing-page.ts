import { APP_NAME, type Project } from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@supersoniks/concorde/fieldset";
import "@supersoniks/concorde/form-actions";
import "@supersoniks/concorde/form-layout";
import tailwind from "../../css/tailwind";
import { glDialog } from "../dialog.js";
import { t } from "../i18n/messages.js";
import { glBrandMark, glIcon } from "../icon.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { navigate, pathFor } from "../router.js";
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
        min-width: 0;
        max-width: 100%;
        overflow-x: clip;
        box-sizing: border-box;
      }
      .hero-brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
        font-variation-settings: "wdth" var(--gl-font-display-wdth);
        letter-spacing: var(--gl-font-display-tracking);
      }
      .flow-stage {
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        min-height: min(42dvh, 22rem);
      }
      /* Tighten fieldset padding on narrow viewports (box-sizing via tailwind sheet). */
      sonic-fieldset.workspace {
        display: block;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        --sc-fieldset-px: 0.75rem;
        --sc-fieldset-py: 1rem;
        --sc-fieldset-mb: 0;
      }
      @media (min-width: 640px) {
        sonic-fieldset.workspace {
          max-width: 28rem;
          --sc-fieldset-px: 1.25rem;
          --sc-fieldset-py: 1.5rem;
        }
      }
    `,
  ];

  @state() private projects: Project[] = [];
  @state() private ready = false;

  #onProjectChange = (): void => {
    void this.#loadProjects();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    void this.#loadProjects();
  }

  override disconnectedCallback(): void {
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    super.disconnectedCallback();
  }

  async #loadProjects(): Promise<void> {
    this.projects = await projectWorkspace.listActive();
    this.ready = true;
  }

  async #openProject(id: string): Promise<void> {
    await projectWorkspace.switchTo(id);
    navigate({ name: "capture" });
  }

  async #createProject(): Promise<void> {
    const name = await glDialog.prompt({
      title: t("project.new"),
      label: t("project.createPrompt"),
    });
    if (name === null) return;
    await projectWorkspace.create(name);
    navigate({ name: "capture" });
  }

  override render() {
    return html`
      <div
        class="relative flex min-h-[100dvh] w-full max-w-full min-w-0 flex-col bg-gradient-to-b from-neutral-100 via-neutral-0 to-neutral-100"
      >
        <div
          class="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-[2] md:right-6"
        >
          <gl-locale-switch size="sm"></gl-locale-switch>
        </div>
        <section
          class="relative mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col justify-center gap-6 px-4 pb-10 pt-[max(2rem,env(safe-area-inset-top))] sm:gap-8 sm:px-6"
        >
          <div class="flow-stage relative">
            <gl-landing-flow class="absolute inset-0"></gl-landing-flow>
          </div>
          <div
            class="relative z-[1] flex w-full min-w-0 flex-col items-stretch gap-4"
          >
            <div
              class="hero-brand inline-flex max-w-full items-center gap-3 text-primary"
            >
              ${glBrandMark({ size: "2.75rem" })}
              <span class="min-w-0 text-5xl leading-none md:text-6xl"
                >${APP_NAME}</span
              >
            </div>
            <p class="max-w-md text-base text-neutral-11 sm:text-lg">
              ${t("landing.tagline")}
            </p>
            ${this.ready ? this.#workspaceBlock() : nothing}
          </div>
        </section>
        <section
          class="mx-auto w-full min-w-0 max-w-3xl border-t border-neutral-3 px-4 py-10 sm:px-6"
        >
          <h2 class="font-display text-xl">${t("landing.localTitle")}</h2>
          <p class="mt-2 max-w-prose text-neutral-11">
            ${t("landing.localBody")}
          </p>
        </section>
        <footer
          class="mx-auto flex w-full min-w-0 max-w-3xl items-center justify-between gap-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 text-sm text-neutral-9 sm:px-6"
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

  #workspaceBlock() {
    const hasProjects = this.projects.length > 0;
    return html`
      <sonic-fieldset
        class="workspace"
        label=${t("landing.projectsTitle")}
        description=${hasProjects ? undefined : t("landing.emptyHint")}
      >
        <sonic-form-layout>
          ${hasProjects
            ? html`
                <sonic-menu
                  direction="column"
                  align="left"
                  size="sm"
                  class="w-full min-w-0"
                >
                  ${this.projects.map(
                    (p) => html`
                      <sonic-menu-item
                        class="min-w-0"
                        @click=${() => void this.#openProject(p.id)}
                      >
                        ${glIcon("folder", { slot: "prefix", size: "xs" })}
                        <span class="block truncate">${p.title}</span>
                      </sonic-menu-item>
                    `,
                  )}
                </sonic-menu>
              `
            : nothing}
          <sonic-form-actions class="w-full min-w-0">
            <sonic-button
              type="primary"
              size="md"
              shape="block"
              @click=${() => void this.#createProject()}
            >
              ${glIcon("plus", { slot: "prefix" })}
              ${t("project.new")}
            </sonic-button>
            <sonic-button
              variant="outline"
              type="neutral"
              size="md"
              shape="block"
              href=${pathFor({ name: "account" })}
              ?pushState=${true}
            >
              ${glIcon("user", { slot: "prefix" })}
              ${t("landing.account")}
            </sonic-button>
          </sonic-form-actions>
        </sonic-form-layout>
      </sonic-fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-page": GlLandingPage;
  }
}
