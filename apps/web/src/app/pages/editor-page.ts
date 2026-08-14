import {
  CLASS_COLORS,
  DEFAULT_TRACK_FX,
  ExprRoleSchema,
  asSampleIndex,
  createEntityId,
  nowIso,
  trackFxIsActive,
  trackFxNeedsBus,
  type ExprRole,
  type Sample,
  type TrackFx,
} from "@glane/core-model";
import {
  autoCropPcm,
  durationMsFromPcm,
  frameCount,
  interleavedToAudioBuffer,
  mapInterleavedChannels,
  noiseGate,
  rotatePcm,
  sliceFrames,
  softCompress,
  toMonoPcm,
} from "@glane/audio-dsp";
import { TransportEngine, bakeTrackFx } from "@glane/audio-engine";
import { sampleOpfs } from "@glane/audio-io";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwind from "../../css/tailwind";
import { handle } from "@supersoniks/concorde/decorators";
import { SonicToast } from "@supersoniks/concorde/toast";
import { set } from "@supersoniks/concorde/utils";
import { db } from "../db.js";
import { t, tf } from "../i18n/messages.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { SAMPLE_PROCESSED_EVENT, processQueue, isProcessingBusy, isProcessingError } from "../process-queue.js";
import { navigate } from "../router.js";
import {
  deleteSample,
  renameSample,
  toggleFavorite,
} from "../sample-actions.js";
import { demucsQueue } from "../ml/demucs-queue.js";
import { ML_TAG } from "@glane/audio-ml";
import {
  applyOps,
  emptyEditorState,
  renderNormalized,
  type EditorOp,
  type EditorState,
} from "../edit-ops.js";
import { editorFormKey } from "../dp-keys.js";
import { glDialog } from "../dialog.js";
import { glIcon } from "../icon.js";
import { renderMoreMenu, type MoreMenuEntry } from "../more-menu.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import { formatClock } from "../timeline/timeline.js";
import type { TransportAction } from "../transport-bar.js";
import "../seek-bar.js";
import "../track-fx-control.js";
import type { GlEditTimeline } from "../timeline/edit-timeline.js";
import "../timeline/edit-timeline.js";
import "../transport-bar.js";
import "../sample-info.js";

type EditCheckpoint = {
  master: Float32Array;
  masterDirty: boolean;
  channelCount: number;
  ops: EditorOp[];
  hasNormalize: boolean;
  dirty: boolean;
  selStart: number;
  selEnd: number;
  playheadSample: number;
  stretchModeUi: "preserve-pitch" | "resample";
  previewFx: TrackFx;
};

function concatInterleaved(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function toast(
  text: string,
  status: "" | "success" | "error" | "warning" | "info" = "info",
): void {
  SonicToast.add({ text, status });
}

@customElement("gl-editor-page")
export class GlEditorPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        padding-left: max(1rem, env(safe-area-inset-left));
        padding-right: max(1rem, env(safe-area-inset-right));
        padding-bottom: max(1rem, env(safe-area-inset-bottom));
        max-width: 100%;
        box-sizing: border-box;
        overflow-x: hidden;
        min-height: 100%;
      }
      gl-edit-timeline {
        display: block;
        width: 100%;
        min-width: 0;
        height: 280px;
        min-height: 280px;
        flex: none;
      }
    `,
  ];

  @property({ type: String }) sampleId = "";

  @state() private sample: Sample | null = null;
  @state() private playing = false;
  @state() private state: EditorState = emptyEditorState(0);
  @state() private ops: EditorOp[] = [];
  @state() private selStart = 0;
  @state() private selEnd = 0;
  @state() private playheadSample = 0;
  @state() private hasNormalize = false;
  @state() private stretchModeUi: "preserve-pitch" | "resample" =
    "preserve-pitch";
  @state() private stretchModalOpen = false;
  @state() private dynamicsModalOpen = false;
  @state() private docsModalOpen = false;
  @state() private forceRoleModalOpen = false;
  @state() private stretchDraft = 100;
  @state() private dynamicsMode: "gate" | "compress" = "gate";
  @state() private dynamicsThresholdDb = -36;
  @state() private dynamicsAttackMs = 5;
  @state() private dynamicsReleaseMs = 80;
  @state() private dynamicsRatio = 3;
  @state() private dynamicsMakeupDb = 3;

  @state() private previewFx: TrackFx = { ...DEFAULT_TRACK_FX };
  @state() private viewStart = 0;
  @state() private viewEnd = 0;
  @state() private viewMode: "global" | "vue" = "global";
  @state() private applyingFx = false;
  @state() private separating = false;
  @state() private separateProgress = "";
  @state() private hasClipboard = false;
  @state() private dirty = false;
  @state() private historyLen = 0;
  /** Lane tool: circular-shift waveform in the file. */
  @state() private rotateTool = false;
  @state() private infoOpen = false;

  #engine: TransportEngine | null = null;
  /** Working PCM — @state so `.pcm` reaches the timeline after async load. */
  @state() private master: Float32Array | null = null;
  /** True when working PCM diverges from OPFS (cut/paste/silence/FX bake). */
  #masterDirty = false;
  #viewBuffer: AudioBuffer | null = null;
  #channelCount = 1;
  #sampleRate = 48_000;
  #raf = 0;
  /** Manual seek-bar / playhead scrub — owns position over transport RAF. */
  #scrubbing = false;
  /** Bumps on stop / superseding restart — only latest play arm may start. */
  #playGen = 0;
  /** In-memory PCM clipboard for copy / cut / paste (AudioRoom-style). */
  #clipboard: Float32Array | null = null;
  /** Skip leave prompt after delete (sample already gone). */
  #skipLeaveGuard = false;
  #unsubProc: (() => void) | null = null;
  #history: EditCheckpoint[] = [];

  get isDirty(): boolean {
    return this.dirty;
  }

  @handle(editorFormKey.name)
  onRenameFromForm(name: string): void {
    if (!this.sampleId || name == null) return;
    void renameSample(this.sampleId, name).then((updated) => {
      if (updated) this.sample = updated;
    });
  }

  override firstUpdated(): void {
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener(SAMPLE_PROCESSED_EVENT, this.#onSampleProcessed);
    window.addEventListener("beforeunload", this.#onBeforeUnload);
    this.#unsubProc = processQueue.subscribe((s) => {
      if (
        !this.sampleId ||
        this.dirty ||
        (s.currentSampleId !== this.sampleId &&
          !isProcessingBusy(this.sample?.tags) &&
          !isProcessingError(this.sample?.tags))
      ) {
        return;
      }
      void db.samples.get(this.sampleId).then((fresh) => {
        if (fresh) this.sample = fresh;
      });
    });
    void this.#load();
  }

  #onKey = (e: KeyboardEvent): void => {
    if (!isSpaceKey(e) || shouldIgnoreShortcut(e)) return;
    e.preventDefault();
    void this.#handleTransport(this.playing ? "pause" : "play");
  };

  #onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  };

  #onSampleProcessed = (ev: Event): void => {
    const id = (ev as CustomEvent<{ sampleId?: string }>).detail?.sampleId;
    if (!id || id !== this.sampleId || this.dirty) return;
    void this.#load();
  };

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("sampleId") && this.sampleId) void this.#load();
  }

  override render() {
    const selL = Math.min(this.selStart, this.selEnd);
    const selR = Math.max(this.selStart, this.selEnd);
    const hasSel = selR > selL + 1;
    const waveColor = this.sample
      ? CLASS_COLORS[this.sample.class]
      : CLASS_COLORS.texture;

    const clockMs = (this.playheadSample / this.#sampleRate) * 1000;

    return html`
      <div
        class="flex flex-wrap items-center gap-2"
        formDataProvider=${editorFormKey.path}
      >
        <sonic-input
          class="rename min-w-0 max-w-full flex-[1_1_10rem]"
          name="name"
          type="text"
          placeholder="Nom du son"
        ></sonic-input>
        <sonic-button
          shape="circle"
          variant="ghost"
          type="neutral"
          size="sm"
          icon
          data-aria-label=${t("sample.info")}
          @click=${() => {
            this.infoOpen = true;
          }}
        >
          ${glIcon("info", { size: "sm" })}
        </sonic-button>
        ${renderMoreMenu({
          ariaLabel: t("editor.more"),
          items: this.#editMenuItems(hasSel),
        })}
      </div>
      ${this.#processingMeta()}
      <p class="font-mono text-xs text-neutral-500">
        ${this.state.endSample - this.state.startSample} samples
        ${Math.abs(this.state.stretchRatio - 1) > 1e-3
          ? ` · stretch ×${this.state.stretchRatio.toFixed(2)}`
          : ""}
        ${hasSel ? ` · boucle ${selR - selL}` : ""}
      </p>
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <gl-track-fx-control
          class="text-[0.85rem]"
          size="sm"
          .fx=${this.previewFx}
          showApply
          applyLabel=${hasSel
            ? t("editor.fxApplySel")
            : t("editor.fxApplyAll")}
          ?applyDisabled=${!trackFxIsActive(this.previewFx) || this.applyingFx}
          @gl-fx=${this.#onPreviewFxEvent}
          @gl-fx-apply=${this.#onFxApply}
        ></gl-track-fx-control>
        <sonic-button
          size="sm"
          variant="outline"
          type=${this.rotateTool ? "primary" : "neutral"}
          ?disabled=${this.applyingFx || !this.master}
          @click=${() => {
            this.rotateTool = !this.rotateTool;
          }}
          >${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}${t(
            "editor.rotate",
          )}</sonic-button
        >
      </div>
      <gl-edit-timeline
        .pcm=${this.master
          ? toMonoPcm(this.master, this.#channelCount)
          : null}
        .sampleRate=${this.#sampleRate}
        .label=${this.sample?.userName ?? this.sample?.name ?? "Sample"}
        .color=${waveColor}
        .startSample=${this.state.startSample}
        .endSample=${this.state.endSample}
        .selStart=${this.selStart}
        .selEnd=${this.selEnd}
        .playheadSample=${this.state.startSample + this.playheadSample}
        .playing=${this.playing}
        ?rotateMode=${this.rotateTool}
        @gl-trim=${this.#onTimelineTrim}
        @gl-sel=${this.#onTimelineSel}
        @gl-seek=${this.#onTimelineSeek}
        @gl-view=${this.#onTimelineView}
        @gl-rotate=${this.#onTimelineRotate}
        @gl-scrub-start=${this.#onScrubStart}
        @gl-scrub-end=${this.#onScrubEnd}
      ></gl-edit-timeline>
      <div class="mt-[0.15rem] mb-[0.35rem] flex items-center gap-[0.35rem]">
        <gl-seek-bar
          class="min-w-0 flex-1"
          .value=${this.playheadSample}
          .max=${Math.max(1, this.state.endSample - this.state.startSample)}
          .viewStart=${this.viewStart}
          .viewEnd=${this.viewEnd}
          ?disabled=${!this.#viewBuffer}
          @gl-seek-start=${this.#onSeekBarStart}
          @gl-seek=${this.#onSeekBar}
          @gl-seek-end=${this.#onSeekBarEnd}
        ></gl-seek-bar>
        <span
          class="min-w-[2.6rem] shrink-0 select-none text-right font-mono text-[0.6rem] tracking-wide text-neutral-500 lowercase"
          title=${t("tl.viewModeHint")}
          >${this.viewMode === "vue" ? t("tl.view") : t("tl.global")}</span
        >
      </div>
      <gl-transport-bar class="block" .playing=${this.playing}
        .clock=${formatClock(clockMs)}
        ?disabled=${!this.#viewBuffer}
        @gl-transport=${this.#onTransport}
      ></gl-transport-bar>
      ${this.#renderStretchModal()}
      ${this.#renderDynamicsModal()}
      ${this.#renderForceRoleModal()}
      ${this.#renderDocsModal()}
      <gl-sample-info
        .sampleId=${this.sampleId}
        .visible=${this.infoOpen}
        @hide=${() => {
          this.infoOpen = false;
        }}
      ></gl-sample-info>
      <div class="max-h-24 overflow-auto font-mono text-[0.7rem] text-neutral-500">
        ops: ${this.ops.length === 0 ? "(aucune)" : this.ops.map((o) => o.op).join(" → ")}
        ${this.historyLen > 0 ? ` · undo×${this.historyLen}` : ""}
      </div>
    `;
  }

  #processingMeta() {
    if (this.separating && this.separateProgress) {
      return html`<sonic-alert
        class="mb-1"
        status="info"
        label=${this.separateProgress}
      ></sonic-alert>`;
    }
    const tags = this.sample?.tags ?? [];
    if (isProcessingBusy(tags)) {
      return html`<p class="font-mono text-xs text-neutral-500">
        ${t("library.processing")}
      </p>`;
    }
    if (isProcessingError(tags)) {
      return html`<div class="mb-1 flex flex-wrap items-center gap-2">
        <sonic-alert
          class="min-w-0 flex-1"
          status="error"
          label=${t("library.processingError")}
        ></sonic-alert>
        <sonic-button
          size="sm"
          variant="outline"
          type="warning"
          @click=${() => void this.#retryProcess()}
        >
          ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
          ${t("library.retryProcess")}
        </sonic-button>
      </div>`;
    }
    return nothing;
  }

  async #retryProcess(): Promise<void> {
    if (!this.sampleId) return;
    await processQueue.reanalyzeSample(this.sampleId);
    this.sample = (await db.samples.get(this.sampleId)) ?? this.sample;
  }

  async #load(): Promise<void> {
    this.sample = (await db.samples.get(this.sampleId)) ?? null;
    this.#history = [];
    this.historyLen = 0;
    this.previewFx = { ...DEFAULT_TRACK_FX };
    this.stretchModalOpen = false;
    this.dynamicsModalOpen = false;
    this.docsModalOpen = false;
    this.forceRoleModalOpen = false;
    set(editorFormKey, {
      name: this.sample?.userName ?? this.sample?.name ?? "",
    });
    this.#engine = new TransportEngine();
    this.#sampleRate = this.#engine.sampleRate;

    let master: Float32Array | null = null;
    if (this.sample) {
      const data = await loadSampleAudio(this.sample);
      if (data) {
        this.#sampleRate = data.sampleRate;
        this.#channelCount = data.channelCount ?? 1;
        master = data.pcm;
      }
    }
    if (!master || master.length === 0) {
      this.#channelCount = 1;
      const n = Math.floor(this.#sampleRate * 0.5);
      master = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        master[i] =
          Math.sin((2 * Math.PI * 220 * i) / this.#sampleRate) *
          Math.sin((Math.PI * i) / n) *
          0.3;
      }
      toast("PCM OPFS indisponible — ton demo", "warning");
    }

    this.master = master;
    this.#masterDirty = false;
    this.dirty = false;
    this.playheadSample = 0;
    const saved = await db.ops
      .where("entityId")
      .equals(this.sampleId)
      .sortBy("clientSeq");
    this.ops = saved
      .filter((o) => o.entityType === "sample_edit")
      .map((o) => o.payload as unknown as EditorOp);
    this.hasNormalize = this.ops.some((o) => o.op === "normalize_peak");
    const masterFrames = frameCount(master, this.#channelCount);
    this.state = applyOps(masterFrames, this.ops);
    if (this.sample?.loopStartMs != null && this.sample.loopEndMs != null && this.ops.length === 0) {
      const ls = Math.floor((this.sample.loopStartMs / 1000) * this.#sampleRate);
      const le = Math.floor((this.sample.loopEndMs / 1000) * this.#sampleRate);
      this.ops = [
        {
          op: "loop",
          loopStartSample: ls,
          loopEndSample: le,
          xfadeMs: this.sample.loopXfadeMs ?? 40,
        },
      ];
      this.state = applyOps(masterFrames, this.ops);
    }
    if (this.state.loopStartSample != null && this.state.loopEndSample != null) {
      this.selStart = this.state.loopStartSample;
      this.selEnd = this.state.loopEndSample;
    } else {
      this.selStart = this.state.startSample;
      this.selEnd = this.state.endSample;
    }
    this.#rebuildView();
  }

  #rebuildView(): void {
    if (!this.master || !this.#engine) return;
    const pcm = renderNormalized(
      this.master,
      this.state,
      this.#sampleRate,
      this.hasNormalize,
      -0.3,
      this.#channelCount,
    );
    this.#viewBuffer = interleavedToAudioBuffer(
      this.#engine.ctx,
      pcm,
      this.#sampleRate,
      this.#channelCount,
    );
  }

  #onTimelineTrim = (
    e: CustomEvent<{
      startSample: number;
      endSample: number;
      commit: boolean;
    }>,
  ): void => {
    const { startSample, endSample, commit } = e.detail;
    if (commit) {
      void this.#pushOp({ op: "trim", startSample, endSample });
      return;
    }
    this.state = { ...this.state, startSample, endSample };
    this.#rebuildView();
    this.#syncLiveLoop();
  };

  #onTimelineSel = (
    e: CustomEvent<{
      selStart: number;
      selEnd: number;
      commit: boolean;
    }>,
  ): void => {
    this.selStart = e.detail.selStart;
    this.selEnd = e.detail.selEnd;
    this.#syncLiveLoop();
    if (e.detail.commit) void this.#commitSelectionAsLoop();
  };

  #onTimelineSeek = (e: CustomEvent<{ sample: number }>): void => {
    this.#seekTo(e.detail.sample);
  };

  #onTimelineView = (
    e: CustomEvent<{ start: number; end: number; follow: boolean }>,
  ): void => {
    const origin = this.state.startSample;
    const max = Math.max(1, this.state.endSample - origin);
    const a = e.detail.start - origin;
    const b = e.detail.end - origin;
    this.viewStart = Math.max(0, Math.min(max, a));
    this.viewEnd = Math.max(this.viewStart, Math.min(max, b));
    this.viewMode = e.detail.follow ? "global" : "vue";
  };

  #onTimelineRotate = (
    e: CustomEvent<{ offsetSamples: number }>,
  ): void => {
    void this.#commitRotate(e.detail.offsetSamples);
  };

  async #commitRotate(offsetSamples: number): Promise<void> {
    const offset = Math.round(offsetSamples);
    if (!offset) {
      this.#editTimeline()?.clearRotateOffset();
      return;
    }
    const before = this.master;
    const ch = this.#channelCount;
    // Loop / selection stays at the same global sample times; only PCM wraps.
    await this.#mutateView((view, sel) => {
      const n = frameCount(view, ch);
      if (n === 0) return null;
      const pcm = mapInterleavedChannels(view, ch, (plane) =>
        rotatePcm(plane, offset),
      );
      return {
        pcm,
        status: t("editor.rotateDone"),
        selStart: sel?.a ?? 0,
        selEnd: sel?.b ?? 0,
      };
    });
    if (this.master === before) this.#editTimeline()?.clearRotateOffset();
  }

  #onScrubStart = (): void => {
    this.#scrubbing = true;
  };

  #onScrubEnd = (): void => {
    this.#scrubbing = false;
    this.#editTimeline()?.followPlayheadNow();
  };

  #onSeekBarStart = (): void => {
    this.#scrubbing = true;
  };

  #onSeekBar = (e: CustomEvent<{ value: number }>): void => {
    this.#seekTo(this.state.startSample + e.detail.value);
  };

  #onSeekBarEnd = (): void => {
    this.#scrubbing = false;
    this.#editTimeline()?.followPlayheadNow();
  };

  /** Push selection → transport loop bounds used by playheadSample(). */
  #syncLiveLoop(): void {
    if (!this.#engine || !this.playing) return;
    const { loopA, loopB } = this.#loopRel();
    this.#engine.setLoop(true, asSampleIndex(loopA), asSampleIndex(loopB));
  }

  #editTimeline(): GlEditTimeline | null {
    return this.renderRoot.querySelector("gl-edit-timeline");
  }

  #seekTo(absSample: number): void {
    const len = this.#viewBuffer?.length ?? 1;
    const rel = Math.max(
      0,
      Math.min(len - 1, absSample - this.state.startSample),
    );
    this.playheadSample = rel;
    if (this.playing && this.#engine) {
      this.#engine.seek(asSampleIndex(rel));
    }
    this.#editTimeline()?.followPlayheadNow();
  }

  #armPlayhead(_fromRel: number): void {
    cancelAnimationFrame(this.#raf);
    const tick = () => {
      if (!this.playing || !this.#engine || !this.#viewBuffer) return;
      if (!this.#scrubbing) {
        this.playheadSample = this.#engine.playheadSample();
      }
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #haltPlay(resetTo?: number): void {
    if (this.playing && this.#engine) {
      this.playheadSample = this.#engine.playheadSample();
    }
    this.#playGen++;
    this.#engine?.stop();
    this.playing = false;
    cancelAnimationFrame(this.#raf);
    if (resetTo != null) this.playheadSample = resetTo;
    this.#engine?.seek(asSampleIndex(this.playheadSample));
  }

  #onTransport = (e: CustomEvent<{ action: TransportAction }>): void => {
    void this.#handleTransport(e.detail.action);
  };

  async #handleTransport(action: TransportAction): Promise<void> {
    if (!this.#engine || !this.#viewBuffer) return;
    if (action === "pause") {
      this.#haltPlay();
      return;
    }
    const { loopA, loopB } = this.#loopRel();
    let from = this.playheadSample;
    if (from < loopA || from >= loopB - 2) from = loopA;
    await this.#restartPlayFrom(from);
  }

  async #restartPlay(): Promise<void> {
    if (!this.#viewBuffer) return;
    const { loopA, loopB } = this.#loopRel();
    let from = this.playheadSample;
    if (from < loopA || from >= loopB - 2) from = loopA;
    await this.#restartPlayFrom(from);
  }

  async #restartPlayFrom(from: number): Promise<void> {
    if (!this.#engine || !this.#viewBuffer) return;
    const gen = ++this.#playGen;
    await this.#engine.ctx.resume();
    if (gen !== this.#playGen) return;
    this.#rebuildView();
    if (!this.#viewBuffer || gen !== this.#playGen) return;
    const { loopA, loopB } = this.#loopRel();
    const offset = Math.max(loopA, Math.min(loopB - 1, Math.floor(from)));
    // Full-loop clip so seek() can re-arm anywhere in the loop.
    const previewLive = trackFxNeedsBus(this.previewFx);
    if (previewLive) {
      this.#engine.setTrackInsert({
        id: "edit",
        gain: 1,
        pan: 0,
        fx: this.previewFx,
        bpm: 120,
      });
    }
    const attackMs = Math.max(0, this.previewFx.attackMs ?? 0);
    this.#engine.setClips([
      {
        id: "edit",
        trackId: previewLive ? "edit" : undefined,
        buffer: this.#viewBuffer,
        startSample: asSampleIndex(loopA),
        durationSamples: asSampleIndex(Math.max(1, loopB - loopA)),
        offsetSamples: asSampleIndex(loopA),
        gain: 1,
        fadeInMs: Math.max(Math.min(5, this.state.fadeInMs), attackMs),
        fadeOutMs: 0,
        loop: true,
        loopSustain: true,
        loopStartSec: loopA / this.#sampleRate,
        loopEndSec: loopB / this.#sampleRate,
      },
    ]);
    this.#engine.setLoop(true, asSampleIndex(loopA), asSampleIndex(loopB));
    if (gen !== this.#playGen) return;
    this.#engine.play(asSampleIndex(offset));
    this.playing = true;
    this.playheadSample = offset;
    this.#armPlayhead(offset);
  }

  #editMenuItems(hasSel: boolean): MoreMenuEntry[] {
    const busy = this.applyingFx || this.separating;
    const isStem = (this.sample?.tags ?? []).some((tag) =>
      tag.startsWith("stem:"),
    );
    return [
      {
        label: t("editor.undo"),
        icon: "undo",
        disabled: this.historyLen === 0,
        onClick: () => void this.#undo(),
      },
      { section: t("editor.sectionClipboard") },
      {
        label: t("editor.copy"),
        icon: "copy",
        disabled: !hasSel,
        onClick: () => this.#copySelection(),
      },
      {
        label: t("editor.cut"),
        icon: "scissors",
        disabled: !hasSel || busy,
        onClick: () => this.#cutSelection(),
      },
      {
        label: t("editor.paste"),
        icon: "clipboard",
        disabled: !this.hasClipboard || busy,
        onClick: () => this.#pasteClipboard(),
      },
      { section: t("editor.sectionTransform") },
      {
        label: t("editor.silence"),
        icon: "volume-x",
        disabled: !hasSel || busy,
        onClick: () => this.#silenceSelection(),
      },
      {
        label: t("editor.fadeIn"),
        icon: "trending-up",
        disabled: !hasSel || busy,
        onClick: () => this.#fadeInSelection(),
      },
      {
        label: t("editor.fadeOut"),
        icon: "trending-down",
        disabled: !hasSel || busy,
        onClick: () => this.#fadeOutSelection(),
      },
      {
        label: t("editor.crop"),
        icon: "crop",
        disabled: !hasSel,
        onClick: () => void this.#cropToSelection(),
      },
      {
        label: t("editor.autoCrop"),
        icon: "scissors",
        disabled: busy,
        onClick: () => void this.#autoCrop(),
      },
      {
        label: t("editor.normalize"),
        icon: "maximize-2",
        active: this.hasNormalize,
        onClick: () => void this.#normalizePeak(),
      },
      {
        label: t("editor.dynamics"),
        icon: "activity",
        disabled: busy,
        onClick: () => this.#openDynamicsModal(),
      },
      { section: t("editor.sectionDirection") },
      {
        label: t("editor.forward"),
        icon: "arrow-right",
        active: !this.state.reverse,
        onClick: () => {
          if (this.state.reverse) void this.#reverse();
        },
      },
      {
        label: t("editor.reverse"),
        icon: "repeat",
        active: this.state.reverse,
        onClick: () => {
          if (!this.state.reverse) void this.#reverse();
        },
      },
      { section: t("editor.sectionStretch") },
      {
        label: t("editor.stretchRatio"),
        icon: "move-horizontal",
        hint: `×${this.state.stretchRatio.toFixed(2)}`,
        onClick: () => this.#openStretchModal(),
      },
      {
        label: t("editor.stretchPitch"),
        icon: "music",
        active: this.stretchModeUi === "preserve-pitch",
        onClick: () => {
          this.stretchModeUi = "preserve-pitch";
        },
      },
      {
        label: t("editor.stretchResample"),
        icon: "activity",
        active: this.stretchModeUi === "resample",
        onClick: () => {
          this.stretchModeUi = "resample";
        },
      },
      { section: t("editor.sectionSample") },
      {
        label: t("sample.info"),
        icon: "info",
        onClick: () => {
          this.infoOpen = true;
        },
      },
      {
        label: this.sample?.favorite ? t("editor.unfav") : t("editor.fav"),
        icon: "star",
        onClick: () => void this.#fav(),
      },
      {
        label: t("editor.forceRole"),
        icon: "music",
        hint: this.sample?.forceRole ?? t("editor.forceRoleAuto"),
        onClick: () => {
          this.forceRoleModalOpen = true;
        },
      },
      {
        label: t("library.separate"),
        icon: "layers",
        disabled: busy || isStem || !this.sampleId,
        onClick: () => void this.#separate(),
      },
      {
        label: t("library.analyze"),
        icon: "refresh-cw",
        disabled: busy || !this.sampleId,
        onClick: () => void this.#retryProcess(),
      },
      {
        label: t("editor.delete"),
        icon: "trash-2",
        danger: true,
        onClick: () => void this.#remove(),
      },
      "divider",
      {
        label: t("editor.docs"),
        icon: "book-open",
        onClick: () => {
          this.docsModalOpen = true;
        },
      },
    ];
  }

  #renderStretchModal() {
    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${this.stretchModalOpen}
        @hide=${this.#onStretchModalHide}
      >
        <sonic-modal-title>${t("editor.stretchTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex flex-col gap-3">
            <label
              class="flex flex-col gap-0.5 text-xs text-neutral-500"
              >${t("editor.stretchRatio")} ×${(this.stretchDraft / 100).toFixed(
                2,
              )}
              <input
                type="range"
                class="w-full"
                min="50"
                max="200"
                .valueAsNumber=${this.stretchDraft}
                @input=${(e: Event) => {
                  this.stretchDraft = (
                    e.target as HTMLInputElement
                  ).valueAsNumber;
                }}
              />
            </label>
            <div class="flex flex-wrap gap-[0.35rem]" role="radiogroup">
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${this.stretchModeUi === "preserve-pitch"}
                @click=${() => {
                  this.stretchModeUi = "preserve-pitch";
                }}
              >
                ${glIcon("music", { slot: "prefix", size: "xs" })}
                ${t("editor.stretchPitch")}
              </sonic-button>
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${this.stretchModeUi === "resample"}
                @click=${() => {
                  this.stretchModeUi = "resample";
                }}
              >
                ${glIcon("activity", { slot: "prefix", size: "xs" })}
                ${t("editor.stretchResample")}
              </sonic-button>
            </div>
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button
            hideModal
            variant="outline"
            type="neutral"
            >${t("dialog.cancel")}</sonic-button
          >
          <sonic-button type="primary" @click=${this.#commitStretchModal}
            >${t("dialog.ok")}</sonic-button
          >
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #openStretchModal = (): void => {
    this.stretchDraft = Math.round(this.state.stretchRatio * 100);
    this.stretchModalOpen = true;
  };

  #onStretchModalHide = (): void => {
    this.stretchModalOpen = false;
  };

  #commitStretchModal = (): void => {
    this.stretchModalOpen = false;
    void this.applyStretch(this.stretchDraft / 100);
  };

  #renderDynamicsModal() {
    const gate = this.dynamicsMode === "gate";
    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${this.dynamicsModalOpen}
        @hide=${this.#onDynamicsModalHide}
      >
        <sonic-modal-title>${t("editor.dynamicsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex flex-col gap-3">
            <p class="m-0 text-xs text-neutral-500">${t("editor.dynamicsHint")}</p>
            <div class="flex flex-wrap gap-[0.35rem]" role="radiogroup">
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${gate}
                @click=${() => {
                  this.dynamicsMode = "gate";
                }}
              >
                ${t("editor.dynamicsGate")}
              </sonic-button>
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${!gate}
                @click=${() => {
                  this.dynamicsMode = "compress";
                }}
              >
                ${t("editor.dynamicsCompress")}
              </sonic-button>
            </div>
            <label class="flex flex-col gap-0.5 text-xs text-neutral-500"
              >${t("editor.dynamicsThreshold")}
              ${this.dynamicsThresholdDb} dB
              <input
                type="range"
                class="w-full"
                min="-80"
                max="-6"
                step="1"
                .valueAsNumber=${this.dynamicsThresholdDb}
                @input=${(e: Event) => {
                  this.dynamicsThresholdDb = (
                    e.target as HTMLInputElement
                  ).valueAsNumber;
                }}
              />
            </label>
            <label class="flex flex-col gap-0.5 text-xs text-neutral-500"
              >${t("editor.dynamicsAttack")} ${this.dynamicsAttackMs} ms
              <input
                type="range"
                class="w-full"
                min="1"
                max="100"
                step="1"
                .valueAsNumber=${this.dynamicsAttackMs}
                @input=${(e: Event) => {
                  this.dynamicsAttackMs = (
                    e.target as HTMLInputElement
                  ).valueAsNumber;
                }}
              />
            </label>
            <label class="flex flex-col gap-0.5 text-xs text-neutral-500"
              >${t("editor.dynamicsRelease")} ${this.dynamicsReleaseMs} ms
              <input
                type="range"
                class="w-full"
                min="5"
                max="500"
                step="5"
                .valueAsNumber=${this.dynamicsReleaseMs}
                @input=${(e: Event) => {
                  this.dynamicsReleaseMs = (
                    e.target as HTMLInputElement
                  ).valueAsNumber;
                }}
              />
            </label>
            ${gate
              ? nothing
              : html`
                  <label class="flex flex-col gap-0.5 text-xs text-neutral-500"
                    >${t("editor.dynamicsRatio")}
                    ${this.dynamicsRatio.toFixed(1)}:1
                    <input
                      type="range"
                      class="w-full"
                      min="1.5"
                      max="12"
                      step="0.5"
                      .valueAsNumber=${this.dynamicsRatio}
                      @input=${(e: Event) => {
                        this.dynamicsRatio = (
                          e.target as HTMLInputElement
                        ).valueAsNumber;
                      }}
                    />
                  </label>
                  <label class="flex flex-col gap-0.5 text-xs text-neutral-500"
                    >${t("editor.dynamicsMakeup")} ${this.dynamicsMakeupDb} dB
                    <input
                      type="range"
                      class="w-full"
                      min="0"
                      max="12"
                      step="1"
                      .valueAsNumber=${this.dynamicsMakeupDb}
                      @input=${(e: Event) => {
                        this.dynamicsMakeupDb = (
                          e.target as HTMLInputElement
                        ).valueAsNumber;
                      }}
                    />
                  </label>
                `}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral"
            >${t("dialog.cancel")}</sonic-button
          >
          <sonic-button type="primary" @click=${this.#commitDynamicsModal}
            >${t("dialog.ok")}</sonic-button
          >
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #openDynamicsModal = (): void => {
    this.dynamicsModalOpen = true;
  };

  #onDynamicsModalHide = (): void => {
    this.dynamicsModalOpen = false;
  };

  #commitDynamicsModal = (): void => {
    this.dynamicsModalOpen = false;
    void this.#applyDynamics();
  };

  #applyDynamics = async (): Promise<void> => {
    const mode = this.dynamicsMode;
    const thresholdDb = this.dynamicsThresholdDb;
    const attackMs = this.dynamicsAttackMs;
    const releaseMs = this.dynamicsReleaseMs;
    const ratio = this.dynamicsRatio;
    const makeupDb = this.dynamicsMakeupDb;
    const sr = this.#sampleRate;
    await this.#mutateView((view, sel) => {
      const ch = this.#channelCount;
      const frames = frameCount(view, ch);
      const a = sel?.a ?? 0;
      const b = sel?.b ?? frames;
      if (b <= a) return null;
      const slice = sliceFrames(view, ch, a, b);
      const processed = mapInterleavedChannels(slice, ch, (plane) =>
        mode === "gate"
          ? noiseGate(plane, sr, {
              thresholdDb,
              attackMs,
              releaseMs,
              floor: 0,
            })
          : softCompress(plane, sr, {
              thresholdDb,
              ratio,
              attackMs,
              releaseMs,
              kneeDb: 6,
              makeupDb,
            }),
      );
      const next = view.slice();
      next.set(processed, a * ch);
      return {
        pcm: next,
        status:
          mode === "gate"
            ? t("editor.dynamicsDoneGate")
            : t("editor.dynamicsDoneCompress"),
        selStart: a,
        selEnd: b,
      };
    });
  };

  #renderForceRoleModal() {
    const roles = ExprRoleSchema.options;
    const current = this.sample?.forceRole ?? null;
    return html`
      <sonic-modal
        align="left"
        maxWidth="24rem"
        .visible=${this.forceRoleModalOpen}
        @hide=${() => {
          this.forceRoleModalOpen = false;
        }}
      >
        <sonic-modal-title>${t("editor.forceRole")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="flex flex-col gap-3">
            <p class="m-0 text-xs text-neutral-500">${t("editor.forceRoleHint")}</p>
            <div class="flex flex-wrap gap-[0.35rem]">
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${current == null}
                @click=${() => void this.#setForceRole(null)}
              >
                ${t("editor.forceRoleAuto")}
              </sonic-button>
              ${roles.map(
                (role) => html`
                  <sonic-button
                    size="sm"
                    variant="outline"
                    type="neutral"
                    ?active=${current === role}
                    @click=${() => void this.#setForceRole(role)}
                  >
                    ${role}
                  </sonic-button>
                `,
              )}
            </div>
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  async #setForceRole(role: ExprRole | null): Promise<void> {
    if (!this.sampleId || !this.sample) return;
    const next: Sample = {
      ...this.sample,
      updatedAt: nowIso(),
      revision: (this.sample.revision ?? 0) + 1,
    };
    if (role == null) {
      delete (next as { forceRole?: ExprRole }).forceRole;
    } else {
      next.forceRole = role;
    }
    await db.samples.put(next);
    this.sample = next;
  }

  #renderDocsModal() {
    return html`
      <sonic-modal
        align="left"
        maxWidth="28rem"
        .visible=${this.docsModalOpen}
        @hide=${() => {
          this.docsModalOpen = false;
        }}
      >
        <sonic-modal-title>${t("editor.docsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <ul
            class="m-0 flex list-disc flex-col gap-1.5 pl-[1.1rem] text-[0.85rem] text-neutral-500"
          >
            <li>Fond : ↕ zoom · ↔ pan</li>
            <li>Règle = région de boucle</li>
            <li>Poignées = trim / in-out / tête de lecture</li>
            <li>Poignée timeline = déplacer la boucle</li>
            <li>${t("editor.rotateDocs")}</li>
          </ul>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">${t("dialog.ok")}</sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  #onPreviewFxEvent = (
    e: CustomEvent<{ fx: TrackFx; commit: boolean }>,
  ): void => {
    void this.#onPreviewFx(e.detail.fx);
  };

  #onFxApply = (): void => {
    const hasSel = this.#selRel() != null;
    void this.#applyFx(hasSel ? "selection" : "all");
  };

    /** Selection bounds relative to the current rendered view, or null if empty. */
  #selRel(): { a: number; b: number } | null {
    if (!this.master) return null;
    const viewLen = Math.max(
      0,
      this.state.endSample - this.state.startSample,
    );
    const a = Math.min(this.selStart, this.selEnd) - this.state.startSample;
    const b = Math.max(this.selStart, this.selEnd) - this.state.startSample;
    if (b <= a + 1 || a < 0 || b > viewLen) return null;
    return { a, b };
  }

  #currentView(): Float32Array | null {
    if (!this.master) return null;
    const view = renderNormalized(
      this.master,
      this.state,
      this.#sampleRate,
      this.hasNormalize,
      -0.3,
      this.#channelCount,
    );
    return view.length > 0 ? view : null;
  }

  #setClipboard(pcm: Float32Array): void {
    this.#clipboard = pcm;
    this.hasClipboard = pcm.length > 0;
  }

  #copySelection = (): void => {
    const view = this.#currentView();
    const sel = this.#selRel();
    if (!view || !sel) return;
    const ch = this.#channelCount;
    this.#setClipboard(sliceFrames(view, ch, sel.a, sel.b));
    toast(`Copié · ${sel.b - sel.a} frames`, "success");
  };

  #cutSelection = (): void => {
    void this.#mutateView((view, sel) => {
      if (!sel) return null;
      const ch = this.#channelCount;
      this.#setClipboard(sliceFrames(view, ch, sel.a, sel.b));
      const next = concatInterleaved([
        sliceFrames(view, ch, 0, sel.a),
        sliceFrames(view, ch, sel.b, frameCount(view, ch)),
      ]);
      return { pcm: next, status: "Coupé", selStart: sel.a, selEnd: sel.a };
    });
  };

  #pasteClipboard = (): void => {
    if (!this.#clipboard || this.#clipboard.length === 0) return;
    void this.#mutateView((view, sel) => {
      const ch = this.#channelCount;
      const frames = frameCount(view, ch);
      const at =
        sel?.a ??
        Math.max(0, Math.min(frames, this.playheadSample));
      const clip = this.#clipboard!;
      const clipFrames = frameCount(clip, ch);
      const next = concatInterleaved([
        sliceFrames(view, ch, 0, at),
        clip,
        sliceFrames(view, ch, at, frames),
      ]);
      return {
        pcm: next,
        status: "Collé",
        selStart: at,
        selEnd: at + clipFrames,
      };
    });
  };

  #silenceSelection = (): void => {
    void this.#mutateView((view, sel) => {
      if (!sel) return null;
      const ch = this.#channelCount;
      const next = view.slice();
      for (let f = sel.a; f < sel.b; f++) {
        const base = f * ch;
        for (let c = 0; c < ch; c++) next[base + c] = 0;
      }
      return {
        pcm: next,
        status: "Silence",
        selStart: sel.a,
        selEnd: sel.b,
      };
    });
  };

  #fadeInSelection = (): void => {
    this.#fadeSelection("in");
  };

  #fadeOutSelection = (): void => {
    this.#fadeSelection("out");
  };

  #fadeSelection(kind: "in" | "out"): void {
    void this.#mutateView((view, sel) => {
      if (!sel) return null;
      const ch = this.#channelCount;
      const next = view.slice();
      const n = sel.b - sel.a;
      for (let i = 0; i < n; i++) {
        const t = n <= 1 ? 1 : i / (n - 1);
        const g = kind === "in" ? t : 1 - t;
        const base = (sel.a + i) * ch;
        for (let c = 0; c < ch; c++) next[base + c]! *= g;
      }
      return {
        pcm: next,
        status: kind === "in" ? "Fade in" : "Fade out",
        selStart: sel.a,
        selEnd: sel.b,
      };
    });
  }

  /**
   * Apply cut/paste/silence/fade/FX to the in-memory working master (non-destructive
   * until save on leave).
   */
  async #mutateView(
    mutate: (
      view: Float32Array,
      sel: { a: number; b: number } | null,
    ) => {
      pcm: Float32Array;
      status: string;
      selStart: number;
      selEnd: number;
    } | null,
  ): Promise<void> {
    if (!this.master || !this.sampleId || this.applyingFx) return;
    const view = this.#currentView();
    if (!view) {
      toast("Rien à traiter", "warning");
      return;
    }
    const plan = mutate(view, this.#selRel());
    if (!plan) return;

    this.#checkpoint();
    this.applyingFx = true;
    try {
      this.#applyWorkingMaster(plan.pcm, plan.status, plan.selStart, plan.selEnd);
    } catch (err) {
      toast(
        `Échec: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this.applyingFx = false;
    }
  }

  #applyWorkingMaster(
    next: Float32Array,
    okStatus: string,
    selStartRel = 0,
    selEndRel?: number,
  ): void {
    const wasPlaying = this.playing;
    this.#haltPlay();

    this.master = next;
    this.#masterDirty = true;
    this.ops = [];
    this.hasNormalize = false;
    const frames = frameCount(next, this.#channelCount);
    this.state = emptyEditorState(frames);
    const end = selEndRel ?? frames;
    this.selStart = Math.max(0, Math.min(frames, selStartRel));
    this.selEnd = Math.max(this.selStart, Math.min(frames, end));
    this.playheadSample = this.selStart;
    this.dirty = true;
    this.#rebuildView();
    toast(okStatus, "success");
    if (wasPlaying) void this.#restartPlayFrom(this.selStart);
  }

  async #onPreviewFx(fx: TrackFx): Promise<void> {
    this.previewFx = fx;
    if (this.playing && this.#engine) {
      if (!trackFxNeedsBus(fx)) {
        await this.#restartPlay();
        return;
      }
      this.#engine.setTrackInsert({
        id: "edit",
        gain: 1,
        pan: 0,
        fx,
        bpm: 120,
      });
      // Ensure clip routes through the bus if FX was previously none.
      await this.#restartPlay();
    }
  }

  /**
   * Bake FX into the working master (ADR-0016). Persists to OPFS only on leave save.
   */
  async #applyFx(scope: "selection" | "all"): Promise<void> {
    if (
      !this.master ||
      !this.sampleId ||
      !trackFxIsActive(this.previewFx) ||
      this.applyingFx
    ) {
      return;
    }
    this.applyingFx = true;
    try {
      const view = this.#currentView();
      if (!view) {
        toast("Rien à traiter", "warning");
        return;
      }

      const sel = this.#selRel();
      const useSel = scope === "selection" && sel != null;
      const ch = this.#channelCount;
      const frames = frameCount(view, ch);
      let next: Float32Array;
      if (useSel && sel) {
        const baked = await bakeTrackFx(
          sliceFrames(view, ch, sel.a, sel.b),
          this.#sampleRate,
          this.previewFx,
          120,
          ch,
        );
        next = concatInterleaved([
          sliceFrames(view, ch, 0, sel.a),
          baked,
          sliceFrames(view, ch, sel.b, frames),
        ]);
      } else {
        next = await bakeTrackFx(
          view,
          this.#sampleRate,
          this.previewFx,
          120,
          ch,
        );
      }

      this.#checkpoint();
      this.previewFx = { ...DEFAULT_TRACK_FX };
      this.#applyWorkingMaster(
        next,
        useSel ? "FX appliqué à la sélection" : "FX appliqué à tout le son",
        0,
        frameCount(next, ch),
      );
    } catch (err) {
      toast(
        `Échec FX: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this.applyingFx = false;
    }
  }

  /** Selection relative to the trimmed view buffer (= loop region). */
  #loopRel(): { loopA: number; loopB: number } {
    const len = this.#viewBuffer?.length ?? 1;
    const a = Math.min(this.selStart, this.selEnd) - this.state.startSample;
    const b = Math.max(this.selStart, this.selEnd) - this.state.startSample;
    if (b > a + 1) {
      return {
        loopA: Math.max(0, Math.min(len - 2, a)),
        loopB: Math.max(1, Math.min(len, b)),
      };
    }
    return { loopA: 0, loopB: len };
  }

  #cropToSelection = async (): Promise<void> => {
    const a = Math.min(this.selStart, this.selEnd);
    const b = Math.max(this.selStart, this.selEnd);
    if (b <= a) return;
    await this.#pushOp({ op: "trim", startSample: a, endSample: b });
  };

  #autoCrop = (): void => {
    void this.#mutateView((view, sel) => {
      const ch = this.#channelCount;
      const frames = frameCount(view, ch);
      const a = sel?.a ?? 0;
      const b = sel?.b ?? frames;
      if (b <= a + 1) return null;
      const slice = sliceFrames(view, ch, a, b);
      let cropped = false;
      const resultPcm = mapInterleavedChannels(slice, ch, (plane) => {
        const result = autoCropPcm(plane, this.#sampleRate);
        if (result.cropped) cropped = true;
        return result.pcm;
      });
      if (!cropped) {
        toast(t("editor.autoCropNone"), "warning");
        return null;
      }
      const next = concatInterleaved([
        sliceFrames(view, ch, 0, a),
        resultPcm,
        sliceFrames(view, ch, b, frames),
      ]);
      return {
        pcm: next,
        status: t("editor.autoCropDone"),
        selStart: a,
        selEnd: a + frameCount(resultPcm, ch),
      };
    });
  };

  #commitSelectionAsLoop = async (): Promise<void> => {
    const a = Math.min(this.selStart, this.selEnd);
    const b = Math.max(this.selStart, this.selEnd);
    if (b <= a + 1) return;
    const same =
      this.state.loopStartSample === a && this.state.loopEndSample === b;
    if (same) return;
    await this.#pushOp({
      op: "loop",
      loopStartSample: a,
      loopEndSample: b,
      xfadeMs: this.state.loopXfadeMs,
    });
  };

  #normalizePeak = async (): Promise<void> => {
    await this.#pushOp({ op: "normalize_peak", targetDbtp: -0.3 });
  };

  #reverse = async (): Promise<void> => {
    await this.#pushOp({ op: "reverse" });
  };

  applyStretch = async (absoluteRatio: number): Promise<void> => {
    const current = this.state.stretchRatio || 1;
    const relative = absoluteRatio / current;
    if (Math.abs(relative - 1) < 0.01) return;
    await this.#pushOp({
      op: "stretch",
      ratio: relative,
      mode: this.stretchModeUi,
    });
  };

  #checkpoint(): void {
    if (!this.master) return;
    this.#history.push({
      master: this.master.slice(),
      masterDirty: this.#masterDirty,
      channelCount: this.#channelCount,
      ops: this.ops.map((o) => structuredClone(o)),
      hasNormalize: this.hasNormalize,
      dirty: this.dirty,
      selStart: this.selStart,
      selEnd: this.selEnd,
      playheadSample: this.playheadSample,
      stretchModeUi: this.stretchModeUi,
      previewFx: { ...this.previewFx },
    });
    if (this.#history.length > 40) this.#history.shift();
    this.historyLen = this.#history.length;
  }

  async #pushOp(op: EditorOp): Promise<void> {
    if (!this.sampleId) return;
    this.#checkpoint();
    this.ops = [...this.ops, op];
    this.state = applyOps(
      frameCount(this.master ?? new Float32Array(0), this.#channelCount),
      this.ops,
    );
    this.hasNormalize = this.ops.some((o) => o.op === "normalize_peak");
    this.dirty = true;
    if (op.op === "trim") {
      this.selStart = this.state.startSample;
      this.selEnd = this.state.endSample;
    } else if (op.op === "loop" && this.state.loopStartSample != null) {
      this.selStart = this.state.loopStartSample;
      this.selEnd = this.state.loopEndSample!;
    }
    this.#rebuildView();
    toast(`op ${op.op}`, "success");
    if (this.playing) await this.#restartPlay();
  }

  async #undo(): Promise<void> {
    const snap = this.#history.pop();
    this.historyLen = this.#history.length;
    if (!snap) return;
    const wasPlaying = this.playing;
    this.#haltPlay();
    this.master = snap.master;
    this.#masterDirty = snap.masterDirty;
    this.#channelCount = snap.channelCount ?? this.#channelCount;
    this.ops = snap.ops;
    this.hasNormalize = snap.hasNormalize;
    this.dirty = snap.dirty;
    this.state = applyOps(frameCount(this.master, this.#channelCount), this.ops);
    this.selStart = snap.selStart;
    this.selEnd = snap.selEnd;
    this.playheadSample = snap.playheadSample;
    this.stretchModeUi = snap.stretchModeUi;
    this.previewFx = snap.previewFx;
    this.#rebuildView();
    toast(t("editor.undoDone"), "success");
    if (wasPlaying) await this.#restartPlayFrom(this.playheadSample);
  }

  /** Persist working master + edit ops to OPFS / IndexedDB. */
  async save(): Promise<void> {
    if (!this.sampleId || !this.master) return;
    this.#haltPlay();

    const rows = await db.ops
      .where("entityId")
      .equals(this.sampleId)
      .toArray();
    const editIds = rows
      .filter((r) => r.entityType === "sample_edit")
      .map((r) => r.id);
    if (editIds.length > 0) await db.ops.bulkDelete(editIds);

    if (this.#masterDirty) {
      await sampleOpfs.savePcm(
        this.sampleId,
        this.master,
        this.#sampleRate,
        this.#channelCount,
      );
      const durationMs = durationMsFromPcm(
        this.master,
        this.#sampleRate,
        this.#channelCount,
      );
      await db.samples.update(this.sampleId, {
        durationMs,
        loopStartMs: undefined,
        loopEndMs: undefined,
        updatedAt: nowIso(),
      });
    } else {
      for (const [i, op] of this.ops.entries()) {
        await db.ops.add({
          id: createEntityId(),
          entityType: "sample_edit",
          entityId: this.sampleId,
          op: op.op,
          payload: op as unknown as Record<string, unknown>,
          clientSeq: Date.now() + i,
          clientId: "local",
          createdAt: nowIso(),
        });
      }
      const patch: Partial<Sample> = { updatedAt: nowIso() };
      if (this.state.loopStartSample != null && this.state.loopEndSample != null) {
        patch.loopStartMs =
          (this.state.loopStartSample / this.#sampleRate) * 1000;
        patch.loopEndMs = (this.state.loopEndSample / this.#sampleRate) * 1000;
        patch.loopXfadeMs = this.state.loopXfadeMs;
      } else {
        patch.loopStartMs = undefined;
        patch.loopEndMs = undefined;
      }
      patch.durationMs = Math.round(
        ((this.state.endSample - this.state.startSample) / this.#sampleRate) *
          1000,
      );
      await db.samples.update(this.sampleId, patch);
    }

    this.sample = (await db.samples.get(this.sampleId)) ?? this.sample;
    this.#masterDirty = false;
    this.dirty = false;
    toast("Enregistré", "success");
  }

  /**
   * Ask what to do with dirty edits before leaving.
   * @returns false if the user cancelled navigation
   */
  async confirmLeave(): Promise<boolean> {
    if (this.#skipLeaveGuard || !this.dirty) return true;
    const choice = await glDialog.unsaved(t("editor.unsaved"));
    if (choice === "cancel") return false;
    if (choice === "save") await this.save();
    this.dirty = false;
    this.#masterDirty = false;
    return true;
  }

  #fav = async (): Promise<void> => {
    if (!this.sampleId) return;
    const updated = await toggleFavorite(this.sampleId);
    if (updated) this.sample = updated;
  };

  #separate = async (): Promise<void> => {
    if (!this.sampleId || !this.sample || this.separating) return;
    const tags = this.sample.tags ?? [];
    if (tags.some((tag) => tag.startsWith("stem:"))) {
      await glDialog.alert(t("library.separateSkipStem"));
      return;
    }
    if (tags.includes(ML_TAG.demucs) || tags.includes(ML_TAG.demucsRunning)) {
      await glDialog.alert(t("library.separateAlready"));
      return;
    }
    if (this.dirty) {
      const leave = await this.confirmLeave();
      if (!leave) return;
    }
    const ok = await glDialog.confirm({
      title: t("library.separate"),
      message: t("library.separateConfirm"),
    });
    if (!ok) return;
    this.#haltPlay();
    this.separating = true;
    this.separateProgress = t("library.separateLoading");
    const unsub = demucsQueue.subscribe((s) => {
      if (s.currentSampleId !== this.sampleId && s.remaining > 0) {
        this.separateProgress = tf("library.separateBatchProgress", {
          i: Math.min(s.waveDone + 1, Math.max(1, s.waveTotal)),
          n: s.waveTotal,
          label: t("library.separating"),
        });
        return;
      }
      const pct = Math.round(s.ratio * 100);
      const label =
        s.phase === "loading"
          ? `${t("library.separateLoading")} ${pct}%`
          : `${t("library.separating")} ${pct}%`;
      this.separateProgress =
        s.waveTotal > 1
          ? tf("library.separateBatchProgress", {
              i: Math.min(s.waveDone + 1, s.waveTotal),
              n: s.waveTotal,
              label,
            })
          : label;
    });
    try {
      const snap = await demucsQueue.enqueueAndWait(this.sampleId);
      const fresh = await db.samples.get(this.sampleId);
      if (fresh?.tags?.includes(ML_TAG.demucs)) {
        toast(t("library.separateDone"), "success");
        this.#skipLeaveGuard = true;
        this.dirty = false;
        navigate({ name: "library" });
        return;
      }
      if (snap.lastError) {
        throw new Error(snap.lastError);
      }
      await glDialog.alert(t("library.separateAlready"));
    } catch (e) {
      await glDialog.alert(
        `${t("library.separateFailed")}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      unsub();
      this.separating = false;
      this.separateProgress = "";
    }
  };

  #remove = async (): Promise<void> => {
    if (!this.sampleId || !this.sample) return;
    const label = this.sample.userName ?? this.sample.name;
    const ok = await glDialog.confirm({
      message: `Supprimer « ${label} » ?`,
      confirmLabel: t("dialog.delete"),
      danger: true,
    });
    if (!ok) return;
    this.#haltPlay();
    this.#skipLeaveGuard = true;
    this.dirty = false;
    await deleteSample(this.sampleId);
    navigate({ name: "library" });
  };

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(SAMPLE_PROCESSED_EVENT, this.#onSampleProcessed);
    window.removeEventListener("beforeunload", this.#onBeforeUnload);
    this.#unsubProc?.();
    this.#haltPlay();
    super.disconnectedCallback();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-editor-page": GlEditorPage;
  }
}
