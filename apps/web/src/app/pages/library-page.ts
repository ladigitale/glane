import {
  CLASS_COLORS,
  type Sample,
  type SampleClass,
  type Session,
} from "@glane/core-model";
import { TransportEngine } from "@glane/audio-engine";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import { db } from "../db.js";
import { t, tf } from "../i18n/messages.js";
import { navigate } from "../router.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { processQueue } from "../process-queue.js";
import {
  copySampleToProject,
  copySamplesToProject,
  deleteSample,
  deleteSamples,
  duplicateSample,
  duplicateSamples,
  importAudioFiles,
  renameSample,
  setFavoriteMany,
  toggleFavorite,
} from "../sample-actions.js";
import { libraryMachineExport, type MachineTarget } from "../library-machine-export.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { libraryFiltersKey } from "../dp-keys.js";
import { glDialog } from "../dialog.js";
import { glIcon } from "../icon.js";
import type { MoreMenuItem } from "../more-menu.js";
import { renderMoreMenu } from "../more-menu.js";
import "../pop-select.js";

const ROW_H = 56;

const SAMPLE_CLASSES: Array<SampleClass | "all"> = [
  "all",
  "percussive",
  "tonal",
  "texture",
  "noise",
  "rhythmic",
  "voice",
  "unclassified",
];

@customElement("gl-library-page")
export class GlLibraryPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        padding: 1rem;
        padding-left: max(1rem, env(safe-area-inset-left));
        padding-right: max(1rem, env(safe-area-inset-right));
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
        box-sizing: border-box;
        max-width: 100%;
        overflow-x: hidden;
      }
      .row.playing {
        outline: 1px solid var(--sc-primary);
      }
      .row.selected {
        outline: 1px solid color-mix(in srgb, var(--sc-primary) 70%, transparent);
        background: color-mix(in srgb, var(--sc-primary) 12%, var(--sc-base-100));
      }
    `,
  ];

  @state() private samples: Sample[] = [];
  @state() private sessions: Session[] = [];

  @subscribe(libraryFiltersKey.classFilter)
  @state()
  classFilter: SampleClass | "all" | null = "all";

  /** sessionId or "" for all */
  @subscribe(libraryFiltersKey.sessionFilter)
  @state()
  sessionFilter = "";

  @subscribe(libraryFiltersKey.tagFilter)
  @state()
  tagFilter = "";

  @subscribe(libraryFiltersKey.q)
  @state()
  captureQuery = "";

  @state() private selected = new Set<string>();
  @state() private sieve = false;
  @state() private sieveIndex = 0;
  @state() private listScrollTop = 0;
  @state() private viewportH = 600;
  @state() private playingId: string | null = null;
  @state() private batchBusy = false;

  #pointerStartX = 0;
  #pointerStartY = 0;
  #engine: TransportEngine | null = null;
  #lastTapAt = 0;
  #lastTapId: string | null = null;
  #unsubProc: (() => void) | null = null;
  #lastProcRemaining = -1;

  override connectedCallback(): void {
    super.connectedCallback();
    set(libraryFiltersKey, {
      classFilter: "all",
      sessionFilter: "",
      tagFilter: "",
      q: "",
    });
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    void this.#reload();
    this.#unsubProc = processQueue.subscribe((s) => {
      if (s.remaining !== this.#lastProcRemaining) {
        this.#lastProcRemaining = s.remaining;
        void this.#reload();
      }
    });
  }

  override disconnectedCallback(): void {
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    this.#unsubProc?.();
    this.#engine?.stop();
    super.disconnectedCallback();
  }

  #onProjectChange = (): void => {
    set(libraryFiltersKey.sessionFilter, "");
    set(libraryFiltersKey.tagFilter, "");
    void this.#reload();
  };

  get #filtered(): Sample[] {
    let list = this.samples;
    if (this.sessionFilter) {
      list = list.filter((s) => s.sessionId === this.sessionFilter);
    }
    // FormCheckable `unique` can write null when sibling buttons mount; treat as all.
    if (this.classFilter && this.classFilter !== "all") {
      list = list.filter((s) => s.class === this.classFilter);
    }
    if (this.tagFilter) {
      list = list.filter((s) => (s.tags ?? []).includes(this.tagFilter));
    }
    const q = this.captureQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.captureName ?? "").toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.userName ?? "").toLowerCase().includes(q) ||
          (s.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }

  get #sessionOptions(): { id: string; label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const s of this.samples) {
      counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    }
    const byId = new Map(this.sessions.map((s) => [s.id, s]));
    const opts: { id: string; label: string; count: number }[] = [];
    for (const [id, count] of counts) {
      const sess = byId.get(id);
      const label =
        sess?.title?.trim() ||
        this.samples.find((s) => s.sessionId === id)?.captureName ||
        id.slice(0, 8);
      opts.push({ id, label, count });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return opts;
  }

  get #tagOptions(): { value: string; label: string }[] {
    const counts = new Map<string, number>();
    for (const s of this.samples) {
      for (const tag of s.tags ?? []) {
        if (!tag || tag.startsWith("processing:")) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: `${value} (${count})` }))
      .sort((a, b) => a.value.localeCompare(b.value, "fr"));
  }

  override render() {
    const filtered = this.#filtered;
    const start = Math.max(0, Math.floor(this.listScrollTop / ROW_H) - 2);
    const visible = Math.ceil(this.viewportH / ROW_H) + 4;
    const end = Math.min(filtered.length, start + visible);
    const slice = filtered.slice(start, end);
    const selectedCount = [...this.selected].filter((id) =>
      filtered.some((s) => s.id === id),
    ).length;
    const allFilteredSelected =
      filtered.length > 0 && filtered.every((s) => this.selected.has(s.id));
    const classActive = !!(this.classFilter && this.classFilter !== "all");
    const noSel = selectedCount === 0 || this.batchBusy;
    const noExport = filtered.length === 0 || this.batchBusy;
    const batchItems: Array<MoreMenuItem | "divider"> = [
      {
        label: t("library.batchFav"),
        icon: "star",
        disabled: noSel,
        onClick: () => void this.#batchFavorite(true),
      },
      {
        label: t("library.batchUnfav"),
        icon: "star",
        disabled: noSel,
        onClick: () => void this.#batchFavorite(false),
      },
      {
        label: t("library.batchDuplicate"),
        icon: "copy",
        disabled: noSel,
        onClick: () => void this.#batchDuplicate(),
      },
      {
        label: t("library.batchCopyToProject"),
        icon: "folder-plus",
        disabled: noSel,
        onClick: () => void this.#batchCopyToProject(),
      },
      {
        label: t("library.exportMachine"),
        icon: "download",
        disabled: noExport,
        onClick: () => void this.#exportMachine(),
      },
      {
        label: t("library.batchDelete"),
        icon: "trash-2",
        disabled: noSel,
        onClick: () => void this.#batchDelete(),
      },
    ];
    if (selectedCount > 0) {
      batchItems.push("divider", {
        label: t("library.clearSelection"),
        onClick: () => {
          this.selected = new Set();
        },
      });
    }

    return html`
      <div
        class="mb-3 flex flex-wrap items-center gap-2"
        formDataProvider=${libraryFiltersKey.path}
      >
        <sonic-input
          class="capture-q min-w-[min(10rem,100%)] flex-[1_1_10rem] max-[480px]:min-w-0 max-[480px]:flex-[1_1_100%]"
          name="q"
          type="search"
          size="sm"
          inlineContent
          placeholder=${t("library.search")}
        >
          ${glIcon("search", { slot: "prefix", size: "sm" })}
        </sonic-input>
        <gl-pop-select
          class="max-w-64 max-[480px]:max-w-full max-[480px]:flex-[1_1_auto]"
          size="sm"
          .value=${this.classFilter && this.classFilter !== "all"
            ? this.classFilter
            : "all"}
          .options=${SAMPLE_CLASSES.map((c) => ({
            value: c,
            label: c === "all" ? t("library.allClasses") : c,
          }))}
          placeholder=${t("library.allClasses")}
          searchPlaceholder=${t("library.popSearch")}
          ?active=${classActive}
          @gl-change=${(e: CustomEvent<{ value: string }>) => {
            set(
              libraryFiltersKey.classFilter,
              e.detail.value as SampleClass | "all",
            );
            this.selected = new Set();
          }}
        ></gl-pop-select>
        <gl-pop-select
          class="max-w-64 max-[480px]:max-w-full max-[480px]:flex-[1_1_auto]"
          size="sm"
          .value=${this.sessionFilter}
          .options=${[
            { value: "", label: t("library.allSessions") },
            ...this.#sessionOptions.map((o) => ({
              value: o.id,
              label: `${o.label} (${o.count})`,
            })),
          ]}
          placeholder=${t("library.allSessions")}
          searchPlaceholder=${t("library.popSearch")}
          ?active=${!!this.sessionFilter}
          @gl-change=${(e: CustomEvent<{ value: string }>) => {
            set(libraryFiltersKey.sessionFilter, e.detail.value);
            this.selected = new Set();
          }}
        ></gl-pop-select>
        <gl-pop-select
          class="max-w-64 max-[480px]:max-w-full max-[480px]:flex-[1_1_auto]"
          size="sm"
          .value=${this.tagFilter}
          .options=${[
            { value: "", label: t("library.allTags") },
            ...this.#tagOptions,
          ]}
          placeholder=${t("library.allTags")}
          searchPlaceholder=${t("library.popSearch")}
          ?active=${!!this.tagFilter}
          @gl-change=${(e: CustomEvent<{ value: string }>) => {
            set(libraryFiltersKey.tagFilter, e.detail.value);
            this.selected = new Set();
          }}
        ></gl-pop-select>
        <sonic-button
          type="neutral"
          variant="outline"
          size="sm"
          ?disabled=${this.batchBusy}
          @click=${() =>
            this.renderRoot
              .querySelector<HTMLInputElement>("#import-audio")
              ?.click()}
        >
          ${glIcon("upload", { slot: "prefix", size: "xs" })}
          ${t("library.import")}
        </sonic-button>
        <input
          id="import-audio"
          class="sr-only"
          type="file"
          accept=".wav,.wave,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3"
          multiple
          @change=${(e: Event) => void this.#onImportFiles(e)}
        />
        ${renderMoreMenu({
          ariaLabel: t("library.batchMore"),
          items: batchItems,
        })}
      </div>

      <div
        class="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-100 px-[0.65rem] py-2"
      >
        <label
          class="inline-flex cursor-pointer select-none items-center gap-1.5 font-mono text-xs text-neutral-500"
        >
          <input
            type="checkbox"
            class="h-[18px] w-[18px] cursor-pointer accent-primary"
            .checked=${allFilteredSelected}
            .indeterminate=${selectedCount > 0 && !allFilteredSelected}
            @change=${() => this.#toggleSelectAll(filtered)}
          />
          ${t("library.selectAll")}
        </label>
        <span
          class="ml-auto font-mono text-xs text-neutral-500 max-[480px]:ml-0 max-[480px]:flex-[1_1_100%]"
          >${filtered.length} sons</span
        >
      </div>

      ${filtered.length === 0
        ? html`<p>${t("library.empty")}</p>`
        : html`
            <div
              class="relative h-[calc(100dvh-14rem)] overflow-auto [-webkit-overflow-scrolling:touch] [contain:strict]"
              @scroll=${this.#onScroll}
            >
              <div
                class="relative w-full"
                style="height:${filtered.length * ROW_H}px"
              >
                ${slice.map((s, i) => {
                  const idx = start + i;
                  const isSel = this.selected.has(s.id);
                  return html`
                    <div
                      class="row absolute inset-x-0 box-border grid grid-cols-[28px_8px_1fr_auto] items-center gap-[0.45rem] rounded-md bg-neutral-100 px-2 py-[0.35rem] ${this.playingId === s.id ? "playing" : ""} ${isSel
                        ? "selected"
                        : ""}"
                      style="top:${idx * ROW_H}px;height:${ROW_H - 4}px"
                    >
                      <input
                        type="checkbox"
                        class="h-[18px] w-[18px] cursor-pointer accent-primary"
                        .checked=${isSel}
                        @change=${(e: Event) => {
                          e.stopPropagation();
                          this.#toggleOne(s.id);
                        }}
                        @click=${(e: Event) => e.stopPropagation()}
                      />
                      <span
                        class="h-full min-h-7 w-2 rounded-sm"
                        style="background:${CLASS_COLORS[s.class]}"
                        aria-label="${s.class}"
                      ></span>
                      <button
                        class="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-inherit text-inherit"
                        type="button"
                        @click=${() => void this.#onRowClick(s)}
                      >
                        <div>${s.userName ?? s.name}</div>
                        <div class="font-mono text-xs text-neutral-500">
                          ${s.captureName ? `${s.captureName} · ` : ""}${s.class}
                          · ${s.durationMs}ms
                          ${s.loopProposed ? " · boucle" : ""}${
                            (s.tags ?? []).includes("processing:pending") ||
                            (s.tags ?? []).includes("processing:running")
                              ? " · processing…"
                              : ""
                          }
                          ${(s.tags ?? []).length
                            ? ` · ${(s.tags ?? []).slice(0, 3).join(", ")}`
                            : ""}
                        </div>
                      </button>
                      <div
                        class="flex items-center"
                        @click=${(e: Event) => e.stopPropagation()}
                      >
                        ${renderMoreMenu({
                          ariaLabel: t("library.more"),
                          size: "sm",
                          icon: "horizontal",
                          items: [
                            {
                              label: s.favorite
                                ? t("library.unfav")
                                : t("library.fav"),
                              icon: "star",
                              onClick: () => void this.#fav(s),
                            },
                            {
                              label: t("library.rename"),
                              icon: "pencil",
                              onClick: () => void this.#rename(s),
                            },
                            {
                              label: t("library.duplicate"),
                              icon: "copy",
                              onClick: () => void this.#duplicate(s),
                            },
                            {
                              label: t("library.copyToProject"),
                              icon: "folder-plus",
                              onClick: () => void this.#copyToProject(s),
                            },
                            {
                              label: t("library.delete"),
                              icon: "trash-2",
                              onClick: () => void this.#remove(s),
                            },
                          ],
                        })}
                      </div>
                    </div>
                  `;
                })}
              </div>
            </div>
          `}
      ${!this.sieve && filtered.length > 0
        ? html`
            <div
              class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-20 rounded-full shadow-[0_4px_18px_color-mix(in_srgb,#000_35%,transparent)]"
            >
              <sonic-button
                shape="circle"
                type="primary"
                size="lg"
                icon
                data-aria-label=${t("library.sieve")}
                @click=${() => {
                  this.sieveIndex = 0;
                  this.sieve = true;
                }}
              >
                ${glIcon("filter", { size: "md" })}
              </sonic-button>
            </div>
          `
        : nothing}
      ${this.sieve && filtered[this.sieveIndex]
        ? this.#renderSieve(filtered)
        : nothing}
    `;
  }

  #toggleOne(id: string): void {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected = next;
  }

  #toggleSelectAll(filtered: Sample[]): void {
    const allOn = filtered.length > 0 && filtered.every((s) => this.selected.has(s.id));
    if (allOn) {
      const next = new Set(this.selected);
      for (const s of filtered) next.delete(s.id);
      this.selected = next;
    } else {
      const next = new Set(this.selected);
      for (const s of filtered) next.add(s.id);
      this.selected = next;
    }
  }

  #selectedInView(): string[] {
    const filteredIds = new Set(this.#filtered.map((s) => s.id));
    return [...this.selected].filter((id) => filteredIds.has(id));
  }

  async #batchFavorite(favorite: boolean): Promise<void> {
    const ids = this.#selectedInView();
    if (ids.length === 0) return;
    this.batchBusy = true;
    try {
      await setFavoriteMany(ids, favorite);
      await this.#reload();
    } finally {
      this.batchBusy = false;
    }
  }

  async #batchDelete(): Promise<void> {
    const ids = this.#selectedInView();
    if (ids.length === 0) return;
    const ok = await glDialog.confirm({
      message: `Supprimer ${ids.length} son(s) ?`,
      confirmLabel: t("dialog.delete"),
      danger: true,
    });
    if (!ok) return;
    this.batchBusy = true;
    try {
      await deleteSamples(ids);
      this.selected = new Set();
      if (this.playingId && ids.includes(this.playingId)) {
        this.#engine?.stop();
        this.playingId = null;
      }
      await this.#reload();
    } finally {
      this.batchBusy = false;
    }
  }

  async #batchDuplicate(): Promise<void> {
    const ids = this.#selectedInView();
    if (ids.length === 0) return;
    this.batchBusy = true;
    try {
      await duplicateSamples(ids);
      await this.#reload();
    } finally {
      this.batchBusy = false;
    }
  }

  async #onImportFiles(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    if (files.length === 0) return;
    const projectId = await projectWorkspace.currentId();
    this.batchBusy = true;
    try {
      const { imported, failed } = await importAudioFiles(files, projectId);
      await this.#reload();
      if (imported === 0) {
        await glDialog.alert(t("library.importFailed"));
        return;
      }
      const summary =
        failed > 0
          ? tf("library.importSummaryPartial", { imported, failed })
          : tf("library.importSummary", { imported });
      await glDialog.alert(`${t("library.importDone")} — ${summary}`);
    } finally {
      this.batchBusy = false;
    }
  }

  async #pickTargetProject(): Promise<string | null> {
    const currentId = await projectWorkspace.currentId();
    const others = (await projectWorkspace.listActive()).filter(
      (p) => p.id !== currentId,
    );
    if (others.length === 0) {
      await glDialog.alert(t("library.noOtherProject"));
      return null;
    }
    return glDialog.choose({
      title: t("library.copyToProjectTitle"),
      message: t("library.copyToProjectMsg"),
      options: others.map((p) => ({ value: p.id, label: p.title })),
    });
  }

  async #batchCopyToProject(): Promise<void> {
    const ids = this.#selectedInView();
    if (ids.length === 0) return;
    const targetId = await this.#pickTargetProject();
    if (!targetId) return;
    this.batchBusy = true;
    try {
      const n = await copySamplesToProject(ids, targetId);
      if (n === 0) {
        await glDialog.alert(t("library.copyFailed"));
      }
    } finally {
      this.batchBusy = false;
    }
  }

  async #exportMachine(): Promise<void> {
    const filtered = this.#filtered;
    if (filtered.length === 0) return;
    const selectedIds = new Set(this.#selectedInView());
    const samples =
      selectedIds.size > 0
        ? filtered.filter((s) => selectedIds.has(s.id))
        : filtered;
    const target = (await glDialog.choose({
      title: t("library.exportMachineTitle"),
      message: `${t("library.exportMachineMsg")} (${samples.length})`,
      options: [
        { value: "octatrack", label: t("library.exportOctatrack") },
        { value: "mpc2000xl", label: t("library.exportMpc2000xl") },
      ],
    })) as MachineTarget | null;
    if (!target) return;
    this.batchBusy = true;
    try {
      const { blob, exported, skipped } =
        await libraryMachineExport.buildZip(samples, target);
      if (exported === 0) {
        await glDialog.alert(t("library.exportEmpty"));
        return;
      }
      const project = await projectWorkspace.ensure();
      libraryMachineExport.download(project.title, target, blob);
      if (skipped > 0) {
        await glDialog.alert(
          `${t("library.exportDone")} — ${exported} WAV, ${skipped} ignoré(s).`,
        );
      }
    } finally {
      this.batchBusy = false;
    }
  }

  #onScroll = (e: Event): void => {
    const el = e.target as HTMLElement;
    this.listScrollTop = el.scrollTop;
    this.viewportH = el.clientHeight;
  };

  async #onRowClick(s: Sample): Promise<void> {
    const now = performance.now();
    if (this.#lastTapId === s.id && now - this.#lastTapAt < 350) {
      navigate({ name: "sample", id: s.id });
      return;
    }
    this.#lastTapId = s.id;
    this.#lastTapAt = now;
    await this.#audition(s);
  }

  async #audition(s: Sample): Promise<void> {
    this.#engine ??= new TransportEngine();
    const data = await loadSampleAudio(s);
    if (!data) {
      navigate({ name: "sample", id: s.id });
      return;
    }
    const buf = this.#engine.ctx.createBuffer(
      1,
      data.pcm.length,
      data.sampleRate,
    );
    buf.copyToChannel(new Float32Array(data.pcm), 0);
    this.playingId = s.id;
    this.#engine.audition(buf, 5);
  }

  #renderSieve(filtered: Sample[]) {
    const s = filtered[this.sieveIndex]!;
    return html`
      <div
        class="sieve fixed inset-0 z-30 flex touch-none flex-col items-center justify-center bg-neutral-0 p-6"
        @pointerdown=${(e: PointerEvent) => {
          this.#pointerStartX = e.clientX;
          this.#pointerStartY = e.clientY;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        @pointerup=${(e: PointerEvent) => void this.#sieveGesture(e, filtered)}
      >
        <h2 class="font-display">${s.userName ?? s.name}</h2>
        <p class="font-mono text-xs text-neutral-500">
          ${s.class} · tap = écouter · swipe → garder · ← jeter · ↑ favori
        </p>
        <span
          class="swatch"
          style="width:48px;height:48px;background:${CLASS_COLORS[s.class]};border-radius:8px"
          @click=${() => void this.#audition(s)}
        ></span>
        <sonic-button
          type="neutral"
          variant="outline"
          style="margin-top:2rem"
          @click=${() => (this.sieve = false)}
        >
          ${glIcon("x", { slot: "prefix", size: "xs" })}
          Fermer
        </sonic-button>
      </div>
    `;
  }

  async #reload(): Promise<void> {
    const projectId = await projectWorkspace.currentId();
    const [samples, sessions] = await Promise.all([
      db.samples
        .where("projectId")
        .equals(projectId)
        .filter((s) => !s.deletedAt)
        .reverse()
        .sortBy("createdAt"),
      db.sessions.where("projectId").equals(projectId).sortBy("startedAt"),
    ]);
    this.samples = samples;
    this.sessions = sessions
      .filter((s) => !s.deletedAt)
      .reverse();
    // Drop selection of deleted ids
    const alive = new Set(samples.map((s) => s.id));
    this.selected = new Set([...this.selected].filter((id) => alive.has(id)));
  }

  async #sieveGesture(e: PointerEvent, filtered: Sample[]): Promise<void> {
    const dx = e.clientX - this.#pointerStartX;
    const dy = e.clientY - this.#pointerStartY;
    const s = filtered[this.sieveIndex];
    if (!s) return;
    if (Math.hypot(dx, dy) < 24) {
      await this.#audition(s);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        await deleteSample(s.id);
      }
      this.sieveIndex = Math.min(this.sieveIndex + 1, filtered.length - 1);
    } else if (dy < 0) {
      await toggleFavorite(s.id);
      this.sieveIndex = Math.min(this.sieveIndex + 1, filtered.length - 1);
    }
    await this.#reload();
    if (this.sieveIndex >= filtered.length - 1) this.sieve = false;
  }

  async #fav(s: Sample): Promise<void> {
    await toggleFavorite(s.id);
    await this.#reload();
  }

  async #rename(s: Sample): Promise<void> {
    const next = await glDialog.prompt({
      title: t("library.renamePrompt"),
      label: t("library.renamePrompt"),
      value: s.userName ?? s.name,
    });
    if (next == null) return;
    await renameSample(s.id, next);
    await this.#reload();
  }

  async #duplicate(s: Sample): Promise<void> {
    const cloned = await duplicateSample(s.id);
    if (!cloned) {
      await glDialog.alert(t("library.copyFailed"));
      return;
    }
    await this.#reload();
  }

  async #copyToProject(s: Sample): Promise<void> {
    const targetId = await this.#pickTargetProject();
    if (!targetId) return;
    const cloned = await copySampleToProject(s.id, targetId);
    if (!cloned) {
      await glDialog.alert(t("library.copyFailed"));
    }
  }

  async #remove(s: Sample): Promise<void> {
    const label = s.userName ?? s.name;
    const ok = await glDialog.confirm({
      message: `Supprimer « ${label} » ?`,
      confirmLabel: t("dialog.delete"),
      danger: true,
    });
    if (!ok) return;
    await deleteSample(s.id);
    if (this.playingId === s.id) {
      this.#engine?.stop();
      this.playingId = null;
    }
    await this.#reload();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-library-page": GlLibraryPage;
  }
}
