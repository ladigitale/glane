import {
  CLASS_COLORS,
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
  type CaptureLiveState,
} from "@glane/audio-dsp";
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
} from "../db.js";
import {
  CAPTURE_RATE,
  clampTargetPerMin,
  nextSensitivity,
  pruneCaptureTimes,
} from "../capture-rate-regulator.js";
import { t, tf } from "../i18n/messages.js";
import { navigate } from "../router.js";
import { deleteSample } from "../sample-actions.js";
import { importForHunt } from "../import-for-hunt.js";
import { processQueue } from "../process-queue.js";
import { SAMPLES_CULLED_EVENT } from "../sample-interest-cull.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { captureFormKey } from "../dp-keys.js";
import { glIcon } from "../icon.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import { renderMoreMenu } from "../more-menu.js";
import "../pop-select.js";

type AudioInputOption = { value: string; label: string };

type ExtractedRow = {
  id: string;
  class: Sample["class"];
  tags: string[];
  loopProposed: boolean;
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
        gap: 1.25rem;
        padding: 1.75rem 1rem 1.25rem;
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
        max-height: min(40vh, 22rem);
        overflow: auto;
        overscroll-behavior: contain;
      }
      .rec-wrap sonic-button {
        --sc-btn-height: 5.5rem;
        --sc-_fs: 1.75rem;
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
      .vu {
        display: none;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.85rem 1rem;
        border-radius: 10px;
        background: var(--gl-ink-elevated);
        border: 1px solid color-mix(in srgb, var(--gl-fg-muted) 35%, transparent);
      }
      .vu.on {
        display: flex;
      }
      .vu-track {
        position: relative;
        height: 28px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--gl-ink) 55%, var(--gl-ink-elevated));
        overflow: hidden;
      }
      .vu-track::after {
        content: "";
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          90deg,
          transparent 0,
          transparent calc(10% - 1px),
          color-mix(in srgb, var(--gl-fg-muted) 25%, transparent) calc(10% - 1px),
          color-mix(in srgb, var(--gl-fg-muted) 25%, transparent) 10%
        );
        pointer-events: none;
        opacity: 0.5;
      }
      .vu-rms,
      .vu-peak {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        border-radius: 6px;
        max-width: 100%;
        transition: width 40ms linear;
      }
      .vu-rms {
        background: color-mix(in srgb, var(--gl-accent) 75%, transparent);
      }
      .vu-peak {
        width: 3px;
        background: var(--gl-fg);
        border-radius: 1px;
        transition: left 30ms linear;
      }
      .vu.hot .vu-rms {
        background: color-mix(in srgb, var(--gl-danger) 80%, var(--gl-accent));
      }
      .vu.hot .vu-peak {
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
  @state() private extracted: ExtractedRow[] = [];
  @state() private sampleCount = 0;
  @state() private clockMs = 0;
  @state() private statusText = "";
  @state() private autoGain = false;
  @state() private mlYamnet = true;
  @state() private mlClap = false;
  /** Internal 0–100; auto-tuned toward targetCapturesPerMin. */
  @state() private attackSensitivity = DEFAULT_ATTACK_SENSITIVITY;
  @state() private targetCapturesPerMin = DEFAULT_TARGET_CAPTURES_PER_MIN;
  @state() private measuredRatePerMin = 0;
  @state() private rateModalOpen = false;
  @state() private configModalOpen = false;
  @state() private scoutBlocked = false;
  @state() private audioDeviceId = "";
  @state() private audioInputs: AudioInputOption[] = [];
  @state() private importBusy = false;
  @state() private importRatio = 0;
  @state() private importExtracted = 0;

  #live: LiveCapture | null = null;
  #hunter: EventHunter | null = null;
  #hunt: Session | null = null;
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

  @handle(captureFormKey.autoGain)
  onAutoGainFromForm(v: "1" | null): void {
    const on = v === "1";
    if (on === this.autoGain) return;
    this.autoGain = on;
    this.#live?.setAutoGain(on);
    void this.#persistCapturePrefs();
  }

  #toggleAutoGain = (): void => {
    const on = !this.autoGain;
    this.autoGain = on;
    this.#live?.setAutoGain(on);
    this.#syncCaptureForm();
    void this.#persistCapturePrefs();
  };

  #openRateModal = (): void => {
    this.rateModalOpen = true;
  };

  #openConfigModal = (): void => {
    this.configModalOpen = true;
    void this.#refreshAudioInputs();
  };

  #onRateModalHide = (): void => {
    this.rateModalOpen = false;
  };

  #onConfigModalHide = (): void => {
    this.configModalOpen = false;
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
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      this.#onDeviceChange,
    );
    this.#unsubProc = processQueue.subscribe(() => {
      void this.#refreshExtractedTags();
    });
    await Promise.all([this.#loadLastCaptureName(), this.#loadCapturePrefs()]);
    void this.#startScout();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    window.removeEventListener(SAMPLES_CULLED_EVENT, this.#onSamplesCulled);
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.#onDeviceChange,
    );
    this.#unsubProc?.();
    this.#unsubProc = null;
    this.#importAbort?.abort();
    this.#importAbort = null;
    void this.#shutdownMic();
    super.disconnectedCallback();
  }

  #onSamplesCulled = (ev: Event): void => {
    const ids = (ev as CustomEvent<{ culledIds?: string[] }>).detail?.culledIds;
    if (!ids?.length) return;
    const drop = new Set(ids);
    this.extracted = this.extracted.filter((r) => !drop.has(r.id));
    this.sampleCount = this.extracted.length;
  };

  #onKey = (e: KeyboardEvent): void => {
    if (this.importBusy) return;
    if (
      !isSpaceKey(e) ||
      shouldIgnoreShortcut(e) ||
      this.rateModalOpen ||
      this.configModalOpen
    ) {
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

  async #refreshExtractedTags(): Promise<void> {
    if (this.extracted.length === 0) return;
    const next: ExtractedRow[] = [];
    for (const row of this.extracted) {
      const s = await db.samples.get(row.id);
      if (!s || s.deletedAt) continue;
      next.push({
        id: row.id,
        class: s.class,
        tags: s.tags ?? [],
        loopProposed: Boolean(s.loopProposed),
        interestScore: s.interestScore,
      });
    }
    this.extracted = next;
    this.sampleCount = this.extracted.length;
  }

  async #loadCapturePrefs(): Promise<void> {
    const prefs = await ensurePrefs();
    this.autoGain = prefs.captureAutoGain ?? false;
    this.mlYamnet = prefs.mlYamnet !== false;
    this.mlClap = prefs.mlClap === true;
    this.attackSensitivity =
      prefs.attackSensitivity ?? DEFAULT_ATTACK_SENSITIVITY;
    this.targetCapturesPerMin = clampTargetPerMin(
      prefs.targetCapturesPerMin ?? DEFAULT_TARGET_CAPTURES_PER_MIN,
    );
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
      attackSensitivity: this.attackSensitivity,
      targetCapturesPerMin: this.targetCapturesPerMin,
      captureAudioDeviceId: this.audioDeviceId || undefined,
    });
  }

  #applyHunterSensitivity(): void {
    this.#hunter?.setOpenFloorFactor(
      sensitivityToOpenFloor(this.attackSensitivity),
    );
  }

  #onTargetRateInput = (e: Event): void => {
    const v = Number((e.target as HTMLInputElement).value);
    this.targetCapturesPerMin = clampTargetPerMin(
      Number.isFinite(v) ? v : DEFAULT_TARGET_CAPTURES_PER_MIN,
    );
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
      <div class="-mt-2 flex items-center justify-end">
        ${renderMoreMenu({
          ariaLabel: t("capture.more"),
          items: [
            {
              label: t("capture.config"),
              icon: "settings",
              onClick: this.#openConfigModal,
            },
            {
              label: t("capture.autoGain"),
              icon: "volume-2",
              active: this.autoGain,
              onClick: this.#toggleAutoGain,
            },
            {
              label: t("capture.targetRate"),
              icon: "gauge",
              hint: `${this.targetCapturesPerMin}/min${
                this.micOpen
                  ? ` · ≈${formatRate(this.measuredRatePerMin)}`
                  : ""
              }`,
              onClick: this.#openRateModal,
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
            {
              label: t("capture.toLibrary"),
              icon: "library",
              onClick: () => navigate({ name: "library" }),
            },
          ],
        })}
      </div>
      <input
        id="import-hunt-audio"
        class="sr-only"
        type="file"
        accept=".wav,.wave,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3"
        @change=${(e: Event) => void this.#onImportFile(e)}
      />
      <div
        class="rec-wrap flex min-h-[7.5rem] items-center justify-center py-6 pb-5"
      >
        <sonic-button
          type=${this.listening ? "danger" : "primary"}
          shape="circle"
          size="2xl"
          icon
          ?disabled=${this.importBusy}
          data-aria-label=${this.listening
            ? t("capture.stop")
            : t("capture.start")}
          title=${`${this.listening ? t("capture.stop") : t("capture.start")} (Espace)`}
          @click=${this.#toggle}
        >
          <span class="inline-flex items-center justify-center leading-none"
            >${glIcon(this.listening ? "square" : "mic", {
              size: "xl",
            })}</span
          >
        </sonic-button>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2.5">
          ${this.listening
            ? html`<span
                class="h-3 w-3 rounded-full bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--sc-danger)_30%,transparent)]"
                title="LISTEN"
              ></span>`
            : this.micOpen
              ? html`<span
                  class="h-3 w-3 rounded-full bg-primary/70"
                  title="SCOUT"
                ></span>`
              : nothing}
          <span class="font-mono tabular-nums">${formatClock(this.clockMs)}</span>
          ${this.micOpen
            ? html`<span class="font-mono text-[0.75rem] tabular-nums text-neutral-500"
                >≈${formatRate(this.measuredRatePerMin)}</span
              >`
            : nothing}
        </div>
        <div
          class="vu ${this.micOpen ? "on" : ""} ${hot ? "hot" : ""}"
          role="meter"
          aria-label="Niveau micro"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${Math.round(peakPct)}
        >
          <div
            class="flex items-baseline justify-between gap-3 font-mono text-xs uppercase tracking-wide text-neutral-500"
          >
            <span>Niveau micro</span>
            <span
              class="tabular-nums text-[0.95rem] normal-case tracking-normal text-content ${hot
                ? "hot text-danger"
                : ""}"
              >${peakDb}</span
            >
          </div>
          <div class="vu-track">
            <i class="vu-rms" style="width:${rmsPct}%"></i>
            <i class="vu-peak" style="left:calc(${peakPct}% - 2px)"></i>
          </div>
          <div
            class="flex justify-between font-mono text-[0.65rem] text-neutral-500"
          >
            <span>−∞</span>
            <span>−12</span>
            <span>−6</span>
            <span>0</span>
          </div>
        </div>
        <div
          class="h-2 overflow-hidden rounded bg-neutral-100 ${this.micOpen
            ? "hidden"
            : ""}"
        >
          <i
            class="block h-full ${hot ? "bg-danger" : "bg-primary"}"
            style="width:${peakPct}%"
          ></i>
        </div>
      </div>
      <p>
        ${this.importBusy
          ? t("capture.importBusy")
          : this.listening
            ? t("capture.hintRecording")
            : this.micOpen
              ? t("capture.hintScout")
              : this.scoutBlocked
                ? t("capture.hintScoutBlocked")
                : t("capture.empty")}
      </p>
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
      ${!this.importBusy &&
      this.liveState !== "idle" &&
      this.liveState !== "listening"
        ? html`<p
            class="font-mono text-[0.85rem] text-neutral-500 ${this.liveState.startsWith(
              "event",
            ) || this.liveState === "characterized"
              ? "hot text-primary"
              : ""}"
          >
            ${stateLabel(this.liveState, this.listening)}
          </p>`
        : nothing}
      ${this.statusText && !this.importBusy
        ? html`<p class="font-mono text-[0.8rem] text-neutral-500">
            ${this.statusText}
          </p>`
        : nothing}
      ${this.#renderRateModal()}
      ${this.#renderConfigModal()}
      ${this.warnings.map(
        (w) =>
          html`<sonic-alert status="warning" label="Attention">${w}</sonic-alert>`,
      )}
      <div class="flex flex-col gap-1.5" formDataProvider=${captureFormKey.path}>
        <sonic-input
          class="w-full"
          name="captureName"
          type="text"
          label=${t("capture.name")}
          ?disabled=${this.listening}
        ></sonic-input>
        <span class="font-mono text-[0.8rem] text-neutral-500"
          >${this.sampleCount} sons</span
        >
        <div class="feed flex flex-col gap-1.5">
          ${this.extracted.length === 0
            ? html`<p class="font-mono text-[0.7rem] text-neutral-500">
                ${this.listening
                  ? "Aucun son extrait pour l’instant."
                  : this.micOpen
                    ? t("capture.scoutFeedEmpty")
                    : "Aucun son extrait pour l’instant."}
              </p>`
            : this.extracted.map(
                (row) => html`
                  <div
                    class="grid grid-cols-[8px_1fr_auto_auto] items-center gap-2 rounded-md border-0 bg-neutral-100 py-1.5 px-2.5 text-left font-inherit text-inherit"
                  >
                    <span
                      class="h-7 w-2 rounded-sm"
                      style="background:${CLASS_COLORS[row.class]}"
                    ></span>
                    <button
                      class="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-inherit text-inherit"
                      type="button"
                      @click=${() => navigate({ name: "sample", id: row.id })}
                    >
                      <div>${row.class}${row.loopProposed ? " · boucle" : ""}${
                        row.tags.includes("processing:pending") ||
                        row.tags.includes("processing:running")
                          ? " · processing…"
                          : row.tags.includes("processing:done")
                            ? " · ok"
                            : ""
                      }${
                        row.interestScore != null
                          ? ` · ★${Math.round(row.interestScore * 100)}`
                          : ""
                      }</div>
                      <div class="font-mono text-[0.7rem] text-neutral-500">
                        ${row.tags.join(" · ")}
                      </div>
                    </button>
                    <button
                      class="min-h-touch min-w-touch cursor-pointer rounded-md border-0 bg-transparent font-inherit text-neutral-500 hover:text-danger"
                      type="button"
                      title="Supprimer"
                      @click=${() => void this.#removeExtracted(row.id)}
                    >
                      ${glIcon("x", { size: "sm" })}
                    </button>
                  </div>
                `,
              )}
        </div>
      </div>
      <div class="sr-only" aria-live="polite">${this.statusText}</div>
      ${this.economy
        ? html`<div
            class="economy"
            @click=${() => (this.economy = false)}
            role="button"
            tabindex="0"
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

  #renderRateModal() {
    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${this.rateModalOpen}
        @hide=${this.#onRateModalHide}
      >
        <sonic-modal-title>${t("capture.targetRate")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex w-full flex-col gap-1.5">
            <span
              class="font-mono text-[0.8rem] tabular-nums text-neutral-500"
              >${this.targetCapturesPerMin}/min${this.micOpen
                ? ` · ≈${formatRate(this.measuredRatePerMin)}`
                : ""}</span
            >
            <p class="m-0 text-xs leading-snug text-neutral-500">
              ${t("capture.targetRateHint")}
            </p>
            <input
              id="gl-target-rate"
              class="w-full cursor-pointer accent-primary"
              type="range"
              min=${CAPTURE_RATE.minPerMin}
              max=${CAPTURE_RATE.maxPerMin}
              step="1"
              .value=${String(this.targetCapturesPerMin)}
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
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
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

    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${this.configModalOpen}
        @hide=${this.#onConfigModalHide}
      >
        <sonic-modal-title>${t("capture.configTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex w-full flex-col gap-3">
            <div class="flex flex-col gap-1.5">
              <span class="text-[0.7rem] text-neutral-500"
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
                      <p class="m-0 text-[0.7rem] leading-snug text-neutral-500">
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
                .checked=${this.mlYamnet}
                @change=${this.#onMlYamnetChange}
              />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm text-content">${t("capture.mlYamnet")}</span>
                <span class="text-xs leading-snug text-neutral-500"
                  >${t("capture.mlYamnetHint")}</span
                >
              </span>
            </label>
            <label class="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                class="mt-0.5"
                .checked=${this.mlClap}
                @change=${this.#onMlClapChange}
              />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm text-content">${t("capture.mlClap")}</span>
                <span class="text-xs leading-snug text-neutral-500"
                  >${t("capture.mlClapHint")}</span
                >
              </span>
            </label>
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

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

  #cancelImport = (): void => {
    this.#importAbort?.abort();
  };

  async #onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || this.importBusy) return;
    if (this.listening) {
      this.warnings = [t("capture.importBlocked")];
      return;
    }

    this.warnings = [];
    this.extracted = [];
    this.sampleCount = 0;
    this.importBusy = true;
    this.importRatio = 0;
    this.importExtracted = 0;
    this.liveState = "extracting";

    const abort = new AbortController();
    this.#importAbort = abort;

    await this.#shutdownMic();

    try {
      const projectId = await projectWorkspace.currentId();
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
        signal: abort.signal,
        onProgress: (p) => {
          this.importRatio = p.ratio;
          this.importExtracted = p.extracted;
        },
        onSample: (sample) => {
          this.extracted = [
            {
              id: sample.id,
              class: sample.class,
              tags: sample.tags ?? [],
              loopProposed: Boolean(sample.loopProposed),
            },
            ...this.extracted,
          ].slice(0, 40);
          this.sampleCount = this.extracted.length;
          this.importExtracted = this.sampleCount;
        },
      });

      this.statusText = tf("capture.importDone", { n: String(result.extracted) });
      this.liveState = "characterized";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        this.liveState = "idle";
        this.statusText = "";
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
    this.extracted = [];
    this.sampleCount = 0;
    this.statusText = "";
    this.economy = false;

    const ok = await this.#ensureMic({ scout: false, title: name });
    if (!ok) return;

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
      const title = opts.scout
        ? "Scout"
        : (opts.title ?? this.captureName).trim() || "Capture";
      this.#hunt = await this.#live.start(title, projectId);
      if (!opts.scout) await db.sessions.put(this.#hunt);
      this.#hunter = new EventHunter(this.#live.sampleRate, {
        openFloorFactor: sensitivityToOpenFloor(this.attackSensitivity),
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

      const durationMs = Math.round(
        (extraction.pcm.length / hunt.sampleRate) * 1000,
      );
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
        name: `${this.captureName} · ${extraction.kind} · ${durationMs}ms`,
        favorite: false,
        originVersion: DSP_THRESHOLDS.version,
        loopStartMs: extraction.loopStartMs,
        loopEndMs: extraction.loopEndMs,
        loopXfadeMs: extraction.loopXfadeMs,
        loopScore: extraction.loopScore,
        loopProposed: extraction.loopProposed,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revision: 0,
      };
      await db.samples.put(sample);
      void processQueue.enqueue(id, extraction.kind);
      if (!opts.ignoreStop && this.#stopping) return;

      this.extracted = [
        {
          id,
          class: sample.class,
          tags: sample.tags ?? [],
          loopProposed: Boolean(sample.loopProposed),
        },
        ...this.extracted,
      ].slice(0, 40);
      this.sampleCount = this.extracted.length;
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
      void db.sessions.put({
        ...hunt,
        endedAt: ended,
        durationMs: Math.round(performance.now() - this.#recordStartedAt),
        status: "ready",
        updatedAt: ended,
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
      void db.sessions.put({
        ...hunt,
        endedAt: ended,
        durationMs:
          stopped?.durationMs ??
          Math.round(performance.now() - this.#recordStartedAt),
        status: "ready",
        updatedAt: ended,
      });
    }
    void this.#persistCapturePrefs();
  }

  async #removeExtracted(id: string): Promise<void> {
    await deleteSample(id);
    this.extracted = this.extracted.filter((r) => r.id !== id);
    this.sampleCount = this.extracted.length;
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
