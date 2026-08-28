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
import { peekEditorHandoff } from "./editor-handoff.js";
import { paletteKey, prefsFormKey, projectPickKey } from "./dp-keys.js";
import type { PrefsForm } from "./dp-keys.js";
import "./locale-switch.js";
import { glDialog } from "./dialog.js";
import {
  blockReasonKey,
  fallbackRoute,
  loadReadiness,
  routeReady,
  routeSection,
  sectionReady,
  type GlSection,
  type Readiness,
} from "./feature-readiness.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "./modal-layout.js";
import { glBrandMark, glIcon } from "./icon.js";
import { tip } from "./tip.js";
import {
  chromeMore,
  renderMoreMenu,
  type ChromeMoreState,
} from "./more-menu.js";
import {
  APP_THEMES,
  applyTheme,
  themeMeta,
  type AppThemeId,
} from "./theme.js";
import "./pages/capture-page.js";
import "./pages/library-page.js";
import "./pages/editor-page.js";
import type { GlEditorPage } from "./pages/editor-page.js";
import "./pages/synth-page.js";
import "./pages/sequencer-page.js";
import "./pages/privacy-page.js";
import "./pages/diagnostic-page.js";
import "./pages/landing-page.js";
import "./pages/workspace-hub-page.js";
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
      /* Guest landing: full-viewport canvas, no page scroll (Tadaaa home). */
      main:has(gl-landing-page) {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      main > gl-landing-page {
        flex: 1;
        min-height: 0;
      }
      main:has(gl-workspace-hub-page) {
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      main > gl-workspace-hub-page {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      /* Ghost [active] uses --sc-base-100 — same as header bg-neutral-100 → invisible. */
      sonic-menu-item[active]::part(button) {
        background: var(--sc-base-200);
      }
      /* Breadcrumb label ellipsis: constrain pop host + force slot text to clip. */
      .gl-bc-pop {
        display: block;
        min-width: 0;
      }
      .gl-bc-pop sonic-button {
        max-width: 100%;
        width: 100%;
        overflow: hidden;
      }
      .gl-bc-label {
        display: block;
        max-width: 7.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (min-width: 640px) {
        .gl-bc-pop.max-w-40 .gl-bc-label {
          max-width: 8.75rem;
        }
        .gl-bc-pop.max-w-44 .gl-bc-label {
          max-width: 9.75rem;
        }
      }
    `,
  ];

  @state() private route: Route = parsePath(location.pathname);
  @state() private paletteOpen = false;
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

  @state()
  chromeMoreLabel = "";

  @state()
  chromeMoreItems: ChromeMoreState["items"] = [];

  @state()
  private readiness: Readiness = { projectId: null, sampleCount: 0 };

  #unsubProc: (() => void) | null = null;
  #unsubChromeMore: (() => void) | null = null;
  #path = location.pathname;
  #raf = 0;
  #leaveGuardBusy = false;
  #navBusy = false;

  @handle(projectPickKey.projectId)
  onProjectIdFromForm(id: string): void {
    if (!id || id === this.currentProjectId) return;
    void this.#switchProject(id);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    set(paletteKey, { q: "" });
    chromeMore.clear();
    this.#unsubChromeMore = chromeMore.subscribe(() => {
      const s = chromeMore.get();
      this.chromeMoreLabel = s.ariaLabel;
      this.chromeMoreItems = s.items;
    });
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener("popstate", this.#onPopState);
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
    window.removeEventListener("popstate", this.#onPopState);
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    cancelAnimationFrame(this.#raf);
    this.#unsubChromeMore?.();
    this.#unsubChromeMore = null;
    this.#unsubProc?.();
    super.disconnectedCallback();
  }

  /** Sync route when Concorde menu pushState (no popstate) or navigate(). */
  #onPopState = (): void => {
    void this.#onPathChange(location.pathname);
  };

  #watchLocation = (): void => {
    if (location.pathname !== this.#path && !this.#leaveGuardBusy) {
      void this.#onPathChange(location.pathname);
    }
    this.#raf = requestAnimationFrame(this.#watchLocation);
  };

  async #onPathChange(nextPath: string): Promise<void> {
    if (this.#leaveGuardBusy || this.#navBusy) return;
    const toRoute = parsePath(nextPath);
    if (nextPath === this.#path) {
      if (toRoute.name !== this.route.name) {
        this.route = toRoute;
        chromeMore.clear();
      }
      return;
    }

    const fromRoute = this.route;
    const fromPath = this.#path;
    this.#navBusy = true;
    this.#path = nextPath;

    try {
      const leavingEditor =
        fromRoute.name === "sample" &&
        (toRoute.name !== "sample" || toRoute.id !== fromRoute.id);

      if (leavingEditor) {
        const editor = this.renderRoot?.querySelector(
          "gl-editor-page",
        ) as GlEditorPage | null;
        if (editor?.isDirty) {
          this.#leaveGuardBusy = true;
          this.#path = fromPath;
          history.replaceState({}, "", fromPath);
          try {
            const ok = await editor.confirmLeave();
            if (!ok) return;
            this.#path = nextPath;
            history.pushState({}, "", nextPath);
          } finally {
            this.#leaveGuardBusy = false;
          }
        }
      }

      if (this.#routeNeedsProject(toRoute)) {
        const cur = await projectWorkspace.ensure();
        if (!cur) {
          history.replaceState({}, "", pathFor({ name: "landing" }));
          this.#path = "/";
          this.route = { name: "landing" };
          return;
        }
        const readiness = await loadReadiness(cur.id);
        this.readiness = readiness;
        if (!routeReady(toRoute, readiness)) {
          const section = routeSection(toRoute);
          const fallback = section
            ? fallbackRoute(section, readiness)
            : { name: "landing" as const };
          history.replaceState({}, "", pathFor(fallback));
          this.#path = pathFor(fallback);
          this.route = fallback;
          const key = section ? blockReasonKey(section, readiness) : null;
          if (key) void glDialog.alert(t(key));
          return;
        }
      }

      this.route = toRoute;
      chromeMore.clear();
    } finally {
      this.#navBusy = false;
    }
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
    this.currentProjectId = current?.id ?? "";
    set(projectPickKey, { projectId: current?.id ?? "" });
    this.readiness = await loadReadiness(current?.id);
    if (!current && this.#routeNeedsProject(this.route)) {
      history.replaceState({}, "", pathFor({ name: "landing" }));
      this.#path = "/";
      this.route = { name: "landing" };
      return;
    }
    if (current && this.#routeNeedsProject(this.route)) {
      if (!routeReady(this.route, this.readiness)) {
        const section = routeSection(this.route);
        const fallback = section
          ? fallbackRoute(section, this.readiness)
          : { name: "landing" as const };
        history.replaceState({}, "", pathFor(fallback));
        this.#path = pathFor(fallback);
        this.route = fallback;
      }
    }
  }

  #routeNeedsProject(route: Route): boolean {
    switch (route.name) {
      case "workspace":
      case "capture":
      case "library":
      case "sample":
      case "synth":
      case "project":
      case "session":
        return true;
      default:
        return false;
    }
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
      }
  };

  #applyTheme(theme: AppThemeId): void {
    applyTheme(theme);
    this.themeId = theme;
    this.themeMode = themeMeta(theme).dark ? "dark" : "light";
  }

  #navLinks(): {
    href: string;
    label: string;
    icon: string;
    route: Route;
    section: GlSection;
  }[] {
    return [
      {
        href: pathFor({ name: "capture" }),
        label: t("nav.capture"),
        icon: "mic",
        route: { name: "capture" },
        section: "capture",
      },
      {
        href: pathFor({ name: "synth" }),
        label: t("nav.synth"),
        icon: "sliders",
        route: { name: "synth" },
        section: "synth",
      },
      {
        href: pathFor({ name: "library" }),
        label: t("nav.library"),
        icon: "library",
        route: { name: "library" },
        section: "library",
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
        section: "project",
      },
    ];
  }

  /** Account / privacy / diagnostic — top-level, outside the current project. */
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

  #isAccessRoute(): boolean {
    const n = this.route.name;
    return n === "account" || n === "privacy" || n === "diagnostic";
  }

  /** Selected nav item from app route (SPA + /project/:id). */
  #navActive(link: { route: Route }): boolean {
    if (link.route.name === "workspace") {
      return this.route.name === "workspace";
    }
    const name = link.route.name;
    if (this.route.name === "sample") {
      // Clip → editor from arrangement keeps "Arrangement" highlighted.
      const fromProject = peekEditorHandoff()?.from === "project";
      if (name === "project") return fromProject;
      if (name === "library") return !fromProject;
      return false;
    }
    if (name === "library") {
      return this.route.name === "library";
    }
    if (name === "synth") {
      return this.route.name === "synth";
    }
    return this.route.name === name;
  }


  /** Current chrome section label (Capture / Library / …). */
  #sectionLabel(): string {
    const name = this.route.name;
    if (name === "sample") {
      return peekEditorHandoff()?.from === "project"
        ? t("nav.project")
        : t("nav.library");
    }
    if (name === "session") return t("nav.capture");
    if (name === "workspace") return t("hub.title");
    const link = [...this.#navLinks(), ...this.#accessLinks()].find(
      (l) => l.route.name === name,
    );
    return link?.label ?? t("nav.capture");
  }

  #currentProjectTitle(): string {
    return (
      this.projects.find((p) => p.id === this.currentProjectId)?.title ??
      t("project.switch")
    );
  }

  /** Close sonic-pop after a menu click (Tadaaa pattern). */
  #closeNavPop = {
    capture: true,
    handleEvent(event: Event) {
      const menu = event.currentTarget as HTMLElement | null;
      const pop = menu?.closest("sonic-pop") as
        | (HTMLElement & { hide?: () => void })
        | null;
      queueMicrotask(() => pop?.hide?.());
    },
  };

  /** Parent in the app chrome hierarchy (not browser history). */
  #chromeParentRoute(): Route {
    if (this.route.name === "sample") return { name: "library" };
    if (this.route.name === "workspace") return { name: "landing" };
    if (this.#routeNeedsProject(this.route)) return { name: "workspace" };
    return { name: "landing" };
  }

  #chromeParentLabel(): string {
    if (this.route.name === "sample") return t("nav.library");
    if (this.route.name === "workspace") return t("nav.home");
    if (this.#routeNeedsProject(this.route)) return t("hub.title");
    return t("nav.home");
  }

  #breadcrumb() {
    const section = this.#sectionLabel();
    const parent = this.#chromeParentRoute();
    const parentLabel = this.#chromeParentLabel();
    const up = tip(
      parentLabel,
      html`
        <sonic-button
          href=${pathFor(parent)}
          ?pushState=${true}
          shape="circle"
          variant="ghost"
          size="sm"
          class="shrink-0"
          data-aria-label=${parentLabel}
        >
          ${glIcon("arrow-left", { size: "sm" })}
        </sonic-button>
      `,
    );

    /** Top-level access pages: single crumb, switch among account / privacy / diagnostic. */
    if (this.#isAccessRoute()) {
      return html`
        <nav
          class="gl-breadcrumb flex min-w-0 flex-1 items-center gap-0.5 text-sm"
          aria-label=${t("common.breadcrumb")}
        >
          ${up}
          <sonic-pop
            class="gl-bc-pop max-w-40 sm:max-w-52"
            placement="bottom"
          >
            <sonic-button
              variant="ghost"
              type="neutral"
              size="sm"
              justify="start"
              class="max-w-full"
              aria-current="page"
              title=${section}
              data-aria-label=${section}
            >
              <span class="gl-bc-label font-medium text-neutral-900"
                >${section}</span
              >
              ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}
            </sonic-button>
            ${this.#accessMenu()}
          </sonic-pop>
        </nav>
      `;
    }

    const projectTitle = this.#currentProjectTitle();
    return html`
      <nav
        class="gl-breadcrumb flex min-w-0 flex-1 items-center gap-0.5 text-sm"
        aria-label=${t("common.breadcrumb")}
      >
        ${up}
        <sonic-pop
          class="gl-bc-pop max-w-32 sm:max-w-40"
          placement="bottom"
        >
          <sonic-button
            variant="ghost"
            type="neutral"
            size="sm"
            justify="start"
            class="max-w-full"
            title=${projectTitle}
            data-aria-label=${t("project.switch")}
          >
            <span class="gl-bc-label text-neutral-600">${projectTitle}</span>
            ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}
          </sonic-button>
          ${this.#projectMenu()}
        </sonic-pop>
        <span class="shrink-0" aria-hidden="true"
          >${glIcon("chevron-right", { size: "sm" })}</span
        >
        <sonic-pop
          class="gl-bc-pop max-w-32 sm:max-w-44"
          placement="bottom"
        >
          <sonic-button
            variant="ghost"
            type="neutral"
            size="sm"
            justify="start"
            class="max-w-full"
            aria-current="page"
            title=${section}
            data-aria-label=${section}
          >
            <span class="gl-bc-label font-medium text-neutral-900"
              >${section}</span
            >
            ${glIcon("chevron-down", { size: "xs", slot: "suffix" })}
          </sonic-button>
          ${this.#sectionMenu()}
        </sonic-pop>
      </nav>
    `;
  }

  /** Page contextual more — breadcrumb row, right-aligned (`chromeMore.set`). */
  #breadcrumbMore() {
    const items = this.chromeMoreItems;
    if (!Array.isArray(items) || items.length === 0) return nothing;
    return renderMoreMenu({
      ariaLabel: this.chromeMoreLabel || t("nav.menu"),
      items,
    });
  }

  #projectMenu() {
    return html`
      <div
        slot="content"
        class="max-h-[min(36rem,calc(100dvh-5.5rem))] overflow-y-auto overscroll-contain"
      >
        <sonic-menu
          direction="column"
          align="left"
          size="sm"
          @click=${this.#closeNavPop}
        >
          <sonic-divider
            label=${t("project.switch")}
            align="left"
            size="sm"
          ></sonic-divider>
          ${this.projects.map(
            (p) => html`
              <sonic-menu-item
                ?active=${p.id === this.currentProjectId}
                @click=${() => set(projectPickKey.projectId, p.id)}
              >
                ${glIcon("folder", { slot: "prefix", size: "xs" })}
                ${p.title}
              </sonic-menu-item>
            `,
          )}
          <sonic-menu-item @click=${() => void this.#createProject()}>
            ${glIcon("plus", { slot: "prefix", size: "xs" })}
            ${t("project.new")}
          </sonic-menu-item>
          ${this.currentProjectId
            ? html`
                <sonic-menu-item @click=${() => void this.#renameProject()}>
                  ${glIcon("pencil", { slot: "prefix", size: "xs" })}
                  ${t("project.rename")}
                </sonic-menu-item>
                <sonic-menu-item @click=${() => void this.#duplicateProject()}>
                  ${glIcon("copy", { slot: "prefix", size: "xs" })}
                  ${t("project.duplicate")}
                </sonic-menu-item>
                <sonic-menu-item
                  type="danger"
                  @click=${() => void this.#deleteProject()}
                >
                  ${glIcon("trash-2", { slot: "prefix", size: "xs" })}
                  ${t("project.delete")}
                </sonic-menu-item>
              `
            : nothing}
        </sonic-menu>
      </div>
    `;
  }

  #linkMenu(
    links: {
      href: string;
      label: string;
      icon: string;
      route: Route;
      section?: GlSection;
    }[],
  ) {
    return html`
      <div
        slot="content"
        class="max-h-[min(36rem,calc(100dvh-5.5rem))] overflow-y-auto overscroll-contain"
      >
        <sonic-menu
          direction="column"
          align="left"
          size="sm"
          @click=${this.#closeNavPop}
        >
          ${links.map((l) => {
            const locked =
              l.section !== undefined &&
              !sectionReady(l.section, this.readiness);
            const lockKey = l.section
              ? blockReasonKey(l.section, this.readiness)
              : null;
            return html`
              <sonic-menu-item
                href=${locked ? nothing : l.href}
                ?pushState=${!locked}
                ?active=${this.#navActive(l)}
                title=${locked && lockKey ? t(lockKey) : nothing}
                @click=${locked
                  ? (e: Event) => {
                      e.preventDefault();
                      if (lockKey) void glDialog.alert(t(lockKey));
                    }
                  : nothing}
              >
                ${glIcon(l.icon, { slot: "prefix", size: "xs" })}
                ${l.label}
                ${locked
                  ? glIcon("lock", { slot: "suffix", size: "xs" })
                  : nothing}
              </sonic-menu-item>
            `;
          })}
        </sonic-menu>
      </div>
    `;
  }

  /** Project chrome: hub + Capture / Library / Synth / Arrangement. */
  #sectionMenu() {
    return html`
      <div
        slot="content"
        class="max-h-[min(36rem,calc(100dvh-5.5rem))] overflow-y-auto overscroll-contain"
      >
        <sonic-menu
          direction="column"
          align="left"
          size="sm"
          @click=${this.#closeNavPop}
        >
          <sonic-menu-item
            href=${pathFor({ name: "workspace" })}
            ?pushState=${true}
            ?active=${this.route.name === "workspace"}
          >
            ${glIcon("layout-grid", { slot: "prefix", size: "xs" })}
            ${t("hub.title")}
          </sonic-menu-item>
          <sonic-divider></sonic-divider>
          ${this.#navLinks().map((l) => {
            const locked =
              !sectionReady(l.section, this.readiness);
            const lockKey = blockReasonKey(l.section, this.readiness);
            return html`
              <sonic-menu-item
                href=${locked ? nothing : l.href}
                ?pushState=${!locked}
                ?active=${this.#navActive(l)}
                title=${locked ? t(lockKey!) : nothing}
                @click=${locked
                  ? (e: Event) => {
                      e.preventDefault();
                      void glDialog.alert(t(lockKey!));
                    }
                  : nothing}
              >
                ${glIcon(l.icon, { slot: "prefix", size: "xs" })}
                ${l.label}
                ${locked
                  ? glIcon("lock", { slot: "suffix", size: "xs" })
                  : nothing}
              </sonic-menu-item>
            `;
          })}
        </sonic-menu>
      </div>
    `;
  }

  /** Access chrome: Compte / Vie privée / Diagnostic. */
  #accessMenu() {
    return this.#linkMenu(this.#accessLinks());
  }

  #mainNavMenu() {
    return html`
      <div
        slot="content"
        class="max-h-[min(36rem,calc(100dvh-5.5rem))] overflow-y-auto overscroll-contain"
      >
        <sonic-menu
          direction="column"
          align="left"
          size="sm"
          @click=${this.#closeNavPop}
        >
          <sonic-divider
            label=${t("theme.section")}
            align="left"
            size="sm"
          ></sonic-divider>
          ${APP_THEMES.map(
            (meta) => html`
              <sonic-menu-item
                ?active=${this.themeId === meta.id}
                @click=${() => void this.#setTheme(meta.id)}
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
              >
                ${glIcon(l.icon, { slot: "prefix", size: "xs" })}
                ${l.label}
              </sonic-menu-item>
            `,
          )}
        </sonic-menu>
      </div>
    `;
  }

  #chromeLess(): boolean {
    return this.route.name === "landing" || this.route.name === "listen";
  }

  override render() {
    const links = this.#navLinks();
    if (this.#chromeLess()) {
      return html`
        <sonic-theme
          theme=${this.themeMode === "dark" ? "dark" : nothing}
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
        theme=${this.themeMode === "dark" ? "dark" : nothing}
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
            <sonic-pop class="inline-block shrink-0" placement="bottom">
              ${tip(
                t("nav.menu"),
                html`
                  <sonic-button
                    shape="circle"
                    size="sm"
                    variant="ghost"
                    type="neutral"
                    data-aria-label=${t("nav.menu")}
                  >
                    ${glIcon("menu", { size: "lg" })}
                  </sonic-button>
                `,
              )}
              ${this.#mainNavMenu()}
            </sonic-pop>

            <sonic-button
              class="brand shrink-0 gap-1.5 text-primary [&_.gl-brand-mark]:shrink-0 [&_.gl-brand-mark]:text-primary"
              variant="ghost"
              size="lg"
              type="neutral"
              href=${pathFor({ name: "landing" })}
              ?pushState=${true}
            >
              ${glBrandMark({ size: "1.35rem", slot: "prefix" })}
              <span>${APP_NAME}</span>
            </sonic-button>

            <div class="ml-auto inline-flex shrink-0 items-center gap-1">
              ${this.proc.remaining > 0
                ? html`<sonic-badge type="info" size="sm">
                    ${glIcon("loader", { size: "xs" })}
                    ${this.proc.running > 0 ? "●" : "○"}
                    ${this.proc.remaining}
                  </sonic-badge>`
                : nothing}
              ${this.proc.error > 0
                ? tip(
                    tf("process.retryAll", {
                      n: String(this.proc.error),
                    }),
                    html`<sonic-button
                      size="sm"
                      variant="outline"
                      type="warning"
                      data-aria-label=${tf("process.retryAll", {
                        n: String(this.proc.error),
                      })}
                      @click=${() => void processQueue.retryUnfinished()}
                    >
                      ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
                      ${this.proc.error}
                    </sonic-button>`,
                  )
                : nothing}
              ${tip(
                `${t("cmd.palette")} (Alt+K)`,
                html`
                  <sonic-button
                    class="ml-0.5"
                    size="sm"
                    variant="ghost"
                    type="neutral"
                    data-aria-label=${t("cmd.palette")}
                    @click=${() => {
                      this.paletteOpen = true;
                      set(paletteKey, { q: "" });
                    }}
                  >
                    ${glIcon("search", { slot: "prefix", size: "sm" })}
                    <span class="hidden text-neutral-500 sm:inline"
                      >${t("nav.search")}</span
                    >
                  </sonic-button>
                `,
              )}
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
          <main>
            <div
              class="mb-4 flex min-h-7 shrink-0 items-center gap-2 overflow-visible px-3 pt-4 sm:px-4"
            >
              ${this.#breadcrumb()}
              <div class="ml-auto shrink-0">${this.#breadcrumbMore()}</div>
            </div>
            ${this.#page()}
          </main>
          ${this.#palette(links)}
        </sonic-scope>
      </sonic-theme>
    `;
  }

  #page() {
    switch (this.route.name) {
      case "landing":
        return html`<gl-landing-page></gl-landing-page>`;
      case "workspace":
        return html`<gl-workspace-hub-page></gl-workspace-hub-page>`;
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
      case "synth":
        return html`<gl-synth-page></gl-synth-page>`;
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

  #palette(
    links: {
      href: string;
      label: string;
      icon: string;
      route: Route;
      section?: GlSection;
    }[],
  ) {
    const q = this.paletteFilter.toLowerCase();
    const items = [
      ...(this.currentProjectId
        ? [
            {
              label: t("hub.title"),
              icon: "layout-grid",
              run: () => navigate({ name: "workspace" }),
            },
          ]
        : []),
      ...links.map((l) => ({
        label: l.label,
        icon: l.icon,
        section: l.section,
        run: () => {
          if (l.section && !sectionReady(l.section, this.readiness)) {
            const key = blockReasonKey(l.section, this.readiness);
            if (key) void glDialog.alert(t(key));
            return;
          }
          navigate(l.route);
        },
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
        section: "project" as GlSection,
        run: () => {
          if (!sectionReady("project", this.readiness)) {
            const key = blockReasonKey("project", this.readiness);
            if (key) void glDialog.alert(t(key));
            return;
          }
          navigate({
            name: "project",
            id: this.currentProjectId || undefined,
          });
        },
      },
    ].filter((i) => i.label.toLowerCase().includes(q));

    const m = GL_MODAL_PRESETS.form;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.paletteOpen}
        @hide=${() => {
          this.paletteOpen = false;
        }}
      >
        <sonic-modal-title>${t("nav.search")}</sonic-modal-title>
        <sonic-modal-content>
          <panel formDataProvider=${paletteKey.path}>
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
        </sonic-modal-content>
      </sonic-modal>
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
    navigate({ name: "workspace" });
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
    navigate({ name: "workspace" });
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
    this.currentProjectId = next?.id ?? "";
    await this.#refreshProjects();
    if (!next) {
      navigate({ name: "landing" });
      return;
    }
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
