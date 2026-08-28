import { APP_NAME, type Project } from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/menu";
import "@supersoniks/concorde/menu-item";
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
        position: relative;
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
      }
      .hero-brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
        font-variation-settings: "wdth" var(--gl-font-display-wdth);
        letter-spacing: var(--gl-font-display-tracking);
      }
      .landing-stage {
        position: fixed;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: safe center;
        box-sizing: border-box;
        padding: max(1rem, env(safe-area-inset-top))
          max(1rem, env(safe-area-inset-right))
          max(1rem, env(safe-area-inset-bottom))
          max(1rem, env(safe-area-inset-left));
        pointer-events: none;
        overflow: hidden;
      }
      .landing-copy {
        position: relative;
        z-index: 1;
        width: min(100%, 32rem);
        max-height: min(
          calc(100dvh - 2rem),
          calc(
            100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) -
              1.5rem
          )
        );
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
        pointer-events: auto;
        color: var(--sc-base-content);
        background: color-mix(in srgb, var(--sc-base) 72%, transparent);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid
          color-mix(in srgb, var(--sc-base-content) 14%, transparent);
        border-radius: calc(var(--sc-rounded, 0.5rem) + 0.35rem);
        padding: 1.5rem 1.25rem;
        box-shadow: 0 12px 40px
          color-mix(in srgb, var(--sc-base-content) 8%, transparent);
      }
      @media (min-width: 640px) {
        .landing-copy {
          padding: 2rem 1.75rem;
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
    return html`
      <div class="landing-stage">
        <gl-landing-flow></gl-landing-flow>
        <div class="landing-copy flex min-h-0 flex-col gap-6 sm:gap-8">
          <div class="space-y-5">
            <div class="flex items-start justify-between gap-3">
              <div
                class="hero-brand inline-flex min-w-0 items-center gap-3 text-primary"
              >
                ${glBrandMark({ size: "2.75rem" })}
                <span class="min-w-0 text-4xl leading-none sm:text-5xl"
                  >${APP_NAME}</span
                >
              </div>
              <gl-locale-switch
                class="shrink-0"
                size="sm"
              ></gl-locale-switch>
            </div>
            <div class="space-y-3">
              <p class="text-base leading-relaxed text-neutral-700 sm:text-lg">
                ${t("landing.tagline")}
              </p>
              <p class="text-sm leading-relaxed text-neutral-500">
                ${t("landing.localBody")}
              </p>
            </div>
          </div>
          ${this.ready ? this.#workspaceBlock() : nothing}
          <nav
            class="flex items-center justify-between gap-3 text-sm text-neutral-500"
          >
            <span>${APP_NAME}</span>
            <a
              class="underline-offset-2 hover:underline"
              href=${pathFor({ name: "privacy" })}
              @click=${this.#goPrivacy}
            >
              ${t("nav.privacy")}
            </a>
          </nav>
        </div>
      </div>
    `;
  }

  #workspaceBlock() {
    const hasProjects = this.projects.length > 0;
    return html`
      <div class="flex flex-col gap-3">
        <p class="text-sm text-neutral-500">
          ${hasProjects ? t("landing.projectsTitle") : t("landing.emptyHint")}
        </p>
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
        <div class="flex flex-col gap-3">
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
            size="lg"
            class="w-full justify-center"
            href=${pathFor({ name: "account" })}
            ?pushState=${true}
          >
            ${glIcon("user", { slot: "prefix" })}
            ${t("landing.account")}
          </sonic-button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-landing-page": GlLandingPage;
  }
}
