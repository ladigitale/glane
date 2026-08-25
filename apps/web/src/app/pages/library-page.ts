import {
  CLASS_COLORS,
  type Sample,
  type SampleClass,
} from "@glane/core-model";
import { interleavedToAudioBuffer } from "@glane/audio-dsp";
import { TransportEngine } from "@glane/audio-engine";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import { db, ensurePrefs } from "../db.js";
import { soundCountLabel, t, tf } from "../i18n/messages.js";
import { navigate } from "../router.js";
import { clearEditorHandoff } from "../editor-handoff.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import {
  isProcessingBusy,
  isProcessingError,
  processQueue,
  SAMPLE_UPDATED_EVENT,
} from "../process-queue.js";
import {
  SAMPLE_ML_EVENT,
} from "../ml/enrich-queue.js";
import {
  SAMPLE_CLAP_EVENT,
  CLAP_STATUS_EVENT,
  rankLibraryByText,
  rankSimilarSamples,
  type ClapStatusDetail,
} from "../ml/clap-queue.js";
import { isClapAudioReady } from "../ml/clap-runtime.js";
import {
  DEMUCS_QUEUE_EVENT,
  SAMPLE_STEMS_EVENT,
  demucsQueue,
  enqueueDemucsRemoveVocals,
  enqueueDemucsSeparate,
  type DemucsQueueSnapshot,
} from "../ml/demucs-queue.js";
import {
  DENOISE_QUEUE_EVENT,
  SAMPLE_DENOISE_EVENT,
  denoiseQueue,
  enqueueDenoise,
  type DenoiseQueueSnapshot,
} from "../ml/denoise-queue.js";
import { DENOISED_STEM, ML_TAG, stemTag } from "@glane/audio-ml";
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
  autoCropSamples,
} from "../sample-actions.js";
import { libraryMachineExport, type MachineTarget } from "../library-machine-export.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { libraryFiltersKey, libraryQueueKey } from "../dp-keys.js";
import {
  filteredSamples,
  getSampleListOrder,
  listSampleIds,
  sampleFacets,
  setSampleListOrder,
  type SampleFacets,
  type SampleListQuery,
} from "../local-api/index.js";
import { glDialog } from "../dialog.js";
import { glIcon } from "../icon.js";
import type { MoreMenuEntry } from "../more-menu.js";
import { chromeMore, renderMoreMenu } from "../more-menu.js";
import { renderSamplePlayButton } from "../sample-play-button.js";
import { tip } from "../tip.js";
import { patchSampleInQueue } from "../sample-queue-patch.js";
import { SAMPLES_CULLED_EVENT } from "../sample-interest-cull.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "../modal-layout.js";
import "../pop-select.js";
import "../sample-info.js";
import "@supersoniks/concorde/checkbox";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/queue";
import "@supersoniks/concorde/table";
import "@supersoniks/concorde/table-tbody";
import "@supersoniks/concorde/table-tr";
import "@supersoniks/concorde/table-td";


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
      /* sonic-queue forces display:block — stay in table flow */
      sonic-queue.table-queue {
        display: contents !important;
      }
    `,
  ];

  @state() private projectId = "";
  @state() private facets: SampleFacets = { sessions: [], tags: [] };
  /** Stay false until project + filters are ready — avoids sonic-queue double fetch. */
  @state() private queueMounted = false;

  @subscribe(libraryFiltersKey.classFilter)
  @state()
  classFilter: SampleClass | "all" | null = "all";

  /** sessionId or "" for all */
  @subscribe(libraryFiltersKey.sessionFilter)
  @state()
  sessionFilter = "";

  @subscribe(libraryFiltersKey.tagFilter)
  @state()
  tagFilter: string[] = [];

  @subscribe(libraryFiltersKey.q)
  @state()
  captureQuery = "";

  @subscribe(libraryFiltersKey.semantic)
  @state()
  semantic: "" | "1" = "";

  @subscribe(libraryQueueKey.lastFetchedData.total)
  @state()
  listTotal = 0;

  @state() private selected = new Set<string>();
  @state() private sieve = false;
  @state() private sieveIndex = 0;
  @state() private sieveIds: string[] = [];
  @state() private sieveSample: Sample | null = null;
  @state() private playingId: string | null = null;
  @state() private batchBusy = false;
  @state() private separatingId: string | null = null;
  @state() private separateProgress = "";
  @state() private clapBusy = false;
  @state() private clapStatus = "";
  @state() private infoId: string | null = null;
  @state() private filtersModalOpen = false;
  #clapTimer: number | null = null;
  /** Keep status visible while similar / backfill owns the run. */
  #clapOp = false;

  #pointerStartX = 0;
  #pointerStartY = 0;
  #engine: TransportEngine | null = null;
  #lastTapAt = 0;
  #lastTapId: string | null = null;
  #unsubDemucs: (() => void) | null = null;
  #unsubDenoise: (() => void) | null = null;
  #demucsWaveActive = false;
  #denoiseWaveActive = false;

  override connectedCallback(): void {
    super.connectedCallback();
    setSampleListOrder(null);
    set(libraryFiltersKey, {
      classFilter: "all",
      sessionFilter: "",
      tagFilter: [],
      q: "",
      semantic: "",
    });
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    window.addEventListener(SAMPLE_UPDATED_EVENT, this.#onSampleRowPatch);
    window.addEventListener(SAMPLE_ML_EVENT, this.#onSampleEvolved);
    window.addEventListener(SAMPLE_STEMS_EVENT, this.#onSampleEvolved);
    window.addEventListener(SAMPLE_DENOISE_EVENT, this.#onSampleEvolved);
    window.addEventListener(SAMPLE_CLAP_EVENT, this.#onSampleEvolved);
    window.addEventListener(SAMPLES_CULLED_EVENT, this.#onSamplesCulled);
    window.addEventListener(CLAP_STATUS_EVENT, this.#onClapStatus);
    window.addEventListener(DEMUCS_QUEUE_EVENT, this.#onDemucsQueue);
    window.addEventListener(DENOISE_QUEUE_EVENT, this.#onDenoiseQueue);
    void this.#reload();
    this.#unsubDemucs = demucsQueue.subscribe((s) => this.#applyDemucsSnap(s));
    this.#unsubDenoise = denoiseQueue.subscribe((s) => this.#applyDenoiseSnap(s));
  }

  override disconnectedCallback(): void {
    chromeMore.clear();
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    window.removeEventListener(SAMPLE_UPDATED_EVENT, this.#onSampleRowPatch);
    window.removeEventListener(SAMPLE_ML_EVENT, this.#onSampleEvolved);
    window.removeEventListener(SAMPLE_STEMS_EVENT, this.#onSampleEvolved);
    window.removeEventListener(SAMPLE_DENOISE_EVENT, this.#onSampleEvolved);
    window.removeEventListener(SAMPLE_CLAP_EVENT, this.#onSampleEvolved);
    window.removeEventListener(SAMPLES_CULLED_EVENT, this.#onSamplesCulled);
    window.removeEventListener(CLAP_STATUS_EVENT, this.#onClapStatus);
    window.removeEventListener(DEMUCS_QUEUE_EVENT, this.#onDemucsQueue);
    window.removeEventListener(DENOISE_QUEUE_EVENT, this.#onDenoiseQueue);
    if (this.#clapTimer != null) window.clearTimeout(this.#clapTimer);
    this.#unsubDemucs?.();
    this.#unsubDenoise?.();
    this.#engine?.stop();
    super.disconnectedCallback();
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("captureQuery")) {
      this.#scheduleClapSearch();
    }
    this.#syncChromeMore();
  }

  #filterQuery(extra?: Partial<SampleListQuery>): SampleListQuery {
    return {
      projectId: this.projectId || undefined,
      sessionId: this.sessionFilter || undefined,
      classFilter: this.classFilter ?? undefined,
      tagFilter: this.tagFilter,
      q: this.captureQuery,
      orderIds: this.semantic === "1" ? getSampleListOrder() : null,
      ...extra,
    };
  }

  #batchMoreItems(): MoreMenuEntry[] {
    const selectedCount = this.selected.size;
    const noSel = selectedCount === 0 || this.batchBusy;
    const noExport = this.listTotal === 0 || this.batchBusy;
    const batchItems: MoreMenuEntry[] = [
      {
        label: t("library.import"),
        icon: "upload",
        disabled: this.batchBusy,
        onClick: () =>
          this.renderRoot
            .querySelector<HTMLInputElement>("#import-audio")
            ?.click(),
      },
      "divider",
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
        label: t("library.batchSeparate"),
        icon: "layers",
        disabled: noSel,
        onClick: () => void this.#batchSeparate(),
      },
      {
        label: t("library.batchRemoveVocals"),
        icon: "mic-off",
        disabled: noSel,
        onClick: () => void this.#batchRemoveVocals(),
      },
      {
        label: t("library.batchDenoise"),
        icon: "audio-lines",
        disabled: noSel,
        onClick: () => void this.#batchDenoise(),
      },
      {
        label: t("library.batchAutoCrop"),
        icon: "crop",
        disabled: noSel,
        onClick: () => void this.#batchAutoCrop(),
      },
      {
        label: t("library.batchAnalyze"),
        icon: "activity",
        disabled: noSel,
        onClick: () => void this.#batchAnalyze(),
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
    return batchItems;
  }

  #syncChromeMore(): void {
    if (!this.isConnected) return;
    chromeMore.set({
      ariaLabel: t("library.batchMore"),
      items: this.#batchMoreItems(),
    });
  }

  #onSampleRowPatch = (ev: Event): void => {
    const sampleId = (ev as CustomEvent<{ sampleId?: string }>).detail?.sampleId;
    if (!sampleId) return;
    void patchSampleInQueue(libraryQueueKey.path, sampleId);
  };

  /** ML / stems — patch one row; full reload when new child samples appear. */
  #onSampleEvolved = (ev: Event): void => {
    const d = (ev as CustomEvent<{ sampleId?: string; childIds?: string[] }>)
      .detail;
    if (d?.childIds?.length) {
      void this.#reload();
      return;
    }
    if (d?.sampleId) {
      void patchSampleInQueue(libraryQueueKey.path, d.sampleId);
      return;
    }
    void this.#reload();
  };

  #onSamplesCulled = (): void => {
    void this.#reload();
  };

  #onProjectChange = (): void => {
    set(libraryFiltersKey.sessionFilter, "");
    set(libraryFiltersKey.tagFilter, []);
    setSampleListOrder(null);
    set(libraryFiltersKey.semantic, "");
    void this.#reload();
  };

  #onDemucsQueue = (ev: Event): void => {
    const d = (ev as CustomEvent<DemucsQueueSnapshot>).detail;
    if (d) this.#applyDemucsSnap(d);
  };

  #onDenoiseQueue = (ev: Event): void => {
    const d = (ev as CustomEvent<DenoiseQueueSnapshot>).detail;
    if (d) this.#applyDenoiseSnap(d);
  };

  #applyDemucsSnap(s: DemucsQueueSnapshot): void {
    const active = s.remaining > 0 || s.phase !== "idle";
    if (active) this.#demucsWaveActive = true;
    this.separatingId = s.currentSampleId;
    if (!active) {
      if (this.#demucsWaveActive && s.waveTotal > 0) {
        this.#demucsWaveActive = false;
        void glDialog.alert(
          tf("library.separateBatchDone", {
            ok: s.ok,
            skipped: s.skipped,
            failed: s.failed,
          }),
        );
        void this.#reload();
      }
      if (!this.#denoiseWaveActive) this.separateProgress = "";
      return;
    }
    const i = Math.min(s.waveDone + 1, Math.max(1, s.waveTotal));
    const pct = Math.round(s.ratio * 100);
    const label =
      s.phase === "loading"
        ? `${t("library.separateLoading")} ${pct}%`
        : `${t(
            s.currentMode === "novocals"
              ? "library.removeVocalsWorking"
              : "library.separating",
          )} ${pct}%`;
    this.separateProgress = tf("library.separateBatchProgress", {
      i,
      n: s.waveTotal,
      label,
    });
  }

  #applyDenoiseSnap(s: DenoiseQueueSnapshot): void {
    const active = s.remaining > 0 || s.phase !== "idle";
    if (active) this.#denoiseWaveActive = true;
    if (active) this.separatingId = s.currentSampleId;
    if (!active) {
      if (this.#denoiseWaveActive && s.waveTotal > 0) {
        this.#denoiseWaveActive = false;
        void glDialog.alert(
          tf("library.denoiseBatchDone", {
            ok: s.ok,
            skipped: s.skipped,
            failed: s.failed,
          }),
        );
        void this.#reload();
      }
      if (!this.#demucsWaveActive) this.separateProgress = "";
      return;
    }
    const i = Math.min(s.waveDone + 1, Math.max(1, s.waveTotal));
    const pct = Math.round(s.ratio * 100);
    const label =
      s.phase === "loading"
        ? `${t("library.denoiseLoading")} ${pct}%`
        : `${t("library.denoiseWorking")} ${pct}%`;
    this.separateProgress = tf("library.separateBatchProgress", {
      i,
      n: s.waveTotal,
      label,
    });
  }

  #onClapStatus = (ev: Event): void => {
    const d = (ev as CustomEvent<ClapStatusDetail>).detail;
    if (!d) return;
    if (d.phase === "idle") {
      if (!this.#clapOp) {
        this.clapStatus = "";
        this.clapBusy = false;
      }
      return;
    }
    this.clapBusy = true;
    const pct =
      d.ratio != null ? ` ${Math.round(d.ratio * 100)}%` : "";
    const extra = d.message ? ` · ${d.message}` : "";
    if (d.phase === "loading-model") {
      this.clapStatus = `${t("library.clapLoadingModel")}${pct}${extra}`;
    } else if (d.phase === "embedding") {
      this.clapStatus = `${t("library.clapEmbedding")}${pct}${extra}`;
    } else if (d.phase === "searching") {
      this.clapStatus = `${t("library.clapSearching")}${pct}${extra}`;
    } else if (d.phase === "error") {
      this.clapStatus = d.message ?? t("library.similarNone");
      this.clapBusy = false;
    }
  };

  #scheduleClapSearch(): void {
    if (this.#clapTimer != null) window.clearTimeout(this.#clapTimer);
    this.#clapTimer = window.setTimeout(() => {
      this.#clapTimer = null;
      void this.#runClapSearch();
    }, 400);
  }

  async #runClapSearch(): Promise<void> {
    const q = this.captureQuery.trim();
    if (q.length < 3) {
      setSampleListOrder(null);
      if (this.semantic) set(libraryFiltersKey.semantic, "");
      return;
    }
    const prefs = await ensurePrefs();
    if (prefs.mlClap !== true) {
      setSampleListOrder(null);
      if (this.semantic) set(libraryFiltersKey.semantic, "");
      return;
    }
    this.clapBusy = true;
    try {
      const poolIds = await listSampleIds({
        projectId: this.projectId || undefined,
      });
      const ranked = await rankLibraryByText(q, poolIds);
      if (ranked.length > 0) {
        setSampleListOrder(ranked.map((r) => r.id));
        set(libraryFiltersKey.semantic, "1");
      } else {
        setSampleListOrder(null);
        set(libraryFiltersKey.semantic, "");
      }
    } catch {
      setSampleListOrder(null);
      set(libraryFiltersKey.semantic, "");
    } finally {
      this.clapBusy = false;
    }
  }

  get #sessionOptions(): { id: string; label: string; count: number }[] {
    return this.facets.sessions;
  }

  get #tagOptions(): { value: string; label: string }[] {
    return this.facets.tags;
  }

  /** Active class / session / tag filters (search query excluded). */
  #filterCount(): number {
    let n = 0;
    if (this.classFilter && this.classFilter !== "all") n += 1;
    if (this.sessionFilter) n += 1;
    n += this.tagFilter.length;
    return n;
  }

  #filterCaption(): string {
    const parts: string[] = [];
    if (this.classFilter && this.classFilter !== "all") {
      parts.push(this.classFilter);
    }
    if (this.sessionFilter) {
      const sess = this.#sessionOptions.find(
        (o) => o.id === this.sessionFilter,
      );
      parts.push(sess?.label ?? this.sessionFilter.slice(0, 8));
    }
    if (this.tagFilter.length > 0) {
      parts.push(this.tagFilter.join(", "));
    }
    return parts.join(" · ");
  }

  #renderFilterModal() {
    const classActive = !!(this.classFilter && this.classFilter !== "all");
    const filtersActive =
      classActive || !!this.sessionFilter || this.tagFilter.length > 0;
    const m = GL_MODAL_PRESETS.form;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.filtersModalOpen}
        @hide=${() => {
          this.filtersModalOpen = false;
        }}
      >
        <sonic-modal-title>${t("library.filters")}</sonic-modal-title>
        <sonic-modal-content>
          <sonic-form-layout>
            <gl-pop-select
              class="w-full max-w-full"
              size="sm"
              label=${t("library.filterClass")}
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
              class="w-full max-w-full"
              size="sm"
              label=${t("library.filterSession")}
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
              class="w-full max-w-full"
              size="sm"
              multiple
              label=${t("library.filterTag")}
              .values=${this.tagFilter}
              .options=${[
                { value: "", label: t("library.allTags") },
                ...this.#tagOptions,
              ]}
              placeholder=${t("library.allTags")}
              searchPlaceholder=${t("library.popSearch")}
              ?active=${this.tagFilter.length > 0}
              @gl-change=${(e: CustomEvent<{ values: string[] }>) => {
                set(libraryFiltersKey.tagFilter, e.detail.values);
                this.selected = new Set();
              }}
            ></gl-pop-select>
          </sonic-form-layout>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button
            variant="outline"
            type="neutral"
            ?disabled=${!filtersActive}
            @click=${this.#resetFilters}
            >${t("library.resetFilters")}</sonic-button
          >
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #resetFilters = (): void => {
    set(libraryFiltersKey.classFilter, "all");
    set(libraryFiltersKey.sessionFilter, "");
    set(libraryFiltersKey.tagFilter, []);
    setSampleListOrder(null);
    set(libraryFiltersKey.semantic, "");
    this.selected = new Set();
  };

  #renderSampleRow = (s: Sample) => {
    const isSel = this.selected.has(s.id);
    const playing = this.playingId === s.id;
    return html`
      <sonic-tr type=${playing ? "info" : nothing}>
        <sonic-td width="2.5rem" vAlign="middle" align="center">
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
        </sonic-td>
        <sonic-td
          minWidth="12rem"
          vAlign="middle"
          @click=${() => void this.#onRowClick(s)}
        >
          ${tip(
            t("library.rowHint"),
            html`
              <div>${s.userName ?? s.name}</div>
              <div class="font-mono text-xs text-neutral-500">
                ${s.captureName ? `${s.captureName} · ` : ""}${s.class}
                · ${s.durationMs}ms
                ${s.loopProposed ? " · boucle" : ""}${
                  isProcessingBusy(s.tags)
                    ? ` · ${t("library.processing")}`
                    : isProcessingError(s.tags)
                      ? ` · ${t("library.processingError")}`
                      : ""
                }
                ${(s.tags ?? []).length
                  ? ` · ${(s.tags ?? []).slice(0, 3).join(", ")}`
                  : ""}
              </div>
            `,
            { class: "w-full max-w-full justify-start text-left", focusable: true },
          )}
        </sonic-td>
        <sonic-td
          width="2.5rem"
          align="center"
          vAlign="middle"
          @click=${(e: Event) => e.stopPropagation()}
        >
          ${renderSamplePlayButton({
            playing,
            onClick: () => void this.#audition(s),
          })}
        </sonic-td>
        <sonic-td
          width="2.5rem"
          align="right"
          vAlign="middle"
          @click=${(e: Event) => e.stopPropagation()}
        >
          ${renderMoreMenu({
            ariaLabel: t("library.more"),
            size: "sm",
            icon: "horizontal",
            items: [
              {
                label: t("sample.info"),
                icon: "info",
                onClick: () => {
                  this.infoId = s.id;
                },
              },
              {
                label: s.favorite ? t("library.unfav") : t("library.fav"),
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
                label: t("library.similar"),
                icon: "audio-lines",
                onClick: () => void this.#similar(s),
              },
              {
                label: t("library.separate"),
                icon: "layers",
                onClick: () => void this.#separate(s),
              },
              {
                label: t("library.removeVocals"),
                icon: "mic-off",
                onClick: () => void this.#removeVocals(s),
              },
              {
                label: t("library.denoise"),
                icon: "audio-lines",
                onClick: () => void this.#denoise(s),
              },
              {
                label: t("library.analyze"),
                icon: "activity",
                onClick: () => void processQueue.reanalyzeSample(s.id),
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
        </sonic-td>
      </sonic-tr>
    `;
  };

  #noSampleItems = () => html`
    <sonic-tr>
      <sonic-td .colSpan=${4}>${t("library.empty")}</sonic-td>
    </sonic-tr>
  `;

  override render() {
    const selectedCount = this.selected.size;
    const allFilteredSelected =
      this.listTotal > 0 &&
      selectedCount >= this.listTotal &&
      this.listTotal > 0;
    const filterCaption = this.#filterCaption();
    const filterCount = this.#filterCount();
    const filtersActive = filterCount > 0;
    const endpoint = this.projectId
      ? `samples?projectId=${encodeURIComponent(this.projectId)}&offset=$offset&limit=$limit`
      : "";

    return html`
      <div
        class="mb-3 flex flex-nowrap items-center gap-2"
        formDataProvider=${libraryFiltersKey.path}
        dataFilterProvider=${libraryFiltersKey.path}
      >
        <sonic-input
          class="capture-q min-w-0 flex-1"
          name="q"
          type="search"
          size="sm"
          inlineContent
          placeholder=${t("library.search")}
          title=${t("library.semanticHint")}
        >
          ${glIcon("search", { slot: "prefix", size: "sm" })}
        </sonic-input>
        <div class="relative inline-block shrink-0 overflow-visible p-1 -m-1">
          ${tip(
            filterCaption || t("library.filters"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type=${filtersActive ? "primary" : "neutral"}
                size="sm"
                icon
                ?active=${filtersActive}
                data-aria-label=${t("library.filters")}
                @click=${() => {
                  this.filtersModalOpen = true;
                }}
              >
                ${glIcon("filter", { size: "sm" })}
              </sonic-button>
            `,
          )}
          ${filterCount > 0
            ? html`<sonic-badge
                type="danger"
                size="2xs"
                class="pointer-events-none absolute right-1 bottom-1 z-[1] translate-x-1/2 translate-y-1/2 transform"
                >${filterCount}</sonic-badge
              >`
            : nothing}
        </div>
        ${this.#renderFilterModal()}
        <input
          id="import-audio"
          class="sr-only"
          type="file"
          accept=".wav,.wave,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3"
          multiple
          @change=${(e: Event) => void this.#onImportFiles(e)}
        />
      </div>

      ${this.separateProgress
        ? html`<sonic-alert
            class="mb-3"
            status="info"
            label=${this.separateProgress}
          ></sonic-alert>`
        : nothing}
      ${this.clapBusy || this.clapStatus
        ? html`<p class="mb-2 font-mono text-[0.7rem] text-neutral-500">
            ${this.clapStatus || t("library.similarBusy")}
          </p>`
        : nothing}

      <div class="flex flex-col gap-1.5">
        <sonic-checkbox
          class="text-xs text-neutral-500"
          size="sm"
          checksAll
          title=${filterCaption || t("library.selectAll")}
          .checked=${allFilteredSelected
            ? true
            : selectedCount > 0
              ? "indeterminate"
              : null}
          ?disabled=${!this.listTotal}
          @change=${() => void this.#toggleSelectAll()}
        >
          ${filterCaption ? html`${filterCaption} · ` : nothing}${soundCountLabel(
            this.listTotal,
          )}
        </sonic-checkbox>
        <sonic-table
          size="sm"
          bordered
          rounded
          maxHeight="calc(100dvh - 14rem)"
        >
          <sonic-tbody
            formDataProvider=${libraryFiltersKey.path}
            dataFilterProvider=${libraryFiltersKey.path}
          >
            ${this.queueMounted && endpoint
              ? html`
                  <sonic-queue
                    class="table-queue"
                    lazyload
                    dataProvider=${libraryQueueKey.path}
                    dataProviderExpression=${endpoint}
                    dataFilterProvider=${libraryFiltersKey.path}
                    key="data"
                    limit="15"
                    idKey="id"
                    .items=${this.#renderSampleRow}
                    .noItems=${this.#noSampleItems}
                  ></sonic-queue>
                `
              : nothing}
          </sonic-tbody>
        </sonic-table>
      </div>
      ${!this.sieve && this.listTotal > 0
        ? html`
            <div
              class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-20 rounded-full shadow-[0_4px_18px_color-mix(in_srgb,#000_35%,transparent)]"
            >
              ${tip(
                t("library.sieve"),
                html`
                  <sonic-button
                    shape="circle"
                    type="primary"
                    size="lg"
                    icon
                    data-aria-label=${t("library.sieve")}
                    @click=${() => void this.#openSieve()}
                  >
                    ${glIcon("move-horizontal", { size: "md" })}
                  </sonic-button>
                `,
              )}
            </div>
          `
        : nothing}
      ${this.sieve && this.sieveSample
        ? this.#renderSieve()
        : nothing}
      <gl-sample-info
        .sampleId=${this.infoId ?? ""}
        .visible=${this.infoId != null}
        @hide=${() => {
          this.infoId = null;
        }}
      ></gl-sample-info>
    `;
  }

  #toggleOne(id: string): void {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected = next;
  }

  async #toggleSelectAll(): Promise<void> {
    if (this.listTotal === 0) return;
    if (this.selected.size >= this.listTotal) {
      this.selected = new Set();
      return;
    }
    const ids = await listSampleIds(this.#filterQuery());
    this.selected = new Set(ids);
  }

  #selectedIds(): string[] {
    return [...this.selected];
  }

  async #samplesByIds(ids: string[]): Promise<Sample[]> {
    if (ids.length === 0) return [];
    const rows = await db.samples.bulkGet(ids);
    return rows.filter((s): s is Sample => !!s && !s.deletedAt);
  }

  async #openSieve(): Promise<void> {
    const ids = await listSampleIds(this.#filterQuery());
    if (ids.length === 0) return;
    this.sieveIds = ids;
    this.sieveIndex = 0;
    this.sieve = true;
    await this.#loadSieveSample();
  }

  async #loadSieveSample(): Promise<void> {
    const id = this.sieveIds[this.sieveIndex];
    if (!id) {
      this.sieveSample = null;
      return;
    }
    this.sieveSample = (await db.samples.get(id)) ?? null;
  }

  async #batchFavorite(favorite: boolean): Promise<void> {
    const ids = this.#selectedIds();
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
    const ids = this.#selectedIds();
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
    const ids = this.#selectedIds();
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
    if (!projectId) return;
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
    const ids = this.#selectedIds();
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
    const selectedIds = this.#selectedIds();
    const samples =
      selectedIds.length > 0
        ? await this.#samplesByIds(selectedIds)
        : await filteredSamples(this.#filterQuery());
    if (samples.length === 0) return;
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
      if (!project) return;
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

  async #onRowClick(s: Sample): Promise<void> {
    const now = performance.now();
    if (this.#lastTapId === s.id && now - this.#lastTapAt < 350) {
      clearEditorHandoff();
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
      clearEditorHandoff();
      navigate({ name: "sample", id: s.id });
      return;
    }
    const buf = interleavedToAudioBuffer(
      this.#engine.ctx,
      data.pcm,
      data.sampleRate,
      data.channelCount,
    );
    this.playingId = s.id;
    this.#engine.audition(buf, 5);
  }

  #renderSieve() {
    const s = this.sieveSample;
    if (!s) return nothing;
    return html`
      <div
        class="sieve fixed inset-0 z-30 flex touch-none flex-col items-center justify-center bg-neutral-0 p-6"
        @pointerdown=${(e: PointerEvent) => {
          this.#pointerStartX = e.clientX;
          this.#pointerStartY = e.clientY;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        @pointerup=${(e: PointerEvent) => void this.#sieveGesture(e)}
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

  #publishLibraryFilters(): void {
    set(libraryFiltersKey, {
      classFilter: this.classFilter ?? "all",
      sessionFilter: this.sessionFilter,
      tagFilter: [...this.tagFilter],
      q: this.captureQuery,
      semantic: this.semantic,
    });
  }

  async #reload(): Promise<void> {
    // Unmount first so assigning projectId cannot mount the queue mid-await.
    this.queueMounted = false;
    await this.updateComplete;

    const projectId = await projectWorkspace.currentId();
    if (!projectId) {
      this.projectId = "";
      this.facets = { sessions: [], tags: [] };
      this.selected = new Set();
      return;
    }
    this.projectId = projectId;
    this.facets = await sampleFacets(projectId);
    const alive = new Set(await listSampleIds({ projectId }));
    this.selected = new Set([...this.selected].filter((id) => alive.has(id)));

    // Settle filters (and form writers) while the queue is still absent.
    this.#publishLibraryFilters();
    await this.updateComplete;

    this.queueMounted = true;
    await this.updateComplete;
    // sonic-queue only loads on filter mutation after connect — one publish.
    this.#publishLibraryFilters();
  }

  async #sieveGesture(e: PointerEvent): Promise<void> {
    const dx = e.clientX - this.#pointerStartX;
    const dy = e.clientY - this.#pointerStartY;
    const s = this.sieveSample;
    if (!s) return;
    if (Math.hypot(dx, dy) < 24) {
      await this.#audition(s);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        await deleteSample(s.id);
        this.sieveIds = this.sieveIds.filter((id) => id !== s.id);
        if (this.sieveIndex >= this.sieveIds.length) {
          this.sieveIndex = Math.max(0, this.sieveIds.length - 1);
        }
      } else {
        this.sieveIndex = Math.min(
          this.sieveIndex + 1,
          Math.max(0, this.sieveIds.length - 1),
        );
      }
    } else if (dy < 0) {
      await toggleFavorite(s.id);
      this.sieveIndex = Math.min(
        this.sieveIndex + 1,
        Math.max(0, this.sieveIds.length - 1),
      );
    }
    if (this.sieveIds.length === 0) {
      this.sieve = false;
      this.sieveSample = null;
      await this.#reload();
      return;
    }
    await this.#loadSieveSample();
    if (this.sieveIndex >= this.sieveIds.length - 1 && dx >= 0 && dy >= 0) {
      /* keep last */
    }
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

  async #similar(s: Sample): Promise<void> {
    if (!isClapAudioReady()) {
      const prefs = await ensurePrefs();
      if (prefs.mlClap !== true) {
        const ok = await glDialog.confirm({
          title: t("library.similar"),
          message: t("library.similarConfirm"),
        });
        if (!ok) return;
      }
    }
    this.#clapOp = true;
    this.clapBusy = true;
    this.clapStatus = t("library.clapLoadingModel");
    try {
      const poolIds = await listSampleIds({
        projectId: this.projectId || undefined,
      });
      const ranked = await rankSimilarSamples(s.id, poolIds);
      if (ranked.length === 0) {
        await glDialog.alert(t("library.similarEmpty"));
        return;
      }
      this.clapBusy = false;
      this.clapStatus = "";
      const rows = await this.#samplesByIds(ranked.map((r) => r.id));
      const byId = new Map(rows.map((x) => [x.id, x]));
      const picked = await glDialog.chooseMany({
        title: t("library.similarTitle"),
        message: t("library.similarPickHint"),
        confirmLabel: t("library.similarSelect"),
        options: ranked.map((r) => {
          const row = byId.get(r.id);
          const name = row?.userName ?? row?.name ?? r.id.slice(0, 8);
          return {
            value: r.id,
            label: `${Math.round(r.score * 100)}% — ${name}`,
          };
        }),
      });
      if (picked == null) return;
      this.selected = new Set(picked);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await glDialog.alert(`${t("library.similarFailed")}: ${detail}`);
    } finally {
      this.#clapOp = false;
      this.clapBusy = false;
      this.clapStatus = "";
    }
  }

  #eligibleForSeparate(s: Sample): boolean {
    const tags = s.tags ?? [];
    if (tags.some((tag) => tag.startsWith("stem:"))) return false;
    if (tags.includes(ML_TAG.demucs) || tags.includes(ML_TAG.demucsRunning)) {
      return false;
    }
    return true;
  }

  #eligibleForRemoveVocals(s: Sample): boolean {
    const tags = s.tags ?? [];
    if (tags.some((tag) => tag.startsWith("stem:"))) return false;
    if (
      tags.includes(ML_TAG.novocals) ||
      tags.includes(ML_TAG.demucsRunning)
    ) {
      return false;
    }
    return true;
  }

  #eligibleForDenoise(s: Sample): boolean {
    const tags = s.tags ?? [];
    if (tags.includes(stemTag(DENOISED_STEM))) return false;
    if (tags.includes(ML_TAG.denoise) || tags.includes(ML_TAG.denoiseRunning)) {
      return false;
    }
    return true;
  }

  async #separate(s: Sample): Promise<void> {
    const tags = s.tags ?? [];
    if (tags.some((tag) => tag.startsWith("stem:"))) {
      await glDialog.alert(t("library.separateSkipStem"));
      return;
    }
    if (tags.includes(ML_TAG.demucs) || tags.includes(ML_TAG.demucsRunning)) {
      await glDialog.alert(t("library.separateAlready"));
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.separate"),
      message: t("library.separateConfirm"),
    });
    if (!ok) return;
    enqueueDemucsSeparate(s.id);
  }

  async #removeVocals(s: Sample): Promise<void> {
    const tags = s.tags ?? [];
    if (tags.some((tag) => tag.startsWith("stem:"))) {
      await glDialog.alert(t("library.separateSkipStem"));
      return;
    }
    if (tags.includes(ML_TAG.novocals) || tags.includes(ML_TAG.demucsRunning)) {
      await glDialog.alert(t("library.removeVocalsAlready"));
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.removeVocals"),
      message: t("library.removeVocalsConfirm"),
    });
    if (!ok) return;
    enqueueDemucsRemoveVocals(s.id);
  }

  async #batchSeparate(): Promise<void> {
    const ids = this.#selectedIds();
    if (ids.length === 0) return;
    const rows = await this.#samplesByIds(ids);
    const eligible = rows
      .filter((s) => this.#eligibleForSeparate(s))
      .map((s) => s.id);
    if (eligible.length === 0) {
      await glDialog.alert(t("library.separateNoneEligible"));
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.batchSeparate"),
      message: tf("library.separateBatchConfirm", { n: eligible.length }),
    });
    if (!ok) return;
    enqueueDemucsSeparate(eligible);
  }

  async #batchRemoveVocals(): Promise<void> {
    const ids = this.#selectedIds();
    if (ids.length === 0) return;
    const rows = await this.#samplesByIds(ids);
    const eligible = rows
      .filter((s) => this.#eligibleForRemoveVocals(s))
      .map((s) => s.id);
    if (eligible.length === 0) {
      await glDialog.alert(t("library.removeVocalsNoneEligible"));
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.batchRemoveVocals"),
      message: tf("library.removeVocalsBatchConfirm", { n: eligible.length }),
    });
    if (!ok) return;
    enqueueDemucsRemoveVocals(eligible);
  }

  async #denoise(s: Sample): Promise<void> {
    if (!this.#eligibleForDenoise(s)) {
      await glDialog.alert(
        (s.tags ?? []).includes(stemTag(DENOISED_STEM))
          ? t("library.denoiseSkipChild")
          : t("library.denoiseAlready"),
      );
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.denoise"),
      message: t("library.denoiseConfirm"),
    });
    if (!ok) return;
    enqueueDenoise(s.id);
  }

  async #batchDenoise(): Promise<void> {
    const ids = this.#selectedIds();
    if (ids.length === 0) return;
    const rows = await this.#samplesByIds(ids);
    const eligible = rows
      .filter((s) => this.#eligibleForDenoise(s))
      .map((s) => s.id);
    if (eligible.length === 0) {
      await glDialog.alert(t("library.denoiseNoneEligible"));
      return;
    }
    const ok = await glDialog.confirm({
      title: t("library.batchDenoise"),
      message: tf("library.denoiseBatchConfirm", { n: eligible.length }),
    });
    if (!ok) return;
    enqueueDenoise(eligible);
  }

  async #batchAnalyze(): Promise<void> {
    const ids = this.#selectedIds();
    if (ids.length === 0) return;
    const ok = await glDialog.confirm({
      title: t("library.batchAnalyze"),
      message: tf("library.analyzeConfirm", { n: ids.length }),
    });
    if (!ok) return;
    this.batchBusy = true;
    try {
      await processQueue.reanalyzeSamples(ids);
      await this.#reload();
    } finally {
      this.batchBusy = false;
    }
  }

  async #batchAutoCrop(): Promise<void> {
    const ids = this.#selectedIds();
    if (ids.length === 0) return;
    this.batchBusy = true;
    try {
      const { cropped, skipped } = await autoCropSamples(ids);
      await this.#reload();
      await glDialog.alert(
        tf("library.batchAutoCropDone", { cropped, skipped }),
      );
    } finally {
      this.batchBusy = false;
    }
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
