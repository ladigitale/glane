import { APP_NAME } from "@glane/core-model";
import type { Project } from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwind from "../css/tailwind";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import { ensurePrefs } from "./db.js";
import { bootRecoverSessions } from "./boot-recover.js";
import { startSyncScheduler } from "./sync.js";
import { processQueue, type ProcessQueueSnapshot } from "./process-queue.js";
import { t, tf, setLocale } from "./i18n/messages.js";
import { getWordingsServiceUrl } from "./i18n/wordings-fetch.js";
import { parsePath, navigate, type Route, pathFor } from "./router.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "./project-workspace.js";
import { paletteKey, prefsFormKey, projectPickKey } from "./dp-keys.js";
import type { PrefsForm } from "./dp-keys.js";
import "./locale-switch.js";
import { glDialog } from "./dialog.js";
import { glBrandMark, glIcon } from "./icon.js";
import {
  APP_THEMES,
  applyTheme,
  themeMeta,
  type AppThemeId,
} from "./theme.js";
import "./pop-select.js";
import "./pages/capture-page.js";
import "./pages/library-page.js";
import "./pages/editor-page.js";
import type { GlEditorPage } from "./pages/editor-page.js";
import "./pages/sequencer-page.js";
import "./pages/privacy-page.js";
import "./pages/diagnostic-page.js";
import "./pages/landing-page.js";
import "./pages/account-page.js";
import "./pages/listen-page.js";

@customElement("gl-app")
export class GlApp extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        height: 100dvh;
        overflow: hidden;
      }
      /* Height chain: theme → scope → main → page. Scope is light-DOM; contents
         lets header/main participate in theme's flex column. */
      sonic-theme {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      sonic-scope {
        display: contents;
      }
      header {
        flex-shrink: 0;
        padding-top: max(0.5rem, env(safe-area-inset-top));
        padding-left: max(0.75rem, env(safe-area-inset-left));
        padding-right: max(0.75rem, env(safe-area-inset-right));
      }
      main {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .brand {
        --sc-font-family-base: var(--gl-font-display);
        font-family: var(--gl-font-display);
        font-weight: var(--gl-font-display-weight);
        font-variation-settings: "wdth" var(--gl-font-display-wdth);
        letter-spacing: var(--gl-font-display-tracking);
      }
      .gl-brand-mark,
      sonic-button .gl-brand-mark {
        display: block;
        flex-shrink: 0;
        line-height: 0;
      }
      /* Sequencer fills the chrome; scroll stays inside timeline / sample drawer. */
      main:has(gl-sequencer-page) {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      main > gl-sequencer-page {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .mobile-nav {
        padding: max(1rem, env(safe-area-inset-top))
          max(1rem, env(safe-area-inset-right))
          max(1rem, env(safe-area-inset-bottom))
          max(1rem, env(safe-area-inset-left));
      }
      /* Ghost [active] uses --sc-base-100 — same as header bg-neutral-100 → invisible. */
      header sonic-menu-item[active]::part(button),
      .mobile-nav sonic-menu-item[active]::part(button) {
        background: var(--sc-base-200);
      }
    `,
  ];

  @state() private route: Route = parsePath(location.pathname);
  @state() private paletteOpen = false;
  @state() private mobileOpen = false;
  @state() private projects: Project[] = [];
  @state() private currentProjectId = "";
  @state() private themeId: AppThemeId = "nord";
  @state() private themeMode: "light" | "dark" = "dark";
  @state() private proc: ProcessQueueSnapshot = {
    pending: 0,
    running: 0,
    done: 0,
    error: 0,
    remaining: 0,
    backlog: 0,
    currentSampleId: null,
  };

  @subscribe(paletteKey.q)
  @state()
  paletteFilter = "";

  @subscribe(projectPickKey.projectId)
  @state()
  pickProjectId = "";

  @subscribe(prefsFormKey.locale)
  @state()
  locale: PrefsForm["locale"] = "fr";

  #unsubProc: (() => void) | null = null;
  #path = location.pathname;
  #raf = 0;
  #leaveGuardBusy = false;

  @handle(projectPickKey.projectId)
  onProjectIdFromForm(id: string): void {
    if (!id || id === this.currentProjectId) return;
    void this.#switchProject(id);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    set(paletteKey, { q: "" });
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    this.#raf = requestAnimationFrame(this.#watchLocation);
    void ensurePrefs().then((p) => {
      setLocale(p.locale);
      set(prefsFormKey.locale, p.locale);
      this.#applyTheme(p.theme);
    });
    void this.#refreshProjects();
    void bootRecoverSessions().then((ids) => {
      if (ids.length > 0) {
        console.info(`[glane] recovered ${ids.length} session(s) after crash`, ids);
      }
    });
    void processQueue.start();
    this.#unsubProc = processQueue.subscribe((s) => {
      this.proc = s;
    });
    startSyncScheduler();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    cancelAnimationFrame(this.#raf);
    this.#unsubProc?.();
    super.disconnectedCallback();
  }

  /** Sync route when Concorde menu pushState (no popstate) or navigate(). */
  #watchLocation = (): void => {
    if (location.pathname !== this.#path && !this.#leaveGuardBusy) {
      void this.#onPathChange(location.pathname);
    }
    this.#raf = requestAnimationFrame(this.#watchLocation);
  };

  async #onPathChange(nextPath: string): Promise<void> {
    if (this.#leaveGuardBusy || nextPath === this.#path) return;
    const fromRoute = this.route;
    const toRoute = parsePath(nextPath);
    const leavingEditor =
      fromRoute.name === "sample" &&
      (toRoute.name !== "sample" || toRoute.id !== fromRoute.id);

    if (leavingEditor) {
      const editor = this.renderRoot?.querySelector(
        "gl-editor-page",
      ) as GlEditorPage | null;
      if (editor?.isDirty) {
        this.#leaveGuardBusy = true;
        // Keep the editor mounted while the dialog runs.
        history.replaceState({}, "", this.#path);
        try {
          const ok = await editor.confirmLeave();
          if (!ok) return;
          history.pushState({}, "", nextPath);
          this.#path = nextPath;
          this.route = toRoute;
          this.mobileOpen = false;
        } finally {
          this.#leaveGuardBusy = false;
        }
        return;
      }
    }

    this.#path = nextPath;
    this.route = toRoute;
    this.mobileOpen = false;
  }

  #onProjectChange = (): void => {
    void this.#refreshProjects();
  };

  async #refreshProjects(): Promise<void> {
    const [list, current] = await Promise.all([
      projectWorkspace.listActive(),
      projectWorkspace.ensure(),
    ]);
    this.projects = list;
    this.currentProjectId = current.id;
    set(projectPickKey, { projectId: current.id });
  }

  #onKey = (e: KeyboardEvent): void => {
    if (
      (e.altKey && e.key.toLowerCase() === "k") ||
      (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p")
    ) {
      e.preventDefault();
      this.paletteOpen = !this.paletteOpen;
      if (this.paletteOpen) set(paletteKey, { q: "" });
    }
    if (e.key === "Escape") {
      this.paletteOpen = false;
      this.mobileOpen = false;
    }
  };

  #applyTheme(theme: AppThemeId): void {
    applyTheme(theme);
    this.themeId = theme;
    this.themeMode = themeMeta(theme).dark ? "dark" : "light";
  }

  #navLinks(): { href: string; label: string; icon: string; route: Route }[] {
    return [
      {
        href: pathFor({ name: "capture" }),
        label: t("nav.capture"),
        icon: "mic",
        route: { name: "capture" },
      },
      {
        href: pathFor({ name: "library" }),
        label: t("nav.library"),
        icon: "library",
        route: { name: "library" },
      },
      {
        href: pathFor({
          name: "project",
          id: this.currentProjectId || undefined,
        }),
        label: t("nav.project"),
        icon: "music",
        route: {
          name: "project",
          id: this.currentProjectId || undefined,
        },
      },
    ];
  }

  /** Privacy / diagnostic — burger menu + command palette, not primary nav. */
  #accessLinks(): { href: string; label: string; icon: string; route: Route }[] {
    return [
      {
        href: pathFor({ name: "account" }),
        label: t("nav.account"),
        icon: "user",
        route: { name: "account" },
      },
      {
        href: pathFor({ name: "privacy" }),
        label: t("nav.privacy"),
        icon: "shield",
        route: { name: "privacy" },
      },
      {
        href: pathFor({ name: "diagnostic" }),
        label: t("nav.diagnostic"),
        icon: "activity",
        route: { name: "diagnostic" },
      },
    ];
  }

  /** Selected nav item from app route (SPA + /project/:id). */
  #navActive(link: { route: Route }): boolean {
    const name = link.route.name;
    if (name === "library") {
      return this.route.name === "library" || this.route.name === "sample";
    }
    return this.route.name === name;
  }

  #chromeLess(): boolean {
    return this.route.name === "landing" || this.route.name === "listen";
  }

  override render() {
    const links = this.#navLinks();
    if (this.#chromeLess()) {
      return html`
        <sonic-theme
          theme=${this.themeMode}
          background
          color
          font
          data-locale=${this.locale}
        >
          <sonic-scope
            serviceURL=${getWordingsServiceUrl()}
            wordingProvider="wordings"
          >
            <main>${this.#page()}</main>
          </sonic-scope>
        </sonic-theme>
      `;
    }

    return html`
      <sonic-theme
        theme=${this.themeMode}
        background
        color
        font
        data-locale=${this.locale}
      >
        <sonic-scope
          serviceURL=${getWordingsServiceUrl()}
          wordingProvider="wordings"
        >
          <header
            class="sticky top-0 z-10 flex min-w-0 shrink-0 items-center gap-1.5 bg-neutral-100 px-3 py-2"
          >
            <sonic-button
              class="brand shrink-0 gap-1.5 text-primary [&_.gl-brand-mark]:shrink-0 [&_.gl-brand-mark]:text-primary"
              variant="ghost"
              size="lg"
              type="neutral"
              href=${pathFor({ name: "landing" })}
              ?pushState=${true}
            >
              ${glBrandMark({ size: "1.35rem", slot: "prefix" })}
              <span class="max-md:hidden">${APP_NAME}</span>
            </sonic-button>
            <div
              class="mr-1 flex min-w-0 max-w-40 flex-1 items-center gap-1 max-md:max-w-[min(9rem,42vw)] md:flex-[0_1_auto]"
              title=${t("project.switch")}
            >
              <gl-pop-select
                class="w-full max-w-full"
                size="sm"
                variant="ghost"
                .value=${this.pickProjectId || this.currentProjectId}
                .options=${this.projects.map((p) => ({
                  value: p.id,
                  label: p.title,
                }))}
                .actions=${[
                  {
                    id: "new",
                    label: t("project.new"),
                    icon: "plus",
                  },
                  {
                    id: "rename",
                    label: t("project.rename"),
                    icon: "pencil",
                  },
                  {
                    id: "duplicate",
                    label: t("project.duplicate"),
                    icon: "copy",
                  },
                  {
                    id: "delete",
                    label: t("project.delete"),
                    icon: "trash-2",
                  },
                ]}
                placeholder=${t("project.switch")}
                @gl-change=${(e: CustomEvent<{ value: string }>) =>
                  set(projectPickKey.projectId, e.detail.value)}
                @gl-action=${(e: CustomEvent<{ id: string }>) => {
                  if (e.detail.id === "new") void this.#createProject();
                  if (e.detail.id === "rename") void this.#renameProject();
                  if (e.detail.id === "duplicate") void this.#duplicateProject();
                  if (e.detail.id === "delete") void this.#deleteProject();
                }}
              ></gl-pop-select>
            </div>
            ${this.proc.remaining > 0
              ? html`<sonic-badge type="info" size="sm">
                  ${glIcon("loader", { size: "xs" })}
                  ${this.proc.running > 0 ? "●" : "○"}
                  ${this.proc.remaining}
                </sonic-badge>`
              : nothing}
            ${this.proc.error > 0
              ? html`<sonic-button
                  size="sm"
                  variant="outline"
                  type="warning"
                  title=${tf("process.retryAll", {
                    n: String(this.proc.error),
                  })}
                  data-aria-label=${tf("process.retryAll", {
                    n: String(this.proc.error),
                  })}
                  @click=${() => void processQueue.retryUnfinished()}
                >
                  ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
                  ${this.proc.error}
                </sonic-button>`
              : nothing}
            <nav class="hidden md:block" aria-label="Principal">
              <sonic-menu direction="row" align="left" size="sm">
                ${links.map(
                  (l) => html`
                    <sonic-menu-item
                      href=${l.href}
                      ?pushState=${true}
                      ?active=${this.#navActive(l)}
                      variant="ghost"
                    >
                      ${glIcon(l.icon, { slot: "prefix", size: "xs" })}
                      ${l.label}
                    </sonic-menu-item>
                  `,
                )}
              </sonic-menu>
            </nav>
            <div class="ml-auto inline-flex shrink-0 items-center gap-1">
              <sonic-button
                shape="square"
                size="sm"
                variant="ghost"
                type="neutral"
                icon
                data-aria-label=${t("theme.menu")}
                title=${t("theme.menu")}
                @click=${() => (this.mobileOpen = true)}
              >
                ${glIcon("menu", { size: "sm" })}
              </sonic-button>
              <sonic-button
                shape="square"
                size="sm"
                variant="ghost"
                type="neutral"
                icon
                title="Alt+K"
                data-aria-label=${t("cmd.palette")}
                @click=${() => {
                  this.paletteOpen = true;
                  set(paletteKey, { q: "" });
                }}
              >
                ${glIcon("command", { size: "sm" })}
              </sonic-button>
            </div>
          </header>
          ${this.proc.remaining > 0
            ? html`<div
                class="h-[3px] w-full bg-neutral-0"
                aria-hidden="true"
              >
                <i
                  class="block h-full w-0 bg-primary transition-[width] duration-200 ease-in-out"
                  style="width:${Math.min(
                    100,
                    100 /
                      Math.max(
                        1,
                        this.proc.remaining +
                          Math.max(1, this.proc.done > 0 ? 1 : 0),
                      ),
                  )}%"
                ></i>
              </div>`
            : nothing}
          <main>${this.#page()}</main>
          ${this.mobileOpen
            ? html`
                <div
                  class="mobile-nav fixed inset-0 z-40 flex flex-col gap-2 overflow-auto bg-neutral-0 p-3"
                >
                  <sonic-menu
                    class="md:hidden"
                    direction="column"
                    align="left"
                    size="md"
                  >
                    ${links.map(
                      (l) => html`
                        <sonic-menu-item
                          href=${l.href}
                          ?pushState=${true}
                          ?active=${this.#navActive(l)}
                          @click=${() => (this.mobileOpen = false)}
                        >
                          ${glIcon(l.icon, { slot: "prefix", size: "sm" })}
                          ${l.label}
                        </sonic-menu-item>
                      `,
                    )}
                  </sonic-menu>
                  <sonic-menu direction="column" align="left" size="md">
                    <sonic-divider
                      label=${t("theme.section")}
                      align="left"
                      size="sm"
                    ></sonic-divider>
                    ${APP_THEMES.map(
                      (meta) => html`
                        <sonic-menu-item
                          ?active=${this.themeId === meta.id}
                          @click=${() => {
                            void this.#setTheme(meta.id);
                            this.mobileOpen = false;
                          }}
                        >
                          ${t(meta.labelKey)}
                        </sonic-menu-item>
                      `,
                    )}
                    <sonic-divider
                      label=${t("theme.language")}
                      align="left"
                      size="sm"
                    ></sonic-divider>
                    <div class="px-1 py-1">
                      <gl-locale-switch size="sm"></gl-locale-switch>
                    </div>
                    <sonic-divider></sonic-divider>
                    ${this.#accessLinks().map(
                      (l) => html`
                        <sonic-menu-item
                          href=${l.href}
                          ?pushState=${true}
                          ?active=${this.#navActive(l)}
                          @click=${() => (this.mobileOpen = false)}
                        >
                          ${glIcon(l.icon, { slot: "prefix", size: "sm" })}
                          ${l.label}
                        </sonic-menu-item>
                      `,
                    )}
                  </sonic-menu>
                  <sonic-button
                    variant="outline"
                    type="neutral"
                    @click=${() => (this.mobileOpen = false)}
                  >
                    ${glIcon("x", { slot: "prefix", size: "sm" })}
                    ${t("export.close")}
                  </sonic-button>
                </div>
              `
            : nothing}
          ${this.paletteOpen ? this.#palette(links) : nothing}
        </sonic-scope>
      </sonic-theme>
    `;
  }

  #page() {
    switch (this.route.name) {
      case "landing":
        return html`<gl-landing-page></gl-landing-page>`;
      case "account":
        return html`<gl-account-page></gl-account-page>`;
      case "listen":
        return html`<gl-listen-page .token=${this.route.token}></gl-listen-page>`;
      case "capture":
      case "session":
        return html`<gl-capture-page></gl-capture-page>`;
      case "library":
        return html`<gl-library-page></gl-library-page>`;
      case "sample":
        return html`<gl-editor-page .sampleId=${this.route.id}></gl-editor-page>`;
      case "project":
        return html`<gl-sequencer-page
          .projectId=${this.route.id ?? this.currentProjectId}
        ></gl-sequencer-page>`;
      case "privacy":
        return html`<gl-privacy-page></gl-privacy-page>`;
      case "diagnostic":
        return html`<gl-diagnostic-page></gl-diagnostic-page>`;
    }
  }

  #palette(links: { href: string; label: string; icon: string; route: Route }[]) {
    const q = this.paletteFilter.toLowerCase();
    const items = [
      ...links.map((l) => ({
        label: l.label,
        icon: l.icon,
        run: () => navigate(l.route),
      })),
      ...this.#accessLinks().map((l) => ({
        label: l.label,
        icon: l.icon,
        run: () => navigate(l.route),
      })),
      {
        label: t("project.new"),
        icon: "folder-plus",
        run: () => void this.#createProject(),
      },
      {
        label: t("project.duplicate"),
        icon: "copy",
        run: () => void this.#duplicateProject(),
      },
      {
        label: "Créer un clip (projet)",
        icon: "music",
        run: () =>
          navigate({
            name: "project",
            id: this.currentProjectId || undefined,
          }),
      },
    ].filter((i) => i.label.toLowerCase().includes(q));

    return html`
      <div
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[15vh]"
        @click=${() => (this.paletteOpen = false)}
      >
        <panel
          class="block w-[min(28rem,92vw)] rounded-[10px] bg-neutral-100 p-3"
          formDataProvider=${paletteKey.path}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <sonic-input
            name="q"
            type="search"
            size="lg"
            inlineContent
            placeholder=${t("cmd.palette")}
            autofocus
          >
            ${glIcon("search", { slot: "prefix", size: "md" })}
          </sonic-input>
          <ul class="mt-2 flex list-none flex-col gap-1 p-0">
            ${items.map(
              (i) => html`
                <li>
                  <sonic-button
                    shape="block"
                    variant="ghost"
                    type="neutral"
                    align="left"
                    @click=${() => {
                      this.paletteOpen = false;
                      i.run();
                    }}
                  >
                    ${glIcon(i.icon, { slot: "prefix", size: "sm" })}
                    ${i.label}
                  </sonic-button>
                </li>
              `,
            )}
          </ul>
        </panel>
      </div>
    `;
  }

  async #switchProject(id: string): Promise<void> {
    if (!id || id === this.currentProjectId) return;
    await projectWorkspace.switchTo(id);
    this.currentProjectId = id;
    if (this.route.name === "project") {
      navigate({ name: "project", id });
    }
  }

  async #createProject(): Promise<void> {
    const name = await glDialog.prompt({
      title: t("project.new"),
      label: t("project.createPrompt"),
    });
    if (name === null) return;
    const p = await projectWorkspace.create(name);
    this.currentProjectId = p.id;
    await this.#refreshProjects();
    navigate({ name: "project", id: p.id });
  }

  async #renameProject(): Promise<void> {
    const cur = this.projects.find((p) => p.id === this.currentProjectId);
    if (!cur) return;
    const name = await glDialog.prompt({
      title: t("project.rename"),
      label: t("project.createPrompt"),
      value: cur.title,
    });
    if (name === null) return;
    await projectWorkspace.rename(cur.id, name);
    await this.#refreshProjects();
  }

  async #duplicateProject(): Promise<void> {
    const cur = this.projects.find((p) => p.id === this.currentProjectId);
    if (!cur) return;
    const name = await glDialog.prompt({
      title: t("project.duplicate"),
      label: t("project.duplicatePrompt"),
      value: `${cur.title} (copie)`,
    });
    if (name === null) return;
    const p = await projectWorkspace.duplicate(cur.id, name);
    this.currentProjectId = p.id;
    await this.#refreshProjects();
    navigate({ name: "project", id: p.id });
  }

  async #deleteProject(): Promise<void> {
    const cur = this.projects.find((p) => p.id === this.currentProjectId);
    if (!cur) return;
    const ok = await glDialog.confirm({
      title: t("project.delete"),
      message: `« ${cur.title} » — ${t("project.deleteConfirm")}`,
      confirmLabel: t("dialog.delete"),
      danger: true,
    });
    if (!ok) return;
    const next = await projectWorkspace.remove(cur.id);
    this.currentProjectId = next.id;
    await this.#refreshProjects();
    if (this.route.name === "project") {
      navigate({ name: "project", id: next.id });
    }
  }

  #setTheme = async (theme: AppThemeId): Promise<void> => {
    const prefs = await ensurePrefs();
    prefs.theme = theme;
    this.#applyTheme(theme);
    const { db } = await import("./db.js");
    await db.prefs.put(prefs);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-app": GlApp;
  }
}
