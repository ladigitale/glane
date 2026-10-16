import { APP_NAME, type Project } from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/menu";
import "@supersoniks/concorde/menu-item";
import "@supersoniks/concorde/pop";
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

/**
 * Landing — Persuade. Full-bleed flow canvas + flat action dock.
 * Working action = create / open project (not a decorative CTA).
 */
@customElement("gl-landing-page")
export class GlLandingPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
      }
      /* Viz owns remaining height — anim centers in this box, not the page. */
      .landing-viz {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
      }
      .landing-top {
        position: absolute;
        top: 0;
        right: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: max(0.75rem, env(safe-area-inset-top))
          max(1rem, env(safe-area-inset-right)) 0.5rem 1rem;
        pointer-events: auto;
      }
      .landing-top a {
        color: color-mix(in srgb, var(--sc-base-content) 65%, transparent);
        font-size: 0.8rem;
        text-underline-offset: 0.15em;
      }
      .landing-top a:hover {
        color: var(--sc-base-content);
      }
      .landing-dock {
        flex: 0 0 auto;
        z-index: 2;
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem 1.25rem;
        padding: 0.9rem max(1.25rem, env(safe-area-inset-right))
          max(0.9rem, env(safe-area-inset-bottom))
          max(1.25rem, env(safe-area-inset-left));
        background: var(--sc-base, var(--sc-neutral-0));
        border-top: 1px solid
          color-mix(in srgb, var(--sc-base-content) 12%, transparent);
      }
      .hero-brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
        font-variation-settings: "wdth" var(--gl-font-display-wdth);
        letter-spacing: var(--gl-font-display-tracking);
      }
      @media (min-width: 640px) {
        .landing-dock {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: end;
          padding: 1rem max(2rem, env(safe-area-inset-right))
            max(1rem, env(safe-area-inset-bottom))
            max(2rem, env(safe-area-inset-left));
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
    await projectWorkspace.ensure();
    navigate({ name: "workspace" });
  }

  async #createProject(): Promise<void> {
    const name = await glDialog.prompt({
      title: t("project.new"),
      label: t("project.createPrompt"),
    });
    if (name === null) return;
    await projectWorkspace.create(name);
    await projectWorkspace.ensure();
    navigate({ name: "workspace" });
  }

  #goPrivacy(e: Event): void {
    e.preventDefault();
    navigate({ name: "privacy" });
  }

  override render() {
    const hasProjects = this.projects.length > 0;
    return html`
      <div class="landing-viz">
        <gl-landing-flow></gl-landing-flow>
        <div class="landing-top">
          <a
            href=${pathFor({ name: "privacy" })}
            @click=${this.#goPrivacy}
          >
            ${t("nav.privacy")}
          </a>
          <gl-locale-switch size="sm"></gl-locale-switch>
        </div>
      </div>
      <footer class="landing-dock">
          <div class="flex min-w-0 flex-col gap-1.5">
            <div
              class="hero-brand inline-flex min-w-0 items-center gap-2.5 text-primary"
            >
              ${glBrandMark({ size: "2.25rem" })}
              <span class="min-w-0 text-3xl leading-none sm:text-4xl"
                >${APP_NAME}</span
              >
            </div>
            <p
              class="m-0 max-w-xl text-sm leading-snug text-neutral-700 sm:text-base"
            >
              ${t("landing.tagline")}
            </p>
            <p class="m-0 text-xs text-neutral-500">
              ${hasProjects
                ? t("landing.localTitle")
                : t("landing.emptyHint")}
            </p>
          </div>
          <div class="flex min-w-0 flex-col gap-2 sm:min-w-[14rem]">
            ${hasProjects
              ? html`
                  <sonic-button
                    type="primary"
                    size="lg"
                    class="w-full justify-center"
                    @click=${() =>
                      void this.#openProject(this.projects[0]!.id)}
                  >
                    ${glIcon("arrow-right", { slot: "prefix" })}
                    ${t("landing.openInstrument")}
                  </sonic-button>
                  <div class="flex flex-wrap items-center gap-2">
                    <sonic-pop placement="top-start" shadow="md">
                      <sonic-button
                        variant="outline"
                        type="neutral"
                        size="sm"
                      >
                        ${glIcon("folder", { slot: "prefix", size: "xs" })}
                        ${t("landing.projectsTitle")}
                        (${this.projects.length})
                      </sonic-button>
                      <div
                        slot="content"
                        class="min-w-56 bg-neutral-0 p-1.5"
                        @click=${(e: Event) => e.stopPropagation()}
                      >
                        <sonic-menu
                          direction="column"
                          align="left"
                          size="sm"
                        >
                          ${this.projects.map(
                            (p) => html`
                              <sonic-menu-item
                                class="min-w-0"
                                @click=${() => void this.#openProject(p.id)}
                              >
                                ${glIcon("folder", {
                                  slot: "prefix",
                                  size: "xs",
                                })}
                                <span class="block truncate">${p.title}</span>
                              </sonic-menu-item>
                            `,
                          )}
                        </sonic-menu>
                      </div>
                    </sonic-pop>
                    <sonic-button
                      variant="outline"
                      type="neutral"
                      size="sm"
                      @click=${() => void this.#createProject()}
                    >
                      ${glIcon("plus", { slot: "prefix", size: "xs" })}
                      ${t("project.new")}
                    </sonic-button>
                    <sonic-button
                      variant="outline"
                      type="neutral"
                      size="sm"
                      class="flex-1"
                      href=${pathFor({ name: "account" })}
                      ?pushState=${true}
                    >
                      ${glIcon("user", { slot: "prefix", size: "xs" })}
                      ${t("landing.account")}
                    </sonic-button>
                  </div>
                `
              : html`
                  <sonic-button
                    type="primary"
                    size="lg"
                    class="w-full justify-center"
                    @click=${() => void this.#createProject()}
                  >
                    ${glIcon("plus", { slot: "prefix" })}
                    ${t("project.new")}
                  </sonic-button>
                  <sonic-button
                    variant="outline"
                    type="neutral"
                    size="sm"
                    class="w-full justify-center"
                    href=${pathFor({ name: "account" })}
                    ?pushState=${true}
                  >
                    ${glIcon("user", { slot: "prefix", size: "xs" })}
                    ${t("landing.account")}
                  </sonic-button>
                `}
          </div>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-page": GlLandingPage;
  }
}
