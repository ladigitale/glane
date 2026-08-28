import type { Project } from "@glane/core-model";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/card";
import "@supersoniks/concorde/icon";
import tailwind from "../../css/tailwind";
import { glDialog } from "../dialog.js";
import {
  blockReasonKey,
  loadReadiness,
  sectionReady,
  sectionRoute,
  type GlSection,
  type Readiness,
} from "../feature-readiness.js";
import { loadHubStats, type HubStats } from "../hub-stats.js";
import { t, tf, type MessageKey } from "../i18n/messages.js";
import { glIcon } from "../icon.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { navigate } from "../router.js";
import { formatClock } from "../timeline/timeline.js";

const EMPTY_HUB_STATS: HubStats = {
  sessionCount: 0,
  sampleCount: 0,
  synthSampleCount: 0,
  clipCount: 0,
  arrangementDurationMs: 0,
  bars: 16,
};

type HubStep = {
  section: GlSection;
  icon: string;
  titleKey: MessageKey;
  baselineKey: MessageKey;
  bodyKey: MessageKey;
};

const HUB_STEPS: HubStep[] = [
  {
    section: "capture",
    icon: "mic",
    titleKey: "hub.step.capture.title",
    baselineKey: "hub.step.capture.baseline",
    bodyKey: "hub.step.capture.desc",
  },
  {
    section: "library",
    icon: "library",
    titleKey: "hub.step.library.title",
    baselineKey: "hub.step.library.baseline",
    bodyKey: "hub.step.library.desc",
  },
  {
    section: "synth",
    icon: "sliders",
    titleKey: "hub.step.synth.title",
    baselineKey: "hub.step.synth.baseline",
    bodyKey: "hub.step.synth.desc",
  },
  {
    section: "project",
    icon: "music",
    titleKey: "hub.step.project.title",
    baselineKey: "hub.step.project.baseline",
    bodyKey: "hub.step.project.desc",
  },
];

/** Project hub — buffer between landing and instrument sections. */
@customElement("gl-workspace-hub-page")
export class GlWorkspaceHubPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
        flex-direction: column;
        box-sizing: border-box;
        --hub-card-pad: 1.5rem;
      }
    `,
  ];

  @state() private project: Project | null = null;
  @state() private readiness: Readiness = { projectId: null, sampleCount: 0 };
  @state() private stats: HubStats = EMPTY_HUB_STATS;

  #onProjectChange = (): void => {
    void this.#reload();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    void this.#reload();
  }

  override disconnectedCallback(): void {
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    super.disconnectedCallback();
  }

  async #reload(): Promise<void> {
    const current = await projectWorkspace.ensure();
    this.project = current;
    if (!current) {
      this.readiness = { projectId: null, sampleCount: 0 };
      this.stats = EMPTY_HUB_STATS;
      return;
    }
    const [readiness, stats] = await Promise.all([
      loadReadiness(current.id),
      loadHubStats(current.id),
    ]);
    this.readiness = readiness;
    this.stats = stats;
  }

  async #goSection(section: GlSection): Promise<void> {
    const r = await loadReadiness(this.readiness.projectId ?? undefined);
    this.readiness = r;
    if (!sectionReady(section, r)) {
      const key = blockReasonKey(section, r);
      if (key) await glDialog.alert(t(key));
      return;
    }
    if (!r.projectId) return;
    navigate(sectionRoute(section, r.projectId));
  }

  override render() {
    if (!this.project) return nothing;
    const { sampleCount } = this.readiness;
    return html`
      <div
        class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-8 sm:px-4"
      >
        <header
          class="pb-8 pt-2"
          style="padding-left: var(--hub-card-pad)"
        >
          <p class="m-0 text-base leading-relaxed sm:text-lg">
            ${t("hub.intro")}
          </p>
          ${sampleCount > 0
            ? html`<p
                class="mb-0 mt-3 text-sm leading-relaxed text-neutral-600"
              >
                ${tf("hub.ledeSamples", { n: String(sampleCount) })}
              </p>`
            : nothing}
        </header>
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
          ${HUB_STEPS.map((step) => this.#tile(step, this.stats))}
        </div>
      </div>
    `;
  }

  #statLines(section: GlSection, stats: HubStats): string[] {
    switch (section) {
      case "capture":
        return [tf("hub.stat.sessions", { n: String(stats.sessionCount) })];
      case "library":
        return [tf("hub.stat.samples", { n: String(stats.sampleCount) })];
      case "synth":
        return [
          tf("hub.stat.synthInLibrary", { n: String(stats.synthSampleCount) }),
        ];
      case "project":
        return [
          tf("hub.stat.duration", {
            time: formatClock(stats.arrangementDurationMs),
          }),
          tf("hub.stat.clips", { n: String(stats.clipCount) }),
          tf("hub.stat.bars", { n: String(stats.bars) }),
        ];
    }
  }

  #tile(step: HubStep, stats: HubStats) {
    const enabled = sectionReady(step.section, this.readiness);
    const label = t(step.titleKey);
    const baseline = enabled
      ? t(step.baselineKey)
      : t("hub.step.lockedBaseline");
    const body = enabled ? t(step.bodyKey) : t("hub.step.lockedSamples");
    const statLines = this.#statLines(step.section, stats);
    return html`
      <sonic-card type="base">
        <sonic-card-header>
          <div class="flex flex-col gap-1.5">
            <span class="inline-flex items-center gap-2">
              <sonic-icon
                library="lucide"
                name=${step.icon}
                size="md"
              ></sonic-icon>
              ${label}
            </span>
            <p class="m-0 text-sm font-normal leading-snug opacity-75">
              ${baseline}
            </p>
          </div>
        </sonic-card-header>
        <sonic-card-main>
          <ul
            class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm font-medium tabular-nums text-neutral-700"
          >
            ${statLines.map(
              (line) => html`<li>${line}</li>`,
            )}
          </ul>
          <p class="m-0 mt-3">${body}</p>
        </sonic-card-main>
        <sonic-card-footer class="mt-6 flex justify-start pt-0">
          <sonic-button
            variant="outline"
            type=${enabled ? "primary" : "neutral"}
            ?disabled=${!enabled}
            data-aria-label=${t("hub.open") + " — " + label}
            @click=${() => void this.#goSection(step.section)}
          >
            ${enabled ? t("hub.open") : t("hub.locked")}
            ${enabled
              ? glIcon("arrow-right", { slot: "suffix", size: "xs" })
              : glIcon("lock", { slot: "suffix", size: "xs" })}
          </sonic-button>
        </sonic-card-footer>
      </sonic-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-workspace-hub-page": GlWorkspaceHubPage;
  }
}
