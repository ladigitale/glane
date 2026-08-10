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
import { t } from "../i18n/messages.js";
import { navigate } from "../router.js";
import { deleteSample } from "../sample-actions.js";
import { processQueue } from "../process-queue.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { captureFormKey } from "../dp-keys.js";
import { glIcon } from "../icon.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import { renderMoreMenu } from "../more-menu.js";

type ExtractedRow = {
  id: string;
  class: Sample["class"];
  tags: string[];
  loopProposed: boolean;
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

  @state() private listening = false;
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
  /** Internal 0–100; auto-tuned toward targetCapturesPerMin. */
  @state() private attackSensitivity = DEFAULT_ATTACK_SENSITIVITY;
  @state() private targetCapturesPerMin = DEFAULT_TARGET_CAPTURES_PER_MIN;
  @state() private measuredRatePerMin = 0;
  @state() private rateModalOpen = false;

  #live: LiveCapture | null = null;
  #hunter: EventHunter | null = null;
  #hunt: Session | null = null;
  #analyseTimer: number | null = null;
  #clockTimer: number | null = null;
  #startedAt = 0;
  #analysing = false;
  #stopping = false;
  #unsubProc: (() => void) | null = null;
  #captureTimes: number[] = [];
  #lastRateAdjustMs = 0;

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

  #onRateModalHide = (): void => {
    this.rateModalOpen = false;
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
    this.#unsubProc = processQueue.subscribe(() => {
      void this.#refreshExtractedTags();
    });
    await Promise.all([this.#loadLastCaptureName(), this.#loadCapturePrefs()]);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    this.#unsubProc?.();
    this.#unsubProc = null;
    this.#stopping = true;
    if (this.#analyseTimer != null) window.clearInterval(this.#analyseTimer);
    if (this.#clockTimer != null) window.clearInterval(this.#clockTimer);
    void this.#live?.stop();
    super.disconnectedCallback();
  }

  #onKey = (e: KeyboardEvent): void => {
    if (!isSpaceKey(e) || shouldIgnoreShortcut(e) || this.rateModalOpen) return;
    e.preventDefault();
    void this.#toggle();
  };

  #onProjectChange = (): void => {
    void this.#loadLastCaptureName();
  };

  async #refreshExtractedTags(): Promise<void> {
    if (this.extracted.length === 0) return;
    const next = await Promise.all(
      this.extracted.map(async (row) => {
        const s = await db.samples.get(row.id);
        if (!s) return row;
        return {
          id: row.id,
          class: s.class,
          tags: s.tags ?? [],
          loopProposed: Boolean(s.loopProposed),
        };
      }),
    );
    this.extracted = next;
  }

  async #loadCapturePrefs(): Promise<void> {
    const prefs = await ensurePrefs();
    this.autoGain = prefs.captureAutoGain ?? false;
    this.attackSensitivity =
      prefs.attackSensitivity ?? DEFAULT_ATTACK_SENSITIVITY;
    this.targetCapturesPerMin = clampTargetPerMin(
      prefs.targetCapturesPerMin ?? DEFAULT_TARGET_CAPTURES_PER_MIN,
    );
    this.#syncCaptureForm();
  }

  async #persistCapturePrefs(): Promise<void> {
    const prefs = await ensurePrefs();
    await db.prefs.put({
      ...prefs,
      captureAutoGain: this.autoGain,
      attackSensitivity: this.attackSensitivity,
      targetCapturesPerMin: this.targetCapturesPerMin,
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
    if (!this.listening || this.#startedAt <= 0) return;
    this.#captureTimes = pruneCaptureTimes(this.#captureTimes, nowMs);
    const next = nextSensitivity({
      sensitivity: this.attackSensitivity,
      targetPerMin: this.targetCapturesPerMin,
      timestamps: this.#captureTimes,
      nowMs,
      startedAtMs: this.#startedAt,
      lastAdjustMs: this.#lastRateAdjustMs,
    });
    this.measuredRatePerMin = next.ratePerMin;
    this.#lastRateAdjustMs = next.lastAdjustMs;
    if (!next.adjusted) return;
    this.attackSensitivity = next.sensitivity;
    this.#applyHunterSensitivity();
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
              label: t("capture.autoGain"),
              icon: "volume-2",
              active: this.autoGain,
              onClick: this.#toggleAutoGain,
            },
            {
              label: t("capture.targetRate"),
              icon: "gauge",
              hint: `${this.targetCapturesPerMin}/min${
                this.listening
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
              label: t("capture.toLibrary"),
              icon: "library",
              onClick: () => navigate({ name: "library" }),
            },
          ],
        })}
      </div>
      <div
        class="rec-wrap flex min-h-[7.5rem] items-center justify-center py-6 pb-5"
      >
        <sonic-button
          type=${this.listening ? "danger" : "primary"}
          shape="circle"
          size="2xl"
          icon
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
            : nothing}
          <span class="font-mono tabular-nums">${formatClock(this.clockMs)}</span>
        </div>
        <div
          class="vu ${this.listening ? "on" : ""} ${hot ? "hot" : ""}"
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
          class="h-2 overflow-hidden rounded bg-neutral-100 ${this.listening
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
        ${this.listening
          ? "Écoute continue — buffer glissant, pas d’enregistrement de session."
          : "Ouvre le micro. Les sons caractérisés sont extraits et taggés."}
      </p>
      ${this.liveState !== "idle" && this.liveState !== "listening"
        ? html`<p
            class="font-mono text-[0.85rem] text-neutral-500 ${this.liveState.startsWith(
              "event",
            ) || this.liveState === "characterized"
              ? "hot text-primary"
              : ""}"
          >
            ${stateLabel(this.liveState)}
          </p>`
        : nothing}
      ${this.#renderRateModal()}
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
                Aucun son extrait pour l’instant.
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
              >${this.targetCapturesPerMin}/min${this.listening
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

  #toggle = async (): Promise<void> => {
    if (this.listening) {
      await this.#stop();
      return;
    }
    const name =
      (this.captureName ?? "").trim() ||
      `Capture ${new Date().toLocaleString("fr-FR")}`;
    this.captureName = name;
    this.#syncCaptureForm();
    this.warnings = [];
    this.extracted = [];
    this.sampleCount = 0;
    this.statusText = "";
    this.liveState = "listening";
    this.#captureTimes = [];
    this.#lastRateAdjustMs = 0;
    this.measuredRatePerMin = 0;

    if (!window.isSecureContext) {
      this.liveState = "idle";
      this.warnings = [
        "Contexte non sécurisé — ouvrez via localhost ou HTTPS (pas une IP http://).",
      ];
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.liveState = "idle";
      this.warnings = ["API micro indisponible dans ce navigateur."];
      return;
    }

    this.#live = new LiveCapture(
      {
        onLevel: (l) => {
          this.level = l;
        },
        onWarning: (m) => {
          this.warnings = [...this.warnings, m];
        },
        onState: (s) => {
          this.statusText = s;
        },
      },
      { autoGain: this.autoGain },
    );

    this.#stopping = false;
    try {
      const projectId = await projectWorkspace.currentId();
      this.#hunt = await this.#live.start(name, projectId);
      await db.sessions.put(this.#hunt);
      this.#hunter = new EventHunter(this.#live.sampleRate, {
        openFloorFactor: sensitivityToOpenFloor(this.attackSensitivity),
      });
      this.listening = true;
      this.#startedAt = performance.now();
      this.#lastRateAdjustMs = this.#startedAt;
      this.#analyseTimer = window.setInterval(() => void this.#tick(), 150);
      this.#clockTimer = window.setInterval(() => {
        this.clockMs = Math.round(performance.now() - this.#startedAt);
      }, 200);
    } catch (err) {
      void this.#live.stop().catch(() => undefined);
      this.#live = null;
      this.#hunt = null;
      this.#hunter = null;
      this.listening = false;
      this.liveState = "idle";
      this.warnings = [micStartErrorMessage(err)];
      console.error("[glane] capture start failed", err);
    }
  };

  async #tick(): Promise<void> {
    if (
      this.#stopping ||
      this.#analysing ||
      !this.#hunter ||
      !this.#live ||
      !this.#hunt
    ) {
      return;
    }
    const rolling = this.#live.rolling;
    if (!rolling || rolling.filled < 64) return;

    this.#analysing = true;
    let extraction = null as ReturnType<EventHunter["analyse"]>["extraction"];
    try {
      const maxSamples = Math.floor(
        (DSP_THRESHOLDS.live.snapshotMs / 1000) * this.#live.sampleRate,
      );
      const win = rolling.snapshotRecent(maxSamples);
      const nowMs = performance.now();
      const result = this.#hunter.analyse(win, nowMs);
      this.liveState = result.state;
      extraction = result.extraction;
      this.#regulateCaptureRate(nowMs);
    } finally {
      this.#analysing = false;
    }

    if (!extraction || this.#stopping) return;
    void this.#persistExtraction(extraction);
  }

  async #persistExtraction(
    extraction: NonNullable<ReturnType<EventHunter["analyse"]>["extraction"]>,
    opts: { ignoreStop?: boolean } = {},
  ): Promise<void> {
    if ((!opts.ignoreStop && this.#stopping) || !this.#hunt) return;
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
      const nowMs = performance.now();
      this.#captureTimes = pruneCaptureTimes(
        [...this.#captureTimes, nowMs],
        nowMs,
      );
      this.#regulateCaptureRate(nowMs);
      this.liveState = "characterized";
      this.statusText = `capturé · file processing`;
      if (navigator.vibrate) navigator.vibrate(10);
    } catch {
      this.liveState = "listening";
    }
  }

  async #stop(): Promise<void> {
    this.#stopping = true;
    this.listening = false;
    this.liveState = "idle";
    this.economy = false;
    if (this.#analyseTimer != null) window.clearInterval(this.#analyseTimer);
    if (this.#clockTimer != null) window.clearInterval(this.#clockTimer);
    this.#analyseTimer = null;
    this.#clockTimer = null;

    const flushed = this.#hunter?.flush() ?? null;
    this.#hunter = null;
    if (flushed && this.#hunt) {
      void this.#persistExtraction(flushed, { ignoreStop: true });
    }

    const live = this.#live;
    this.#live = null;
    const hunt = await live?.stop();
    this.#hunt = null;
    if (hunt) void db.sessions.put(hunt);
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

function stateLabel(s: CaptureLiveState): string {
  switch (s) {
    case "idle":
    case "listening":
      return "";
    case "event:attack":
      return "événement · attaque";
    case "event:sustain":
      return "événement · sustain (enveloppe)";
    case "extracting":
      return "écriture…";
    case "characterized":
      return "capturé → file processing";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-capture-page": GlCapturePage;
  }
}
