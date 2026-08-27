import {
  createEntityId,
  nowIso,
  type Sample,
  type Session,
} from "@glane/core-model";
import {
  LiveCapture,
  sampleOpfs,
  type LevelMeter,
} from "@glane/audio-io";
import {
  EventHunter,
  DSP_THRESHOLDS,
  computeInterestScore,
  durationMsFromPcm,
  interleavedToAudioBuffer,
  runProcessJob,
  sliceFrames,
  songSlice,
  toMonoPcm,
  type CaptureLiveState,
  type ClipCharacterization,
  type TempoEstimate,
} from "@glane/audio-dsp";
import { TransportEngine } from "@glane/audio-engine";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import {
  db,
  ensurePrefs,
  DEFAULT_ATTACK_SENSITIVITY,
  DEFAULT_TARGET_CAPTURES_PER_MIN,
  type FileProcessMode,
} from "../db.js";
import {
  clampClapLimit,
  clampClapMinScore,
  clampYamnetMaxLabels,
  clampYamnetMinScore,
  ML_DEFAULTS,
  resolveDemucsStems,
} from "../ml/ml-prefs.js";
import {
  CLAP_STATUS_EVENT,
  backfillClapEmbeddings,
  type ClapStatusDetail,
} from "../ml/clap-queue.js";
import { DEMUCS_STEMS, type DemucsStemName } from "@glane/audio-ml";
import {
  CAPTURE_RATE,
  clampTargetPerMin,
  nextSensitivity,
  pruneCaptureTimes,
} from "../capture-rate-regulator.js";
import {
  SLICE_DURATION,
  durationPassesSliceFilter,
  parseOptionalDurationMs,
  resolveSliceDurationFilter,
} from "../slice-duration.js";
import { soundCountLabel, t, tf } from "../i18n/messages.js";
import { navigate } from "../router.js";
import {
  decodeAudioFileToPcm,
  deleteSample,
  isImportableAudio,
} from "../sample-actions.js";
import { importForHunt, ImportTempoError } from "../import-for-hunt.js";
import {
  slicePreview,
  type SlicePreviewHit,
  type SlicePreviewRegion,
  type SlicePreviewResult,
} from "../slice-preview.js";
import {
  isProcessingBusy,
  isProcessingError,
  processQueue,
  SAMPLE_UPDATED_EVENT,
} from "../process-queue.js";
import { patchSampleInQueue } from "../sample-queue-patch.js";
import { buildAutoSampleName } from "../sample-auto-name.js";
import { SAMPLES_CULLED_EVENT, cullExcessProcessedSamples } from "../sample-interest-cull.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { captureFormKey, captureFeedKey, captureQueueKey } from "../dp-keys.js";
import { glIcon } from "../icon.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import { chromeMore } from "../more-menu.js";
import { renderSamplePlayButton, setSampleAuditionPlaying, getSampleAuditionPlaying, clearSampleAudition } from "../sample-play-button.js";
import { tip } from "../tip.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "../modal-layout.js";
import "../pop-select.js";
import "../form-stack.js";
import "../timeline/slice-preview-wave.js";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/queue";
import "@supersoniks/concorde/table";
import "@supersoniks/concorde/table-tbody";
import "@supersoniks/concorde/table-tr";
import "@supersoniks/concorde/table-td";

type CaptureAlertStatus = "info" | "success" | "error" | "warning";

function songGridCaption(targetPerMin: number): string {
  const beats = songSlice.beatsPerSliceFromTarget(
    songSlice.referenceBpm,
    targetPerMin,
  );
  const g = songSlice.gridLabel(beats);
  if (g.kind === "beat") return t("capture.gridBeat");
  if (g.kind === "half-bar") return t("capture.gridHalfBar");
  if (g.kind === "bar") return t("capture.gridBar");
  return tf("capture.gridBars", { n: String(g.bars) });
}
type AudioInputOption = { value: string; label: string };

type FeedRow = {
  id: string;
  name?: string;
  userName?: string;
  class: Sample["class"];
  tags?: string[];
  loopProposed?: boolean;
  interestScore?: number;
};

/** Map internal sensitivity 0–100 → openFloorFactor (higher → lower factor). */
function sensitivityToOpenFloor(sensitivity: number): number {
  const { openFloorMin, openFloorMax } = DSP_THRESHOLDS.live;
  const s = Math.min(100, Math.max(0, sensitivity));
  return openFloorMax - (s / 100) * (openFloorMax - openFloorMin);
}

@customElement("gl-capture-page")
export class GlCapturePage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem 1rem 1.25rem;
        padding-left: max(1rem, env(safe-area-inset-left));
        padding-right: max(1rem, env(safe-area-inset-right));
        padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
        box-sizing: border-box;
        max-width: 100%;
        overflow-x: hidden;
        min-height: 100%;
      }
      .feed {
        flex: 1 1 auto;
        min-height: 8rem;
        max-height: min(48vh, 26rem);
        overflow: auto;
        overscroll-behavior: contain;
      }
      .rec-wrap sonic-button {
        --sc-btn-height: 4.5rem;
        --sc-_fs: 1.5rem;
      }
      /* Circle + icon-only: Concorde main-slot grows / icon baseline shifts. */
      .rec-wrap sonic-button::part(button) {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      .rec-wrap sonic-button::part(main) {
        flex-grow: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
      }
      .rec-wrap sonic-icon {
        line-height: 0;
        vertical-align: 0;
      }
      .capture-config-modal input[type="range"] {
        width: 100%;
        accent-color: var(--sc-primary, #3d7ea6);
      }
      .vu-track {
        position: relative;
        height: 0.75rem;
        border-radius: 3px;
        background: color-mix(in srgb, var(--gl-fg-muted) 22%, var(--gl-ink));
        overflow: hidden;
      }
      .vu-rms,
      .vu-peak {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        border-radius: 3px;
        max-width: 100%;
        transition: width 40ms linear;
      }
      .vu-rms {
        background: color-mix(in srgb, var(--gl-accent) 75%, transparent);
      }
      .vu-peak {
        width: 2px;
        background: var(--gl-fg);
        border-radius: 1px;
        transition: left 30ms linear;
      }
      .vu-track.hot .vu-rms {
        background: color-mix(in srgb, var(--gl-danger) 80%, var(--gl-accent));
      }
      .vu-track.hot .vu-peak {
        background: var(--gl-danger);
      }
      .economy {
        position: fixed;
        inset: 0;
        background: #000;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #333;
      }
      .economy .halo {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: radial-gradient(circle, #2a4 0%, #000 70%);
        opacity: 0.5;
      }
      sonic-queue.table-queue {
        display: contents !important;
      }
    `,
  ];

  /** Saving extractions to the library (mic button armed). */
  @state() private listening = false;
  /** Mic + hunter running (scout and/or recording). */
  @state() private micOpen = false;
  @state() private economy = false;
  @state() private level: LevelMeter = { rms: 0, peak: 0 };
  @state() private warnings: string[] = [];

  @subscribe(captureFormKey.captureName)
  @state()
  captureName = "";

  @state() private liveState: CaptureLiveState = "idle";
  @state() private feedProjectId = "";
  @state() private feedSessionId = "";
  @state() private queueMounted = true;

  @subscribe(captureQueueKey.lastFetchedData.total)
  @state()
  sampleCount = 0;

  @state() private clockMs = 0;
  @state() private statusText = "";
  @state() private autoGain = false;
  @state() private mlYamnet = true;
  @state() private mlClap = false;
  @state() private mlYamnetMinScore: number = ML_DEFAULTS.yamnetMinScore;
  @state() private mlYamnetMaxLabels: number = ML_DEFAULTS.yamnetMaxLabels;
  @state() private mlYamnetAutoClass = true;
  @state() private mlClapMinScore: number = ML_DEFAULTS.clapMinScore;
  @state() private mlClapLimit: number = ML_DEFAULTS.clapLimit;
  @state() private clapStatus = "";
  @state() private mlDemucsStems: DemucsStemName[] = [
    ...ML_DEFAULTS.demucsStems,
  ];
  /** Internal 0–100; auto-tuned toward targetCapturesPerMin. */
  @state() private attackSensitivity = DEFAULT_ATTACK_SENSITIVITY;
  @state() private targetCapturesPerMin = DEFAULT_TARGET_CAPTURES_PER_MIN;
  @state() private fileProcessMode: FileProcessMode = "hunt";
  /** null = DSP default. */
  @state() private sliceMinDurationMs: number | null = null;
  @state() private sliceMaxDurationMs: number | null = null;
  @state() private measuredRatePerMin = 0;
  @state() private configModalOpen = false;
  @state() private scoutBlocked = false;
  @state() private audioDeviceId = "";
  @state() private audioInputs: AudioInputOption[] = [];
  @state() private importBusy = false;
  @state() private importRatio = 0;
  @state() private importExtracted = 0;
  @state() private previewFileName = "";
  @state() private previewBusy = false;
  @state() private previewResult: SlicePreviewResult | null = null;
  @state() private previewSelected = -1;
  @state() private previewDetailBusy = false;
  @state() private previewDetailMono: Float32Array | null = null;
  @state() private previewDetailMeta: {
    durationMs: number;
    interestScore: number;
    tags: string[];
    class: string;
    kept: boolean;
    analysis: ClipCharacterization | null;
  } | null = null;

  #live: LiveCapture | null = null;
  #hunter: EventHunter | null = null;
  #hunt: Session | null = null;
  #engine: TransportEngine | null = null;
  #auditionGen = 0;
  #analyseTimer: number | null = null;
  #clockTimer: number | null = null;
  /** Absolute RollingPcmWindow cursor — gap-free EventHunter feed. */
  #pcmCursor = 0;
  /** Mic open epoch (scout or record) — rate regulator. */
  #micStartedAt = 0;
  /** Recording epoch — clock display. */
  #recordStartedAt = 0;
  #analysing = false;
  #stopping = false;
  #unsubProc: (() => void) | null = null;
  #captureTimes: number[] = [];
  #lastRateAdjustMs = 0;
  #scoutStarting = false;
  #importAbort: AbortController | null = null;
  #previewFile: File | null = null;
  #previewPcm: Float32Array | null = null;
  #previewMono: Float32Array | null = null;
  #previewSampleRate = 48_000;
  #previewChannelCount = 1;
  #previewHuntHits: SlicePreviewHit[] | null = null;
  #previewTempo: TempoEstimate | null = null;
  #previewOpenFloor: number | null = null;
  #previewDurationKey = "";
  #previewAbort: AbortController | null = null;
  #previewTimer: number | null = null;
  /** Lazy polish cache keyed by region index. */
  #previewProcessed = new Map<
    number,
    {
      pcm: Float32Array;
      mono: Float32Array;
      durationMs: number;
      interestScore: number;
      tags: string[];
      analysis: ClipCharacterization;
    }
  >();
  #previewSelectGen = 0;

  @handle(captureFormKey.autoGain)
  onAutoGainFromForm(v: "1" | null): void {
    const on = v === "1";
    if (on === this.autoGain) return;
    this.autoGain = on;
    this.#live?.setAutoGain(on);
    void this.#persistCapturePrefs();
  }

  #openConfigModal = (): void => {
    this.configModalOpen = true;
    void this.#refreshAudioInputs();
  };

  #syncChromeMore(): void {
    if (!this.isConnected) return;
    chromeMore.set({
      ariaLabel: t("capture.more"),
      items: [
        {
          label: t("capture.config"),
          icon: "settings",
          onClick: this.#openConfigModal,
        },
        "divider",
        {
          label: t("capture.economyAction"),
          icon: "moon",
          onClick: () => {
            this.economy = true;
          },
        },
        {
          label: t("capture.importFile"),
          icon: "upload",
          disabled: this.importBusy || this.listening,
          onClick: this.#pickImportFile,
        },
      ],
    });
  }

  #onConfigModalHide = (): void => {
    this.configModalOpen = false;
  };

  #onAutoGainChange = (e: Event): void => {
    const on = (e.target as HTMLInputElement).checked;
    if (on === this.autoGain) return;
    this.autoGain = on;
    this.#live?.setAutoGain(on);
    this.#syncCaptureForm();
    void this.#persistCapturePrefs();
  };

  #syncCaptureForm(): void {
    set(captureFormKey, {
      captureName: this.captureName,
      autoGain: this.autoGain ? "1" : null,
    });
  }

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    window.addEventListener(SAMPLES_CULLED_EVENT, this.#onSamplesCulled);
    window.addEventListener(CLAP_STATUS_EVENT, this.#onClapStatus);
    window.addEventListener(SAMPLE_UPDATED_EVENT, this.#onSampleRowPatch);
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      this.#onDeviceChange,
    );
    this.#unsubProc = processQueue.subscribe((s) => {
      if (s.currentSampleId) {
        void patchSampleInQueue(captureQueueKey.path, s.currentSampleId);
      }
    });
    await Promise.all([this.#loadLastCaptureName(), this.#loadCapturePrefs()]);
    this.#syncChromeMore();
    void this.#startScout();
  }

  override updated(): void {
    this.#syncChromeMore();
  }

  override disconnectedCallback(): void {
    chromeMore.clear();
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    window.removeEventListener(SAMPLES_CULLED_EVENT, this.#onSamplesCulled);
    window.removeEventListener(CLAP_STATUS_EVENT, this.#onClapStatus);
    window.removeEventListener(SAMPLE_UPDATED_EVENT, this.#onSampleRowPatch);
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.#onDeviceChange,
    );
    this.#unsubProc?.();
    this.#unsubProc = null;
    this.#importAbort?.abort();
    this.#importAbort = null;
    this.#previewAbort?.abort();
    this.#previewAbort = null;
    if (this.#previewTimer != null) window.clearTimeout(this.#previewTimer);
    this.#previewTimer = null;
    this.#engine?.stop();
    this.#engine = null;
    this.#auditionGen++;
    clearSampleAudition();
    void this.#shutdownMic();
    super.disconnectedCallback();
  }

  #captureStatusAlert(): {
    status: CaptureAlertStatus;
    label: string;
    text: string;
  } | null {
    if (this.warnings.length > 0) {
      return {
        status: "warning",
        label: "Attention",
        text: this.warnings[0] ?? "",
      };
    }
    if (this.importBusy) {
      return {
        status: "info",
        label: t("capture.importBusy"),
        text: "",
      };
    }
    if (this.listening || this.micOpen) {
      const live = stateLabel(this.liveState, this.listening);
      const hint = this.listening
        ? t("capture.hintRecording")
        : t("capture.hintScout");
      const statusExtra =
        this.statusText && !isLiveCaptureDeviceState(this.statusText)
          ? this.statusText
          : "";
      return {
        status: this.listening ? "error" : "info",
        label: this.listening ? t("capture.recording") : t("capture.scout"),
        text: live || statusExtra || hint,
      };
    }
    return {
      status: "info",
      label: this.scoutBlocked
        ? t("capture.hintScoutBlocked")
        : t("capture.empty"),
      text: "",
    };
  }

  #renderStatusSlot() {
    const alert = this.#captureStatusAlert();
    if (!alert) return nothing;
    return html`
      <div class="box-border min-w-0 shrink-0" aria-live="polite">
        <sonic-alert
          class="w-full min-w-0"
          size="xs"
          status=${alert.status}
          label=${alert.label}
          >${alert.text || nothing}</sonic-alert
        >
      </div>
    `;
  }

  #onSamplesCulled = (ev: Event): void => {
    const ids = (ev as CustomEvent<{ culledIds?: string[] }>).detail?.culledIds;
    if (!ids?.length) return;
    this.#bumpFeed();
  };

  #onSampleRowPatch = (ev: Event): void => {
    const sampleId = (ev as CustomEvent<{ sampleId?: string }>).detail?.sampleId;
    if (!sampleId) return;
    void patchSampleInQueue(captureQueueKey.path, sampleId);
  };

  #bumpFeed(): void {
    if (!this.feedSessionId) return;
    set(captureFeedKey.bump, String(Date.now()));
  }

  #bindFeed(sessionId: string, projectId: string): void {
    this.feedSessionId = sessionId;
    this.feedProjectId = projectId;
    set(captureFeedKey, {
      projectId,
      sessionId,
      bump: String(Date.now()),
    });
    void this.#remountFeed();
  }

  async #remountFeed(): Promise<void> {
    this.queueMounted = false;
    await this.updateComplete;
    this.queueMounted = true;
    await this.updateComplete;
    if (this.feedSessionId && this.feedProjectId) {
      set(captureFeedKey, {
        projectId: this.feedProjectId,
        sessionId: this.feedSessionId,
        bump: String(Date.now()),
      });
    }
  }

  #clearFeed(): void {
    this.feedSessionId = "";
    this.feedProjectId = "";
    set(captureFeedKey, { projectId: "", sessionId: "", bump: "" });
  }

  #onKey = (e: KeyboardEvent): void => {
    if (this.importBusy) return;
    if (!isSpaceKey(e) || shouldIgnoreShortcut(e) || this.configModalOpen) {
      return;
    }
    e.preventDefault();
    void this.#toggle();
  };

  #onDeviceChange = (): void => {
    if (this.configModalOpen) void this.#refreshAudioInputs();
  };

  #onProjectChange = (): void => {
    void this.#loadLastCaptureName();
  };

  async #loadCapturePrefs(): Promise<void> {
    const prefs = await ensurePrefs();
    this.autoGain = prefs.captureAutoGain ?? false;
    this.mlYamnet = prefs.mlYamnet !== false;
    this.mlClap = prefs.mlClap === true;
    this.mlYamnetMinScore = clampYamnetMinScore(prefs.mlYamnetMinScore);
    this.mlYamnetMaxLabels = clampYamnetMaxLabels(prefs.mlYamnetMaxLabels);
    this.mlYamnetAutoClass = prefs.mlYamnetAutoClass !== false;
    this.mlClapMinScore = clampClapMinScore(prefs.mlClapMinScore);
    this.mlClapLimit = clampClapLimit(prefs.mlClapLimit);
    this.mlDemucsStems = resolveDemucsStems(prefs.mlDemucsStems);
    this.attackSensitivity =
      prefs.attackSensitivity ?? DEFAULT_ATTACK_SENSITIVITY;
    this.targetCapturesPerMin = clampTargetPerMin(
      prefs.targetCapturesPerMin ?? DEFAULT_TARGET_CAPTURES_PER_MIN,
    );
    this.fileProcessMode = prefs.fileProcessMode ?? "hunt";
    this.sliceMinDurationMs = parseOptionalDurationMs(prefs.sliceMinDurationMs);
    this.sliceMaxDurationMs = parseOptionalDurationMs(prefs.sliceMaxDurationMs);
    this.audioDeviceId = prefs.captureAudioDeviceId ?? "";
    this.#syncCaptureForm();
  }

  async #persistCapturePrefs(): Promise<void> {
    const prefs = await ensurePrefs();
    await db.prefs.put({
      ...prefs,
      captureAutoGain: this.autoGain,
      mlYamnet: this.mlYamnet,
      mlClap: this.mlClap,
      mlYamnetMinScore: this.mlYamnetMinScore,
      mlYamnetMaxLabels: this.mlYamnetMaxLabels,
      mlYamnetAutoClass: this.mlYamnetAutoClass,
      mlClapMinScore: this.mlClapMinScore,
      mlClapLimit: this.mlClapLimit,
      mlDemucsStems: [...this.mlDemucsStems],
      attackSensitivity: this.attackSensitivity,
      targetCapturesPerMin: this.targetCapturesPerMin,
      fileProcessMode: this.fileProcessMode,
      sliceMinDurationMs: this.sliceMinDurationMs,
      sliceMaxDurationMs: this.sliceMaxDurationMs,
      captureAudioDeviceId: this.audioDeviceId || undefined,
    });
  }

  #applyHunterSensitivity(): void {
    this.#hunter?.setOpenFloorFactor(
      sensitivityToOpenFloor(this.attackSensitivity),
    );
  }

  #sliceLengthFilter() {
    return resolveSliceDurationFilter({
      minMs: this.sliceMinDurationMs,
      maxMs: this.sliceMaxDurationMs,
    });
  }

  #onTargetRateInput = (e: Event): void => {
    const v = Number((e.target as HTMLInputElement).value);
    this.targetCapturesPerMin = clampTargetPerMin(
      Number.isFinite(v) ? v : DEFAULT_TARGET_CAPTURES_PER_MIN,
    );
    this.#scheduleSlicePreview();
  };

  #onTargetRateChange = (e: Event): void => {
    this.#onTargetRateInput(e);
    void this.#persistCapturePrefs();
  };

  #regulateCaptureRate(nowMs: number): void {
    if (!this.micOpen || this.#micStartedAt <= 0) return;
    this.#captureTimes = pruneCaptureTimes(this.#captureTimes, nowMs);
    const next = nextSensitivity({
      sensitivity: this.attackSensitivity,
      targetPerMin: this.targetCapturesPerMin,
      timestamps: this.#captureTimes,
      nowMs,
      startedAtMs: this.#micStartedAt,
      lastAdjustMs: this.#lastRateAdjustMs,
    });
    this.measuredRatePerMin = next.ratePerMin;
    this.#lastRateAdjustMs = next.lastAdjustMs;
    if (!next.adjusted) return;
    this.attackSensitivity = next.sensitivity;
    this.#applyHunterSensitivity();
  }

  #noteDetection(nowMs: number): void {
    this.#captureTimes = pruneCaptureTimes(
      [...this.#captureTimes, nowMs],
      nowMs,
    );
    this.#regulateCaptureRate(nowMs);
  }

  async #loadLastCaptureName(): Promise<void> {
    const projectId = await projectWorkspace.currentId();
    if (!projectId) return;
    const last =
      (await db.sessions
        .orderBy("startedAt")
        .reverse()
        .filter((s) => s.projectId === projectId && !s.deletedAt)
        .first()) ?? null;
    if (last?.title) this.captureName = last.title;
    this.#syncCaptureForm();
  }

  override render() {
    const peak = this.level.peak;
    const rms = this.level.rms;
    const peakPct = Math.min(100, peak * 100);
    const rmsPct = Math.min(100, rms * 140);
    const peakDb = levelToDb(peak);
    const hot = peak > 0.9;

    return html`
      <input
        id="import-hunt-audio"
        class="sr-only"
        type="file"
        accept=".wav,.wave,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3"
        @change=${(e: Event) => void this.#onImportFile(e)}
      />
      <input
        id="slice-preview-audio"
        class="sr-only"
        type="file"
        accept=".wav,.wave,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3"
        @change=${(e: Event) => void this.#onPreviewFile(e)}
      />
      <div class="rec-wrap flex items-center justify-center py-2">
        ${tip(
          `${this.listening ? t("capture.stop") : t("capture.start")} (Espace)`,
          html`
            <sonic-button
              type=${this.listening ? "danger" : "primary"}
              shape="circle"
              size="2xl"
              icon
              ?disabled=${this.importBusy}
              data-aria-label=${this.listening
                ? t("capture.stop")
                : t("capture.start")}
              @click=${this.#toggle}
            >
              <span class="inline-flex items-center justify-center leading-none"
                >${glIcon(this.listening ? "square" : "mic", {
                  size: "lg",
                })}</span
              >
            </sonic-button>
          `,
        )}
      </div>
      <div class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="font-mono text-sm tabular-nums">${formatClock(this.clockMs)}</span>
            ${this.micOpen
              ? html`<span
                  class="font-mono text-[0.75rem] tabular-nums text-neutral-500"
                  >≈${formatRate(this.measuredRatePerMin)}</span
                >`
              : nothing}
          </div>
          ${this.micOpen
            ? html`<span
                class="font-mono text-[0.8rem] tabular-nums text-content ${hot
                  ? "text-danger"
                  : "text-neutral-500"}"
                >${peakDb}</span
              >`
            : nothing}
        </div>
        ${this.micOpen
          ? html`
              <div
                class="vu-track ${hot ? "hot" : ""}"
                role="meter"
                aria-label="Niveau micro"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow=${Math.round(peakPct)}
              >
                <i class="vu-rms" style="width:${rmsPct}%"></i>
                <i class="vu-peak" style="left:calc(${peakPct}% - 1px)"></i>
              </div>
            `
          : html`
              <div
                class="h-2 overflow-hidden rounded bg-neutral-100"
                role="meter"
                aria-label="Niveau micro"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow=${Math.round(peakPct)}
              >
                <i
                  class="block h-full ${hot ? "bg-danger" : "bg-primary"}"
                  style="width:${peakPct}%"
                ></i>
              </div>
            `}
      </div>
      ${this.#renderStatusSlot()}
      ${this.importBusy
        ? html`
            <div class="flex flex-col gap-2">
              <div
                class="h-2 overflow-hidden rounded bg-neutral-100"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow=${Math.round(this.importRatio * 100)}
                aria-label=${t("capture.importBusy")}
              >
                <i
                  class="block h-full bg-primary"
                  style="width:${Math.round(this.importRatio * 100)}%"
                ></i>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[0.8rem] text-neutral-500"
                  >${this.importExtracted} · ${Math.round(this.importRatio * 100)}%</span
                >
                <sonic-button
                  type="neutral"
                  variant="outline"
                  size="xs"
                  @click=${this.#cancelImport}
                  >${t("capture.importCancel")}</sonic-button
                >
              </div>
            </div>
          `
        : nothing}
      ${this.#renderConfigModal()}
      <div class="flex flex-col" formDataProvider=${captureFormKey.path}>
        <sonic-form-layout>
          <sonic-input
            class="w-full max-w-md opacity-90"
            name="captureName"
            type="text"
            size="sm"
            label=${t("capture.name")}
            title=${t("capture.nameHint")}
            ?disabled=${this.listening}
          ></sonic-input>
        </sonic-form-layout>
      </div>
      <div
        class="mt-2 flex min-h-0 flex-1 flex-col gap-1.5"
        formDataProvider=${captureFeedKey.path}
        dataFilterProvider=${captureFeedKey.path}
      >
        <div class="feed">
          ${this.sampleCount === 0
            ? html`<p class="sr-only">
                ${this.listening
                  ? "Aucun son extrait pour l’instant."
                  : this.micOpen
                    ? t("capture.scoutFeedEmpty")
                    : "Aucun son extrait pour l’instant."}
              </p>`
            : nothing}
          <div class="flex flex-col gap-1">
            <p class="min-h-[1.25em] text-xs leading-[1.25em] text-neutral-500">
              ${soundCountLabel(this.sampleCount)}
            </p>
            <sonic-table size="sm" bordered rounded maxHeight="min(48vh, 26rem)">
              <sonic-tbody>
                ${this.queueMounted && this.feedSessionId && this.feedProjectId
                  ? html`
                      <sonic-queue
                        class="table-queue"
                        lazyload
                        dataProvider=${captureQueueKey.path}
                        dataProviderExpression=${`samples?projectId=${encodeURIComponent(this.feedProjectId)}&sessionId=${encodeURIComponent(this.feedSessionId)}&offset=$offset&limit=$limit`}
                        dataFilterProvider=${captureFeedKey.path}
                        key="data"
                        limit="15"
                        idKey="id"
                        .items=${this.#renderFeedRow}
                        .noItems=${this.#noFeedItems}
                        .skeleton=${this.#feedSkeleton}
                      ></sonic-queue>
                    `
                  : this.#feedSkeleton()}
              </sonic-tbody>
            </sonic-table>
          </div>
        </div>
      </div>
      <div class="sr-only" aria-live="polite">${this.statusText}</div>
      ${this.economy
        ? html`<div
            class="economy"
            @click=${() => (this.economy = false)}
            role="button"
            tabindex="0"
            title=${t("capture.economy")}
          >
            <div class="halo" style="opacity:${0.2 + this.level.rms * 2}"></div>
            <span class="absolute bottom-8">${t("capture.economy")}</span>
            <span
              class="absolute right-4 top-4 h-3 w-3 rounded-full bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--sc-danger)_30%,transparent)]"
            ></span>
            <span
              class="absolute left-4 top-4 font-mono tabular-nums text-[#666]"
              >${this.sampleCount}</span
            >
          </div>`
        : nothing}
    `;
  }

  #renderFeedRow = (row: FeedRow) => {
    const tags = row.tags ?? [];
    const name = row.userName?.trim() || row.name || row.id.slice(0, 8);
    const playing = getSampleAuditionPlaying() === row.id;
    return html`
      <sonic-tr type=${playing ? "info" : nothing}>
        <sonic-td
          minWidth="10rem"
          vAlign="middle"
          @click=${() => navigate({ name: "sample", id: row.id })}
        >
          ${tip(
            t("sample.open"),
            html`
              <div>
                ${name}${
                  isProcessingBusy(tags)
                    ? ` · ${t("library.processing")}`
                    : isProcessingError(tags)
                      ? ` · ${t("library.processingError")}`
                      : tags.includes("processing:done")
                        ? " · ok"
                        : ""
                }${
                  row.interestScore != null
                    ? ` · ★${Math.round(row.interestScore * 100)}`
                    : ""
                }
              </div>
              <div class="font-mono text-[0.7rem] text-neutral-500">
                ${row.class}${row.loopProposed ? " · boucle" : ""}${
                  tags.length ? ` · ${tags.slice(0, 4).join(" · ")}` : ""
                }
              </div>
            `,
            { class: "w-full max-w-full justify-start text-left", focusable: true },
          )}
        </sonic-td>
        <sonic-td width="6.5rem" align="right" vAlign="middle">
          ${renderSamplePlayButton({
            sampleId: row.id,
            onClick: () => void this.#audition(row.id),
          })}
          ${isProcessingError(tags)
            ? tip(
                t("library.retryProcess"),
                html`<sonic-button
                  shape="circle"
                  variant="ghost"
                  type="warning"
                  size="sm"
                  icon
                  data-aria-label=${t("library.retryProcess")}
                  @click=${() => void processQueue.reanalyzeSample(row.id)}
                >
                  ${glIcon("refresh-cw", { size: "sm" })}
                </sonic-button>`,
              )
            : nothing}
          ${tip(
            t("dialog.delete"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="sm"
                icon
                data-aria-label=${t("dialog.delete")}
                @click=${() => void this.#removeExtracted(row.id)}
              >
                ${glIcon("x", { size: "sm" })}
              </sonic-button>
            `,
          )}
        </sonic-td>
      </sonic-tr>
    `;
  };

  #noFeedItems = () => nothing;

  #feedSkeleton = () => html`
    ${[0, 1, 2].map(
      () => html`
        <sonic-tr>
          <sonic-td minWidth="10rem">
            <span class="block h-2.5 w-2/5 rounded bg-neutral-200"></span>
          </sonic-td>
          <sonic-td width="6.5rem" align="right"></sonic-td>
        </sonic-tr>
      `,
    )}
  `;

  #renderTargetRateSection() {
    const songMode = this.fileProcessMode === "song";
    const wholeMode = this.fileProcessMode === "whole";
    const hint = wholeMode
      ? t("capture.targetRateHintWhole")
      : songMode
        ? t("capture.targetRateHintSong")
        : t("capture.targetRateHint");
    const valueLabel = wholeMode
      ? t("capture.fileModeWhole")
      : songMode
        ? `${this.targetCapturesPerMin}/min · ${tf("capture.targetRateGrid", {
            grid: songGridCaption(this.targetCapturesPerMin),
          })}`
        : `${this.targetCapturesPerMin}/min${
            this.micOpen ? ` · ≈${formatRate(this.measuredRatePerMin)}` : ""
          }`;

    return html`
      <div class="flex w-full flex-col gap-1">
        <span class="text-sm font-medium text-content"
          >${t("capture.targetRate")}</span
        >
        <span class="font-mono text-[0.8rem] tabular-nums text-neutral-500"
          >${valueLabel}</span
        >
        <p class="m-0 text-xs leading-snug text-neutral-500">${hint}</p>
        <input
          id="gl-target-rate"
          class="w-full accent-primary ${wholeMode
            ? "cursor-not-allowed opacity-40"
            : "cursor-pointer"}"
          type="range"
          min=${CAPTURE_RATE.minPerMin}
          max=${CAPTURE_RATE.maxPerMin}
          step="1"
          .value=${String(this.targetCapturesPerMin)}
          ?disabled=${wholeMode}
          @input=${this.#onTargetRateInput}
          @change=${this.#onTargetRateChange}
          aria-valuemin=${CAPTURE_RATE.minPerMin}
          aria-valuemax=${CAPTURE_RATE.maxPerMin}
          aria-valuenow=${this.targetCapturesPerMin}
          aria-label=${t("capture.targetRate")}
        />
        <div
          class="flex justify-between font-mono text-[0.7rem] text-neutral-500"
        >
          <span>${t("capture.targetLow")}</span>
          <span>${t("capture.targetHigh")}</span>
        </div>
      </div>
    `;
  }

  #renderConfigModal() {
    const inputs = this.audioInputs;
    const multi = inputs.length > 1;
    const options: AudioInputOption[] = [
      { value: "", label: t("capture.audioSourceDefault") },
      ...inputs,
    ];
    const selectedLabel =
      inputs.length === 1
        ? inputs[0]!.label
        : (options.find((o) => o.value === this.audioDeviceId)?.label ??
          t("capture.audioSourceDefault"));

    const m = GL_MODAL_PRESETS.wide;
    return html`
      <sonic-modal
        ?fullScreen=${true}
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.configModalOpen}
        @hide=${this.#onConfigModalHide}
      >
        <sonic-modal-title>${t("capture.configTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <gl-form-stack gap="lg" class="capture-config-modal">
            <gl-form-section
              label=${t("capture.sectionInput")}
              description=${t("capture.sectionInputHint")}
            >
              <sonic-form-layout>
                <div class="flex flex-col gap-1">
                  <span class="text-sm font-medium text-content"
                    >${t("capture.audioSource")}</span
                  >
                  ${inputs.length === 0
                    ? html`<p class="m-0 text-xs leading-snug text-neutral-500">
                        ${t("capture.audioSourceNone")}
                      </p>`
                    : multi
                      ? html`
                          <p class="m-0 text-xs leading-snug text-neutral-500">
                            ${t("capture.audioSourceHint")}
                          </p>
                          <gl-pop-select
                            class="w-full max-w-full"
                            size="sm"
                            variant="outline"
                            .value=${this.audioDeviceId}
                            .options=${options}
                            placeholder=${t("capture.audioSourceDefault")}
                            @gl-change=${this.#onAudioDeviceChange}
                          ></gl-pop-select>
                          <p
                            class="m-0 text-[0.7rem] leading-snug text-neutral-500"
                          >
                            ${t("capture.audioSourceApplyHint")}
                          </p>
                        `
                      : html`
                          <p class="m-0 text-sm text-content">${selectedLabel}</p>
                          <p class="m-0 text-xs leading-snug text-neutral-500">
                            ${t("capture.audioSourceSingle")}
                          </p>
                        `}
                </div>
                <label class="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    .checked=${this.autoGain}
                    @change=${this.#onAutoGainChange}
                  />
                  <span class="flex flex-col gap-0.5">
                    <span class="text-sm text-content"
                      >${t("capture.autoGain")}</span
                    >
                    <span class="text-xs leading-snug text-neutral-500"
                      >${t("capture.autoGainHint")}</span
                    >
                  </span>
                </label>
              </sonic-form-layout>
            </gl-form-section>

            <gl-form-section
              label=${t("capture.sectionSlice")}
              description=${t("capture.sectionSliceHint")}
            >
              <sonic-form-layout>
                <div class="flex flex-col gap-1.5">
                  <span class="text-sm font-medium text-content"
                    >${t("capture.fileMode")}</span
                  >
                  <p class="m-0 text-xs leading-snug text-neutral-500">
                    ${t("capture.fileModeHint")}
                  </p>
                  ${this.#renderFileModeRadios()}
                </div>
                ${this.#renderTargetRateSection()}
                ${this.#renderSliceDurationFields()}
                ${this.#renderSlicePreview()}
              </sonic-form-layout>
            </gl-form-section>

            <gl-form-section
              label=${t("capture.mlYamnet")}
              description=${t("capture.mlYamnetHint")}
            >
              <sonic-form-layout>
                <label class="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    .checked=${this.mlYamnet}
                    @change=${this.#onMlYamnetChange}
                  />
                  <span class="text-sm text-content">${t("capture.mlEnable")}</span>
                </label>
                ${this.mlYamnet
                  ? html`
                      <label class="flex flex-col gap-1">
                        <span class="text-xs text-neutral-500"
                          >${t("capture.mlYamnetMinScore")}
                          (${this.mlYamnetMinScore.toFixed(2)})</span
                        >
                        <input
                          type="range"
                          min="0.02"
                          max="0.4"
                          step="0.01"
                          .value=${String(this.mlYamnetMinScore)}
                          @input=${this.#onYamnetMinScoreInput}
                          @change=${this.#onYamnetMinScoreChange}
                        />
                      </label>
                      <label class="flex flex-col gap-1">
                        <span class="text-xs text-neutral-500"
                          >${t("capture.mlYamnetMaxLabels")}
                          (${this.mlYamnetMaxLabels})</span
                        >
                        <input
                          type="range"
                          min="1"
                          max="12"
                          step="1"
                          .value=${String(this.mlYamnetMaxLabels)}
                          @input=${this.#onYamnetMaxLabelsInput}
                          @change=${this.#onYamnetMaxLabelsChange}
                        />
                      </label>
                      <label class="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          class="mt-0.5"
                          .checked=${this.mlYamnetAutoClass}
                          @change=${this.#onYamnetAutoClassChange}
                        />
                        <span class="flex flex-col gap-0.5">
                          <span class="text-sm text-content"
                            >${t("capture.mlYamnetAutoClass")}</span
                          >
                          <span class="text-xs leading-snug text-neutral-500"
                            >${t("capture.mlYamnetAutoClassHint")}</span
                          >
                        </span>
                      </label>
                    `
                  : nothing}
              </sonic-form-layout>
            </gl-form-section>

            <gl-form-section
              label=${t("capture.mlClap")}
              description=${t("capture.mlClapHint")}
            >
              <sonic-form-layout>
                <label class="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    .checked=${this.mlClap}
                    @change=${this.#onMlClapChange}
                  />
                  <span class="flex flex-col gap-0.5">
                    <span class="text-sm text-content">${t("capture.mlEnable")}</span>
                    ${this.clapStatus
                      ? html`<span
                          class="font-mono text-[0.7rem] text-neutral-500"
                          >${this.clapStatus}</span
                        >`
                      : nothing}
                  </span>
                </label>
                ${this.mlClap
                  ? html`
                      <label class="flex flex-col gap-1">
                        <span class="text-xs text-neutral-500"
                          >${t("capture.mlClapMinScore")}
                          (${this.mlClapMinScore.toFixed(2)})</span
                        >
                        <input
                          type="range"
                          min="0.02"
                          max="0.5"
                          step="0.01"
                          .value=${String(this.mlClapMinScore)}
                          @input=${this.#onClapMinScoreInput}
                          @change=${this.#onClapMinScoreChange}
                        />
                      </label>
                      <label class="flex flex-col gap-1">
                        <span class="text-xs text-neutral-500"
                          >${t("capture.mlClapLimit")}
                          (${this.mlClapLimit})</span
                        >
                        <input
                          type="range"
                          min="3"
                          max="40"
                          step="1"
                          .value=${String(this.mlClapLimit)}
                          @input=${this.#onClapLimitInput}
                          @change=${this.#onClapLimitChange}
                        />
                      </label>
                    `
                  : nothing}
              </sonic-form-layout>
            </gl-form-section>

            <gl-form-section
              label=${t("capture.mlDemucsStems")}
              description=${t("capture.mlDemucsStemsHint")}
            >
              <sonic-form-layout>
                <div class="flex flex-wrap gap-x-3 gap-y-1.5">
                  ${DEMUCS_STEMS.map(
                    (stem) => html`
                      <label class="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          .checked=${this.mlDemucsStems.includes(stem)}
                          @change=${(e: Event) =>
                            this.#onDemucsStemToggle(stem, e)}
                        />
                        <span class="text-sm text-content">${stem}</span>
                      </label>
                    `,
                  )}
                </div>
              </sonic-form-layout>
            </gl-form-section>
          </gl-form-stack>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #renderSliceDurationFields() {
    const wholeMode = this.fileProcessMode === "whole";
    return html`
      <div class="flex w-full flex-col gap-1.5">
        <span class="text-sm font-medium text-content"
          >${t("capture.sliceDuration")}</span
        >
        <p class="m-0 text-xs leading-snug text-neutral-500">
          ${wholeMode
            ? t("capture.sliceDurationHintWhole")
            : t("capture.sliceDurationHint")}
        </p>
        <div class="flex flex-wrap gap-3">
          <label class="flex min-w-[8rem] flex-1 flex-col gap-1">
            <span class="text-xs text-neutral-500"
              >${t("capture.sliceMinMs")}</span
            >
            <input
              class="w-full rounded border border-neutral-300 bg-neutral-0 px-2 py-1.5 font-mono text-sm text-content ${wholeMode
                ? "cursor-not-allowed opacity-40"
                : ""}"
              type="number"
              inputmode="numeric"
              min=${SLICE_DURATION.absMinMs}
              max=${SLICE_DURATION.absMaxMs}
              step="10"
              placeholder=${t("capture.sliceDurationEmpty")}
              .value=${this.sliceMinDurationMs == null
                ? ""
                : String(this.sliceMinDurationMs)}
              ?disabled=${wholeMode}
              @change=${this.#onSliceMinDurationChange}
              aria-label=${t("capture.sliceMinMs")}
            />
          </label>
          <label class="flex min-w-[8rem] flex-1 flex-col gap-1">
            <span class="text-xs text-neutral-500"
              >${t("capture.sliceMaxMs")}</span
            >
            <input
              class="w-full rounded border border-neutral-300 bg-neutral-0 px-2 py-1.5 font-mono text-sm text-content ${wholeMode
                ? "cursor-not-allowed opacity-40"
                : ""}"
              type="number"
              inputmode="numeric"
              min=${SLICE_DURATION.absMinMs}
              max=${SLICE_DURATION.absMaxMs}
              step="50"
              placeholder=${t("capture.sliceDurationEmpty")}
              .value=${this.sliceMaxDurationMs == null
                ? ""
                : String(this.sliceMaxDurationMs)}
              ?disabled=${wholeMode}
              @change=${this.#onSliceMaxDurationChange}
              aria-label=${t("capture.sliceMaxMs")}
            />
          </label>
        </div>
      </div>
    `;
  }

  #renderSlicePreview() {
    const result = this.previewResult;
    const err = result?.error;
    const errText =
      err === "no-tempo"
        ? t("capture.importNoTempo")
        : err === "too-long"
          ? t("capture.previewTooLong")
          : err === "empty"
            ? t("capture.previewFailed")
            : "";
    const summary = this.#previewSummaryLabel();
    return html`
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-content"
          >${t("capture.previewFile")}</span
        >
        <p class="m-0 text-xs leading-snug text-neutral-500">
          ${t("capture.previewFileHint")}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <sonic-button
            size="sm"
            variant="outline"
            type="neutral"
            @click=${this.#pickPreviewFile}
          >
            ${glIcon("upload", { slot: "prefix", size: "sm" })}
            ${t("capture.previewFilePick")}
          </sonic-button>
          ${this.previewFileName
            ? html`
                <span
                  class="min-w-0 max-w-[12rem] truncate font-mono text-[0.75rem] text-content"
                  title=${this.previewFileName}
                  >${this.previewFileName}</span
                >
                ${tip(
                  t("capture.previewFileClear"),
                  html`
                    <sonic-button
                      shape="circle"
                      variant="ghost"
                      type="neutral"
                      size="sm"
                      icon
                      data-aria-label=${t("capture.previewFileClear")}
                      @click=${this.#clearPreviewFile}
                    >
                      ${glIcon("x", { size: "sm" })}
                    </sonic-button>
                  `,
                )}
              `
            : nothing}
        </div>
        ${this.previewBusy
          ? html`<p class="m-0 text-xs text-neutral-500">
              ${t("capture.previewAnalyzing")}
            </p>`
          : nothing}
        ${errText
          ? html`<p class="m-0 text-xs leading-snug text-warning">${errText}</p>`
          : nothing}
        ${!errText &&
        result &&
        result.regions.length === 0 &&
        result.mode !== "whole"
          ? html`<p class="m-0 text-xs leading-snug text-neutral-500">
              ${t("capture.previewEmpty")}
            </p>`
          : nothing}
        ${summary && !errText
          ? html`<p
              class="m-0 font-mono text-[0.75rem] leading-snug text-neutral-500"
            >
              ${summary}
            </p>`
          : nothing}
        ${this.#previewMono
          ? html`
              <gl-slice-preview-wave
                class="mt-1"
                .pcm=${this.#previewMono}
                .sampleRate=${this.#previewSampleRate}
                .regions=${result?.regions ?? []}
                .selectedIndex=${this.previewSelected}
                @gl-slice-preview-play=${this.#onPreviewSlicePlay}
              ></gl-slice-preview-wave>
            `
          : nothing}
        ${this.#renderSlicePreviewDetail()}
        ${this.#previewFile && result && !err
          ? html`
              <sonic-button
                size="sm"
                type="primary"
                ?disabled=${this.importBusy || this.listening}
                @click=${() => void this.#processPreviewFile()}
              >
                ${t("capture.previewFileProcess")}
              </sonic-button>
            `
          : nothing}
      </div>
    `;
  }

  #renderSlicePreviewDetail() {
    const result = this.previewResult;
    if (!result || result.error || result.regions.length === 0) return nothing;
    const n = result.regions.length;
    const idx = this.previewSelected;
    const region = idx >= 0 ? result.regions[idx] : null;
    const meta = this.previewDetailMeta;
    const detailRegions =
      this.previewDetailMono && this.previewDetailMono.length > 0
        ? [
            {
              startFrame: 0,
              endFrame: this.previewDetailMono.length,
              class: (region?.class ?? "texture") as SlicePreviewRegion["class"],
              kind: (region?.kind ?? "texture") as SlicePreviewRegion["kind"],
              interestScore: meta?.interestScore ?? region?.interestScore ?? 0,
              durationMs: meta?.durationMs ?? region?.durationMs ?? 0,
              kept: region?.kept ?? true,
            },
          ]
        : [];
    const canPrev = idx > 0;
    const canNext = idx >= 0 && idx < n - 1;
    const canPrevKept = this.#findKeptIndex(idx, -1) >= 0;
    const canNextKept = this.#findKeptIndex(idx, 1) >= 0;
    const posLabel =
      idx >= 0
        ? tf("capture.previewDetailPos", {
            i: String(idx + 1),
            n: String(n),
          })
        : "";
    const infoBits: string[] = [];
    if (meta) {
      infoBits.push(`${meta.durationMs} ms`);
      infoBits.push(`★${Math.round(meta.interestScore * 100)}`);
      if (meta.class) infoBits.push(meta.class);
      if (!meta.kept) infoBits.push(t("capture.previewDetailCulled"));
      if (meta.analysis?.noteName) infoBits.push(meta.analysis.noteName);
      if (meta.analysis?.bpm)
        infoBits.push(`${Math.round(meta.analysis.bpm)} BPM`);
    } else if (region) {
      infoBits.push(`${region.durationMs} ms`);
      infoBits.push(`★${Math.round(region.interestScore * 100)}`);
      infoBits.push(region.class);
    }

    return html`
      <div class="mt-2 flex flex-col gap-1.5 rounded-md bg-neutral-100 p-2">
        <div class="flex flex-wrap items-center gap-1">
          ${tip(
            t("capture.previewNavPrevKept"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="sm"
                icon
                ?disabled=${!canPrevKept || this.previewDetailBusy}
                data-aria-label=${t("capture.previewNavPrevKept")}
                @click=${() => void this.#navPreviewKept(-1)}
              >
                ${glIcon("chevrons-left", { size: "sm" })}
              </sonic-button>
            `,
          )}
          ${tip(
            t("capture.previewNavPrev"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="sm"
                icon
                ?disabled=${!canPrev || this.previewDetailBusy}
                data-aria-label=${t("capture.previewNavPrev")}
                @click=${() => void this.#navPreview(-1)}
              >
                ${glIcon("chevron-left", { size: "sm" })}
              </sonic-button>
            `,
          )}
          <span
            class="min-w-0 flex-1 truncate text-center font-mono text-[0.75rem] text-content"
          >
            ${posLabel}
            ${infoBits.length
              ? html`<span class="text-neutral-500"
                  > · ${infoBits.join(" · ")}</span
                >`
              : nothing}
          </span>
          ${tip(
            t("capture.previewNavNext"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="sm"
                icon
                ?disabled=${!canNext || this.previewDetailBusy}
                data-aria-label=${t("capture.previewNavNext")}
                @click=${() => void this.#navPreview(1)}
              >
                ${glIcon("chevron-right", { size: "sm" })}
              </sonic-button>
            `,
          )}
          ${tip(
            t("capture.previewNavNextKept"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="sm"
                icon
                ?disabled=${!canNextKept || this.previewDetailBusy}
                data-aria-label=${t("capture.previewNavNextKept")}
                @click=${() => void this.#navPreviewKept(1)}
              >
                ${glIcon("chevrons-right", { size: "sm" })}
              </sonic-button>
            `,
          )}
        </div>
        ${this.previewDetailBusy
          ? html`<p class="m-0 text-xs text-neutral-500">
              ${t("capture.previewDetailProcessing")}
            </p>`
          : nothing}
        ${this.previewDetailMono
          ? html`
              <gl-slice-preview-wave
                .pcm=${this.previewDetailMono}
                .sampleRate=${this.#previewSampleRate}
                .regions=${detailRegions}
                .selectedIndex=${0}
              ></gl-slice-preview-wave>
            `
          : nothing}
      </div>
    `;
  }

  #previewSummaryLabel(): string {
    const result = this.previewResult;
    if (!result || result.error) return "";
    if (result.mode === "whole") return t("capture.previewSummaryWhole");
    if (result.mode === "song") {
      return tf("capture.previewSummarySong", {
        kept: String(result.kept),
        bpm: String(Math.round(result.bpm ?? 0)),
        grid: songGridCaption(this.targetCapturesPerMin),
      });
    }
    return tf("capture.previewSummary", {
      kept: String(result.kept),
      culled: String(result.culled),
    });
  }

  #renderFileModeRadios() {
    const modes: {
      value: FileProcessMode;
      label: string;
      hint: string;
    }[] = [
      {
        value: "hunt",
        label: t("capture.fileModeHunt"),
        hint: t("capture.fileModeHuntHint"),
      },
      {
        value: "song",
        label: t("capture.fileModeSong"),
        hint: t("capture.fileModeSongHint"),
      },
      {
        value: "whole",
        label: t("capture.fileModeWhole"),
        hint: t("capture.fileModeWholeHint"),
      },
    ];
    return html`
      <div class="flex flex-col gap-2" role="radiogroup" aria-label=${t("capture.fileMode")}>
        ${modes.map(
          (m) => html`
            <label class="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                class="mt-0.5"
                name="gl-file-process-mode"
                .value=${m.value}
                .checked=${this.fileProcessMode === m.value}
                @change=${() => this.#onFileProcessMode(m.value)}
              />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm text-content">${m.label}</span>
                <span class="text-xs leading-snug text-neutral-500"
                  >${m.hint}</span
                >
              </span>
            </label>
          `,
        )}
      </div>
    `;
  }

  #onFileProcessMode = (mode: FileProcessMode): void => {
    if (mode === this.fileProcessMode) return;
    this.fileProcessMode = mode;
    void this.#persistCapturePrefs();
    this.#scheduleSlicePreview({ immediate: true });
  };

  #onSliceMinDurationChange = (e: Event): void => {
    const raw = (e.target as HTMLInputElement).value.trim();
    this.sliceMinDurationMs = raw === "" ? null : parseOptionalDurationMs(raw);
    void this.#persistCapturePrefs();
    this.#scheduleSlicePreview({ immediate: true });
  };

  #onSliceMaxDurationChange = (e: Event): void => {
    const raw = (e.target as HTMLInputElement).value.trim();
    this.sliceMaxDurationMs = raw === "" ? null : parseOptionalDurationMs(raw);
    void this.#persistCapturePrefs();
    this.#scheduleSlicePreview({ immediate: true });
  };

  #onAudioDeviceChange = (e: Event): void => {
    const value = String(
      (e as CustomEvent<{ value?: string }>).detail?.value ?? "",
    );
    void this.#applyAudioDevice(value);
  };

  #onMlYamnetChange = (e: Event): void => {
    const on = (e.target as HTMLInputElement).checked;
    this.mlYamnet = on;
    void this.#persistCapturePrefs();
  };

  #onMlClapChange = (e: Event): void => {
    const on = (e.target as HTMLInputElement).checked;
    this.mlClap = on;
    void this.#persistCapturePrefs().then(() => {
      if (on) void backfillClapEmbeddings().catch(() => undefined);
    });
  };

  #onClapStatus = (ev: Event): void => {
    const d = (ev as CustomEvent<ClapStatusDetail>).detail;
    if (!d) return;
    if (d.phase === "idle") {
      this.clapStatus = "";
      return;
    }
    const pct = d.ratio != null ? ` ${Math.round(d.ratio * 100)}%` : "";
    const extra = d.message ? ` · ${d.message}` : "";
    if (d.phase === "loading-model") {
      this.clapStatus = `${t("library.clapLoadingModel")}${pct}${extra}`;
    } else if (d.phase === "embedding") {
      this.clapStatus = `${t("library.clapEmbedding")}${pct}${extra}`;
    } else if (d.phase === "error") {
      this.clapStatus = d.message ?? t("library.similarFailed");
    }
  };

  #onYamnetMinScoreInput = (e: Event): void => {
    this.mlYamnetMinScore = clampYamnetMinScore(
      Number((e.target as HTMLInputElement).value),
    );
  };

  #onYamnetMinScoreChange = (e: Event): void => {
    this.#onYamnetMinScoreInput(e);
    void this.#persistCapturePrefs();
  };

  #onYamnetMaxLabelsInput = (e: Event): void => {
    this.mlYamnetMaxLabels = clampYamnetMaxLabels(
      Number((e.target as HTMLInputElement).value),
    );
  };

  #onYamnetMaxLabelsChange = (e: Event): void => {
    this.#onYamnetMaxLabelsInput(e);
    void this.#persistCapturePrefs();
  };

  #onYamnetAutoClassChange = (e: Event): void => {
    this.mlYamnetAutoClass = (e.target as HTMLInputElement).checked;
    void this.#persistCapturePrefs();
  };

  #onClapMinScoreInput = (e: Event): void => {
    this.mlClapMinScore = clampClapMinScore(
      Number((e.target as HTMLInputElement).value),
    );
  };

  #onClapMinScoreChange = (e: Event): void => {
    this.#onClapMinScoreInput(e);
    void this.#persistCapturePrefs();
  };

  #onClapLimitInput = (e: Event): void => {
    this.mlClapLimit = clampClapLimit(
      Number((e.target as HTMLInputElement).value),
    );
  };

  #onClapLimitChange = (e: Event): void => {
    this.#onClapLimitInput(e);
    void this.#persistCapturePrefs();
  };

  #onDemucsStemToggle = (stem: DemucsStemName, e: Event): void => {
    const on = (e.target as HTMLInputElement).checked;
    const next = on
      ? [...new Set([...this.mlDemucsStems, stem])]
      : this.mlDemucsStems.filter((s) => s !== stem);
    this.mlDemucsStems =
      next.length > 0 ? resolveDemucsStems(next) : [...ML_DEFAULTS.demucsStems];
    void this.#persistCapturePrefs();
  };

  async #refreshAudioInputs(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.audioInputs = [];
      return;
    }
    let devices = await navigator.mediaDevices.enumerateDevices();
    let inputs = devices.filter((d) => d.kind === "audioinput");
    if (inputs.some((d) => !d.label) && !this.micOpen) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((tr) => tr.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        inputs = devices.filter((d) => d.kind === "audioinput");
      } catch {
        /* permission denied — keep unlabeled list */
      }
    }
    this.audioInputs = inputs.map((d, i) => ({
      value: d.deviceId,
      label:
        d.label.trim() ||
        tf("capture.audioSourceUnnamed", { n: i + 1 }),
    }));
    if (
      this.audioDeviceId &&
      !this.audioInputs.some((o) => o.value === this.audioDeviceId)
    ) {
      this.audioDeviceId = "";
      void this.#persistCapturePrefs();
    }
  }

  async #applyAudioDevice(deviceId: string): Promise<void> {
    if (deviceId === this.audioDeviceId) return;
    this.audioDeviceId = deviceId;
    await this.#persistCapturePrefs();
    if (!this.micOpen) return;
    const wasListening = this.listening;
    if (wasListening) await this.#stopRecording();
    await this.#shutdownMic();
    this.#stopping = false;
    if (wasListening) await this.#startRecording();
    else await this.#startScout();
  }

  #toggle = async (): Promise<void> => {
    if (this.importBusy) return;
    if (this.listening) {
      await this.#stopRecording();
      return;
    }
    await this.#startRecording();
  };

  #pickImportFile = (): void => {
    if (this.importBusy) return;
    if (this.listening) {
      this.warnings = [t("capture.importBlocked")];
      return;
    }
    this.renderRoot
      .querySelector<HTMLInputElement>("#import-hunt-audio")
      ?.click();
  };

  #pickPreviewFile = (): void => {
    this.renderRoot
      .querySelector<HTMLInputElement>("#slice-preview-audio")
      ?.click();
  };

  #clearPreviewFile = (): void => {
    this.#previewAbort?.abort();
    this.#previewAbort = null;
    if (this.#previewTimer != null) window.clearTimeout(this.#previewTimer);
    this.#previewTimer = null;
    this.#previewFile = null;
    this.#previewPcm = null;
    this.#previewMono = null;
    this.#previewHuntHits = null;
    this.#previewTempo = null;
    this.#previewOpenFloor = null;
    this.#previewDurationKey = "";
    this.#previewProcessed.clear();
    this.previewFileName = "";
    this.previewResult = null;
    this.previewBusy = false;
    this.previewSelected = -1;
    this.previewDetailBusy = false;
    this.previewDetailMono = null;
    this.previewDetailMeta = null;
  };

  async #onPreviewFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    if (!isImportableAudio(file)) {
      this.previewResult = {
        durationMs: 0,
        sampleRate: this.#previewSampleRate,
        channelCount: 1,
        mode: this.fileProcessMode,
        regions: [],
        kept: 0,
        culled: 0,
        error: "empty",
      };
      return;
    }
    this.#previewFile = file;
    this.previewFileName = file.name;
    this.previewResult = null;
    this.previewSelected = -1;
    this.previewDetailMono = null;
    this.previewDetailMeta = null;
    this.#previewProcessed.clear();
    this.#previewHuntHits = null;
    this.#previewTempo = null;
    this.previewBusy = true;
    try {
      const decoded = await decodeAudioFileToPcm(file);
      this.#previewPcm = decoded.pcm;
      this.#previewSampleRate = decoded.sampleRate;
      this.#previewChannelCount = decoded.channelCount;
      this.#previewMono = toMonoPcm(decoded.pcm, decoded.channelCount);
      this.#scheduleSlicePreview({ immediate: true, freshHunt: true });
    } catch {
      this.#previewPcm = null;
      this.#previewMono = null;
      this.previewBusy = false;
      this.previewResult = {
        durationMs: 0,
        sampleRate: this.#previewSampleRate,
        channelCount: 1,
        mode: this.fileProcessMode,
        regions: [],
        kept: 0,
        culled: 0,
        error: "empty",
      };
    }
  }

  #scheduleSlicePreview(opts?: {
    immediate?: boolean;
    freshHunt?: boolean;
  }): void {
    if (!this.#previewPcm) return;
    if (opts?.freshHunt) {
      this.#previewHuntHits = null;
      this.#previewTempo = null;
    }
    if (this.#previewTimer != null) window.clearTimeout(this.#previewTimer);
    this.#previewTimer = null;
    if (opts?.immediate) {
      void this.#runSlicePreview();
      return;
    }
    this.#previewTimer = window.setTimeout(() => {
      this.#previewTimer = null;
      void this.#runSlicePreview();
    }, 180);
  }

  async #runSlicePreview(): Promise<void> {
    const pcm = this.#previewPcm;
    if (!pcm) return;
    this.#previewAbort?.abort();
    const abort = new AbortController();
    this.#previewAbort = abort;
    this.previewBusy = true;
    this.previewSelected = -1;
    this.previewDetailMono = null;
    this.previewDetailMeta = null;
    this.#previewProcessed.clear();
    const openFloor = sensitivityToOpenFloor(this.attackSensitivity);
    const durationKey = `${this.sliceMinDurationMs ?? ""}:${this.sliceMaxDurationMs ?? ""}`;
    if (
      this.#previewOpenFloor != null &&
      this.#previewOpenFloor !== openFloor
    ) {
      this.#previewHuntHits = null;
    }
    this.#previewOpenFloor = openFloor;
    this.#previewDurationKey = durationKey;
    const lengthFilter = this.#sliceLengthFilter();
    try {
      const result = await slicePreview.analyze({
        pcm,
        sampleRate: this.#previewSampleRate,
        channelCount: this.#previewChannelCount,
        mode: this.fileProcessMode,
        targetPerMin: this.targetCapturesPerMin,
        openFloorFactor: openFloor,
        minDurationMs: lengthFilter.minMs,
        maxDurationMs: lengthFilter.maxMs,
        tempo: this.#previewTempo,
        huntHits: this.#previewHuntHits,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      this.previewResult = result;
      if (result.tempo) this.#previewTempo = result.tempo;
      if (result.mode === "hunt" && !result.error) {
        this.#previewHuntHits = result.regions.map((r) => ({
          startFrame: r.startFrame,
          endFrame: r.endFrame,
          class: r.class,
          kind: r.kind,
          interestScore: r.interestScore,
          durationMs: r.durationMs,
        }));
      }
      const first =
        result.error || result.regions.length === 0
          ? -1
          : result.regions.findIndex((r) => r.kept);
      const autoIdx =
        first >= 0 ? first : result.regions.length > 0 ? 0 : -1;
      if (autoIdx >= 0) {
        void this.#selectPreviewSlice(autoIdx, { play: false });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      this.previewResult = {
        durationMs: 0,
        sampleRate: this.#previewSampleRate,
        channelCount: this.#previewChannelCount,
        mode: this.fileProcessMode,
        regions: [],
        kept: 0,
        culled: 0,
        error: "empty",
      };
    } finally {
      if (this.#previewAbort === abort) {
        this.previewBusy = false;
        this.#previewAbort = null;
      }
    }
  }

  #onPreviewSlicePlay = (e: Event): void => {
    const index = (e as CustomEvent<{ index: number }>).detail?.index;
    if (index == null) return;
    void this.#selectPreviewSlice(index, { play: true });
  };

  #findKeptIndex(from: number, dir: -1 | 1): number {
    const regions = this.previewResult?.regions;
    if (!regions?.length) return -1;
    let i = from;
    if (i < 0) i = dir > 0 ? -1 : regions.length;
    for (;;) {
      i += dir;
      if (i < 0 || i >= regions.length) return -1;
      if (regions[i]?.kept) return i;
    }
  }

  #navPreview = (dir: -1 | 1): void => {
    const n = this.previewResult?.regions.length ?? 0;
    if (n < 1) return;
    const cur = this.previewSelected < 0 ? (dir > 0 ? -1 : n) : this.previewSelected;
    const next = cur + dir;
    if (next < 0 || next >= n) return;
    void this.#selectPreviewSlice(next, { play: true });
  };

  #navPreviewKept = (dir: -1 | 1): void => {
    const next = this.#findKeptIndex(this.previewSelected, dir);
    if (next < 0) return;
    void this.#selectPreviewSlice(next, { play: true });
  };

  async #selectPreviewSlice(
    index: number,
    opts: { play?: boolean } = {},
  ): Promise<void> {
    const result = this.previewResult;
    const region = result?.regions[index];
    if (!region || !this.#previewPcm) return;
    this.previewSelected = index;
    this.previewDetailMeta = {
      durationMs: region.durationMs,
      interestScore: region.interestScore,
      tags: [],
      class: region.class,
      kept: region.kept,
      analysis: null,
    };

    const gen = ++this.#previewSelectGen;
    const cached = this.#previewProcessed.get(index);
    if (cached) {
      this.previewDetailMono = cached.mono;
      this.previewDetailMeta = {
        durationMs: cached.durationMs,
        interestScore: cached.interestScore,
        tags: cached.tags,
        class: region.class,
        kept: region.kept,
        analysis: cached.analysis,
      };
      this.previewDetailBusy = false;
      if (opts.play !== false) this.#auditionPreviewPcm(cached.pcm);
      return;
    }

    this.previewDetailBusy = true;
    this.previewDetailMono = null;
    try {
      // Yield so the UI can paint selection before polish.
      await new Promise<void>((r) => setTimeout(r, 0));
      if (gen !== this.#previewSelectGen) return;
      const raw = sliceFrames(
        this.#previewPcm,
        this.#previewChannelCount,
        region.startFrame,
        region.endFrame,
      );
      if (raw.length === 0) return;
      const polished = runProcessJob(
        region.kind,
        raw,
        this.#previewSampleRate,
        this.#previewChannelCount,
      );
      if (gen !== this.#previewSelectGen) return;
      const mono = toMonoPcm(polished.pcm, this.#previewChannelCount);
      const entry = {
        pcm: polished.pcm,
        mono,
        durationMs: polished.durationMs,
        interestScore: polished.interestScore,
        tags: polished.tags,
        analysis: polished.analysis,
      };
      this.#previewProcessed.set(index, entry);
      this.previewDetailMono = mono;
      this.previewDetailMeta = {
        durationMs: entry.durationMs,
        interestScore: entry.interestScore,
        tags: entry.tags,
        class: region.class,
        kept: region.kept,
        analysis: entry.analysis,
      };
      if (opts.play !== false) this.#auditionPreviewPcm(entry.pcm);
    } catch (err) {
      console.error("[glane] preview slice polish failed", err);
      // Fallback: show / play raw slice.
      if (gen !== this.#previewSelectGen) return;
      const raw = sliceFrames(
        this.#previewPcm,
        this.#previewChannelCount,
        region.startFrame,
        region.endFrame,
      );
      this.previewDetailMono = toMonoPcm(raw, this.#previewChannelCount);
      if (opts.play !== false) this.#auditionPreviewPcm(raw);
    } finally {
      if (gen === this.#previewSelectGen) this.previewDetailBusy = false;
    }
  }

  #auditionPreviewPcm(pcm: Float32Array): void {
    if (pcm.length === 0) return;
    // Preview shares the engine — clear feed play chrome if it was active.
    this.#auditionGen++;
    clearSampleAudition();
    this.#engine ??= new TransportEngine();
    const buf = interleavedToAudioBuffer(
      this.#engine.ctx,
      pcm,
      this.#previewSampleRate,
      this.#previewChannelCount,
    );
    this.#engine.audition(buf, 8);
  }

  async #processPreviewFile(): Promise<void> {
    const file = this.#previewFile;
    if (!file || this.importBusy) return;
    this.configModalOpen = false;
    await this.#runImportFile(file);
  }

  #cancelImport = (): void => {
    this.#importAbort?.abort();
  };

  async #onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    await this.#runImportFile(file);
  }

  async #runImportFile(file: File): Promise<void> {
    if (this.importBusy) return;
    if (this.listening) {
      this.warnings = [t("capture.importBlocked")];
      return;
    }

    this.warnings = [];
    this.#clearFeed();
    this.importBusy = true;
    this.importRatio = 0;
    this.importExtracted = 0;
    this.liveState = "extracting";

    const abort = new AbortController();
    this.#importAbort = abort;

    await this.#shutdownMic();

    try {
      const projectId = await projectWorkspace.currentId();
      if (!projectId) return;
      const name =
        (this.captureName ?? "").trim() ||
        file.name.replace(/\.(wav|wave|mp3)$/i, "").trim() ||
        `Fichier ${new Date().toLocaleString("fr-FR")}`;
      this.captureName = name;
      this.#syncCaptureForm();

      const result = await importForHunt.processFile({
        file,
        projectId,
        captureName: name,
        openFloorFactor: sensitivityToOpenFloor(this.attackSensitivity),
        minDurationMs: this.sliceMinDurationMs,
        maxDurationMs: this.sliceMaxDurationMs,
        signal: abort.signal,
        onProgress: (p) => {
          this.importRatio = p.ratio;
          this.importExtracted = p.extracted;
        },
        onSample: (sample) => {
          if (this.feedSessionId !== sample.sessionId) {
            this.#bindFeed(sample.sessionId, projectId);
          } else {
            this.#bumpFeed();
          }
          this.importExtracted = Math.max(
            this.importExtracted,
            this.sampleCount,
          );
        },
      });

      if (result.sessionId && this.feedSessionId !== result.sessionId) {
        this.#bindFeed(result.sessionId, projectId);
      } else {
        this.#bumpFeed();
      }

      this.statusText = tf("capture.importDone", { n: String(result.extracted) });
      this.liveState = "characterized";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        this.liveState = "idle";
        this.statusText = "";
      } else if (err instanceof ImportTempoError) {
        this.warnings = [t("capture.importNoTempo")];
        this.liveState = "idle";
      } else {
        this.warnings = [t("capture.importFailed")];
        this.liveState = "idle";
        console.error("[glane] import-for-hunt failed", err);
      }
    } finally {
      this.#importAbort = null;
      this.importBusy = false;
      this.importRatio = 0;
      void this.#startScout();
    }
  }

  /** Open mic + hunter without writing samples (threshold warm-up). */
  async #startScout(): Promise<void> {
    if (this.micOpen || this.#scoutStarting || this.listening) return;
    this.#scoutStarting = true;
    try {
      const ok = await this.#ensureMic({ scout: true });
      if (!ok) {
        this.scoutBlocked = true;
        return;
      }
      this.scoutBlocked = false;
      this.liveState = "listening";
    } finally {
      this.#scoutStarting = false;
    }
  }

  async #startRecording(): Promise<void> {
    const name =
      (this.captureName ?? "").trim() ||
      `Capture ${new Date().toLocaleString("fr-FR")}`;
    this.captureName = name;
    this.#syncCaptureForm();
    this.warnings = [];
    this.#clearFeed();
    this.statusText = "";
    this.economy = false;

    const ok = await this.#ensureMic({ scout: false, title: name });
    if (!ok) return;

    if (this.#hunt) {
      this.#bindFeed(this.#hunt.id, this.#hunt.projectId);
    }

    this.scoutBlocked = false;
    this.listening = true;
    this.#recordStartedAt = performance.now();
    this.clockMs = 0;
    this.liveState = "listening";
    if (this.#clockTimer != null) window.clearInterval(this.#clockTimer);
    this.#clockTimer = window.setInterval(() => {
      this.clockMs = Math.round(performance.now() - this.#recordStartedAt);
    }, 200);
  }

  /**
   * Ensure LiveCapture + EventHunter are running.
   * Scout: ephemeral session (not in Dexie). Recording: persist session.
   */
  async #ensureMic(opts: {
    scout: boolean;
    title?: string;
  }): Promise<boolean> {
    if (!window.isSecureContext) {
      this.warnings = [
        "Contexte non sécurisé — ouvrez via localhost ou HTTPS (pas une IP http://).",
      ];
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.warnings = ["API micro indisponible dans ce navigateur."];
      return false;
    }

    this.#stopping = false;

    if (this.#live && this.micOpen) {
      if (!opts.scout) {
        const projectId = await projectWorkspace.currentId();
        if (!projectId) return false;
        const now = nowIso();
        this.#hunt = {
          id: createEntityId(),
          projectId,
          startedAt: now,
          endedAt: null,
          durationMs: 0,
          sampleRate: this.#live.sampleRate,
          channelCount: this.#live.hunt?.channelCount ?? 1,
          title: (opts.title ?? this.captureName).trim() || "Capture",
          status: "recording",
          gapMarkers: [],
          createdAt: now,
          updatedAt: now,
          revision: 0,
        };
        await db.sessions.put(this.#hunt);
      }
      return true;
    }

    this.#live = new LiveCapture(
      {
        onLevel: (l) => {
          this.level = l;
        },
        onWarning: (m) => {
          if (opts.scout) return;
          this.warnings = [...this.warnings, m];
        },
        onState: (s) => {
          this.statusText = s;
        },
      },
      { autoGain: this.autoGain, deviceId: this.audioDeviceId || undefined },
    );

    try {
      const projectId = await projectWorkspace.currentId();
      if (!projectId) return false;
      const title = opts.scout
        ? "Scout"
        : (opts.title ?? this.captureName).trim() || "Capture";
      this.#hunt = await this.#live.start(title, projectId);
      if (!opts.scout) await db.sessions.put(this.#hunt);
      this.#hunter = new EventHunter(this.#live.sampleRate, {
        openFloorFactor: sensitivityToOpenFloor(this.attackSensitivity),
        channelCount: this.#live.channelCount,
      });
      this.#pcmCursor = this.#live.rolling?.totalPushed ?? 0;
      this.micOpen = true;
      this.#micStartedAt = performance.now();
      this.#lastRateAdjustMs = this.#micStartedAt;
      if (this.#analyseTimer != null) window.clearInterval(this.#analyseTimer);
      this.#analyseTimer = window.setInterval(() => void this.#tick(), 150);
      return true;
    } catch (err) {
      void this.#live.stop().catch(() => undefined);
      this.#live = null;
      this.#hunt = null;
      this.#hunter = null;
      this.micOpen = false;
      this.listening = false;
      this.liveState = "idle";
      if (!opts.scout) {
        this.warnings = [micStartErrorMessage(err)];
      }
      console.error("[glane] capture mic start failed", err);
      return false;
    }
  }

  async #tick(): Promise<void> {
    if (this.#stopping || this.#analysing || !this.#hunter || !this.#live) {
      return;
    }
    const rolling = this.#live.rolling;
    if (!rolling || rolling.filled < 64) return;

    this.#analysing = true;
    let extraction = null as ReturnType<EventHunter["analyse"]>["extraction"];
    try {
      // Contiguous delta since last tick — never re-slice a sliding window
      // (that used to drop `length % hop` samples every ~150 ms → regular chops).
      const { pcm, fromAbs, toAbs } = rolling.snapshotFrom(this.#pcmCursor);
      if (fromAbs > this.#pcmCursor) {
        // Window overflowed the cursor — gap in capture; resync quietly.
        this.#pcmCursor = fromAbs;
      }
      this.#pcmCursor = toAbs;
      const nowMs = performance.now();
      const result = this.#hunter.analyse(pcm, nowMs);
      this.liveState = result.state;
      extraction = result.extraction;
      this.#regulateCaptureRate(nowMs);
    } finally {
      this.#analysing = false;
    }

    if (!extraction || this.#stopping) return;
    this.#noteDetection(performance.now());
    if (this.listening && this.#hunt) {
      void this.#persistExtraction(extraction);
    } else {
      this.liveState = "listening";
    }
  }

  async #persistExtraction(
    extraction: NonNullable<ReturnType<EventHunter["analyse"]>["extraction"]>,
    opts: { ignoreStop?: boolean } = {},
  ): Promise<void> {
    if ((!opts.ignoreStop && this.#stopping) || !this.#hunt) return;
    if (!this.listening && !opts.ignoreStop) return;
    const hunt = this.#hunt;
    this.liveState = "extracting";
    try {
      const prefs = await db.prefs.get("default");
      if (!opts.ignoreStop && this.#stopping) return;
      if (
        extraction.class === "voice" &&
        (!prefs || prefs.voicePolicy === "exclude")
      ) {
        this.liveState = "listening";
        return;
      }

      const id = createEntityId();
      await sampleOpfs.savePcm(
        id,
        extraction.pcm,
        hunt.sampleRate,
        hunt.channelCount,
      );
      if (!opts.ignoreStop && this.#stopping) return;

      const durationMs = Math.max(
        1,
        durationMsFromPcm(
          extraction.pcm,
          hunt.sampleRate,
          hunt.channelCount,
        ),
      );
      if (
        !durationPassesSliceFilter(durationMs, this.#sliceLengthFilter())
      ) {
        this.liveState = "listening";
        return;
      }
      const interestScore = computeInterestScore({
        pcm: toMonoPcm(extraction.pcm, hunt.channelCount),
        sampleRate: hunt.sampleRate,
        kind: extraction.kind,
        confidence: extraction.confidence,
        loopScore: extraction.loopScore,
      });
      const sample: Sample = {
        id,
        sessionId: hunt.id,
        projectId: hunt.projectId,
        captureName: hunt.title ?? this.captureName,
        sourceOffsetMs: 0,
        durationMs,
        class: extraction.class,
        tags: extraction.tags,
        confidence: extraction.confidence,
        name: buildAutoSampleName({
          captureName: hunt.title ?? this.captureName,
          class: extraction.class,
          durationMs,
          loopProposed: extraction.loopProposed,
          tags: extraction.tags,
        }),
        favorite: false,
        originVersion: DSP_THRESHOLDS.version,
        loopStartMs: extraction.loopStartMs,
        loopEndMs: extraction.loopEndMs,
        loopXfadeMs: extraction.loopXfadeMs,
        loopScore: extraction.loopScore,
        loopProposed: extraction.loopProposed,
        interestScore,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revision: 0,
      };
      await db.samples.put(sample);
      // Rank + soft-cap before polish so we do not queue hundreds of rejects.
      const cull = await cullExcessProcessedSamples(hunt.id);
      if (cull.culledIds.length > 0) processQueue.refresh();
      if (cull.culledIds.includes(id)) {
        this.liveState = "listening";
        return;
      }
      void processQueue.enqueue(id, extraction.kind);
      if (!opts.ignoreStop && this.#stopping) return;

      if (this.feedSessionId !== hunt.id) {
        this.#bindFeed(hunt.id, hunt.projectId);
      } else {
        this.#bumpFeed();
      }
      this.liveState = "characterized";
      this.statusText = `capturé · file processing`;
      if (navigator.vibrate) navigator.vibrate(10);
    } catch {
      this.liveState = "listening";
    }
  }

  /** Stop writing to library; keep scout mic open. */
  async #stopRecording(): Promise<void> {
    const hunt = this.#hunt;
    this.economy = false;
    if (this.#clockTimer != null) window.clearInterval(this.#clockTimer);
    this.#clockTimer = null;

    const flushed = this.#hunter?.flush() ?? null;
    if (flushed && hunt) {
      await this.#persistExtraction(flushed, { ignoreStop: true });
    }

    this.listening = false;
    this.#hunt = null;
    if (hunt) {
      const ended = nowIso();
      const durationMs = Math.round(performance.now() - this.#recordStartedAt);
      void db.sessions
        .put({
          ...hunt,
          endedAt: ended,
          durationMs,
          status: "ready",
          updatedAt: ended,
        })
        .then(() => cullExcessProcessedSamples(hunt.id))
        .then((cull) => {
          if (cull.culledIds.length > 0) processQueue.refresh();
        });
    }
    this.liveState = this.micOpen ? "listening" : "idle";
    this.clockMs = 0;
    void this.#persistCapturePrefs();
  }

  /** Leave page: close mic entirely. */
  async #shutdownMic(): Promise<void> {
    this.#stopping = true;
    const wasRecording = this.listening;
    const hunt = this.#hunt;
    this.listening = false;
    this.micOpen = false;
    this.economy = false;
    this.liveState = "idle";
    if (this.#analyseTimer != null) window.clearInterval(this.#analyseTimer);
    if (this.#clockTimer != null) window.clearInterval(this.#clockTimer);
    this.#analyseTimer = null;
    this.#clockTimer = null;

    const flushed = this.#hunter?.flush() ?? null;
    this.#hunter = null;
    if (wasRecording && flushed && hunt) {
      this.#hunt = hunt;
      this.listening = true;
      await this.#persistExtraction(flushed, { ignoreStop: true });
      this.listening = false;
      this.#hunt = null;
    }

    const live = this.#live;
    this.#live = null;
    this.#hunt = null;
    const stopped = await live?.stop();
    if (hunt && wasRecording) {
      const ended = nowIso();
      const durationMs =
        stopped?.durationMs ??
        Math.round(performance.now() - this.#recordStartedAt);
      void db.sessions
        .put({
          ...hunt,
          endedAt: ended,
          durationMs,
          status: "ready",
          updatedAt: ended,
        })
        .then(() => cullExcessProcessedSamples(hunt.id))
        .then((cull) => {
          if (cull.culledIds.length > 0) processQueue.refresh();
        });
    }
    void this.#persistCapturePrefs();
  }

  async #audition(id: string): Promise<void> {
    if (getSampleAuditionPlaying() === id) {
      this.#auditionGen++;
      this.#engine?.stop();
      clearSampleAudition();
      return;
    }
    const sample = await db.samples.get(id);
    if (!sample || sample.deletedAt) return;
    this.#engine ??= new TransportEngine();
    const data = await loadSampleAudio(sample);
    if (!data) return;
    const buf = interleavedToAudioBuffer(
      this.#engine.ctx,
      data.pcm,
      data.sampleRate,
      data.channelCount,
    );
    const gen = ++this.#auditionGen;
    setSampleAuditionPlaying(id);
    this.#engine.audition(buf, 5, () => {
      if (gen === this.#auditionGen) clearSampleAudition();
    });
  }

  async #removeExtracted(id: string): Promise<void> {
    await deleteSample(id);
    if (getSampleAuditionPlaying() === id) {
      this.#auditionGen++;
      this.#engine?.stop();
      clearSampleAudition();
    }
    this.#bumpFeed();
  }
}

function micStartErrorMessage(err: unknown): string {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  if (name === "NotAllowedError" || /Permission|NotAllowed/i.test(msg)) {
    return "Micro refusé — autorisez le micro pour ce site (cadenas / permissions).";
  }
  if (name === "NotFoundError" || /NotFound|Requested device/i.test(msg)) {
    return "Aucun micro détecté.";
  }
  if (name === "NotReadableError" || /NotReadable|Could not start/i.test(msg)) {
    return "Micro occupé par une autre appli.";
  }
  if (/addModule|AudioWorklet|worklet/i.test(msg)) {
    return `Worklet audio impossible — rechargez la page (COOP/COEP). ${msg}`;
  }
  return msg || "Impossible d’ouvrir le micro.";
}

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatRate(perMin: number): string {
  if (!Number.isFinite(perMin) || perMin < 0.05) return "0/min";
  if (perMin < 10) return `${perMin.toFixed(1)}/min`;
  return `${Math.round(perMin)}/min`;
}

function levelToDb(peak: number): string {
  if (peak < 1e-6) return "−∞ dB";
  const db = 20 * Math.log10(peak);
  const rounded = Math.max(-60, Math.min(0, db));
  return `${rounded.toFixed(0)} dB`;
}

function isLiveCaptureDeviceState(s: string): boolean {
  return s === "idle" || s === "listening" || s === "suspended";
}

function stateLabel(s: CaptureLiveState, recording: boolean): string {
  switch (s) {
    case "idle":
    case "listening":
      return "";
    case "event:attack":
      return recording ? "événement · attaque" : "détecté · attaque (réglage)";
    case "event:sustain":
      return recording
        ? "événement · sustain (enveloppe)"
        : "détecté · sustain (réglage)";
    case "extracting":
      return "écriture…";
    case "characterized":
      return recording ? "capturé → file processing" : "détecté (non sauvé)";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-capture-page": GlCapturePage;
  }
}
