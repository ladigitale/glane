import {
  CLASS_COLORS,
  PPQ,
  asSampleIndex,
  asTick,
  createEntityId,
  msToSamples,
  normalizeTrack,
  nowIso,
  samplesToTicks,
  ticksToSamples,
  type Clip,
  type Project,
  type Sample,
  type SampleClass,
  type StretchMode,
  type Track,
  type TrackFx,
} from "@glane/core-model";
import { TransportEngine } from "@glane/audio-engine";
import { stretchBuffer, tileBuffer } from "@glane/audio-dsp";
import {
  GestureFsm,
  LONGPRESS_MS,
  MOVE_THRESHOLD_PX,
  snapTick,
  gridTargets,
  clipEdgeTargets,
  clampOverlapStart,
  clampOverlapTrim,
  pxRadiusToTicks,
  type GestureKind,
} from "@glane/gestures";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import tailwind from "../../css/tailwind";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import { db } from "../db.js";
import { t, tf, type MessageKey } from "../i18n/messages.js";
import {
  keyPcLabel,
  planSequence,
  parseStemFromTags,
  resolveYamnetSlugs,
  MUSIC_STYLE_IDS,
  type GenAuto,
  type GenFormStyle,
  type GenGrooveChoice,
  type GenMusicStyleChoice,
  type GenPaletteChoice,
  type GenScaleMode,
  type GenTriState,
} from "../generative.js";
import { clapFeatureFromAnalysis } from "../ml/clap-runtime.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { SAMPLE_PROCESSED_EVENT } from "../process-queue.js";
import { exportFormKey, seqDrawerKey } from "../dp-keys.js";
import { glDialog } from "../dialog.js";
import { navigate } from "../router.js";
import {
  projectWorkspace,
} from "../project-workspace.js";
import {
  audibleTrackIds,
  applyOverlapFades,
  clipToScheduled,
  dbToGain,
  gainDbToLin,
  ticksToMs,
  trackToInsertConfig,
  trackXfadeZones,
} from "../seq-schedule.js";
import { seqUiState, DEFAULT_SEQ_GEN_UI, type SeqUiState } from "../seq-ui-state.js";
import {
  exportPublish,
  type BounceResult,
  type SoundCloudStatus,
} from "../export-publish.js";
import { exportToast } from "../export-toast.js";
import { seqOctatrackExport } from "../seq-octatrack-export.js";
import { listenShare, type ListenMeta } from "../listen-share.js";
import {
  reelExport,
  type ReelEncodeResult,
} from "../reel-export.js";
import { auth } from "../auth.js";
import { saveBounceToLibrary } from "../sample-actions.js";
import {
  CANCEL_ZONE_H,
  MAX_PX_PER_TICK,
  MIN_PX_PER_TICK,
  RULER_H,
  TRACK_LABEL_PX,
  bindTimelineWheel,
  formatClock,
  paintStretchedWave,
  scrollLeftToCenterUnit,
  zoomAtClientX,
} from "../timeline/timeline.js";
import "../track-volume-rotary.js";
import "../track-fx-control.js";
import "../pop-select.js";
import "../seek-bar.js";
import "../transport-bar.js";
import { glIcon } from "../icon.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import type { TransportAction } from "../transport-bar.js";

const MIN_CLIP_TICKS = PPQ / 4;
const HANDLE_PX = 44;
/** OS-like double-click window (longer than LONGPRESS_MS so taps stay distinct). */
const DOUBLE_TAP_MS = 500;
const LANE_PAD_TICKS = PPQ; // pad past sequence end (end handle)
const MIN_BARS = 1;
const MAX_BARS = 256;
const MIN_BPM = 40;
const MAX_BPM = 300;
/** Live play: only decode/stretch clips in this window ahead of the playhead. */
const PLAY_PRELOAD_BEATS = 16;
/** Cap decoded PCM / AudioBuffer caches (mobile OOM on big gens). */
const PCM_CACHE_MAX = 32;
const BUFFER_CACHE_MAX = 48;

type SeqConfigModal = "bpm" | "bars" | "generate" | "docs" | null;
const STRETCH_ORDER: StretchMode[] = [
  "off",
  "copy",
  "preserve-pitch",
  "resample",
];
const STRETCH_LABEL: Record<StretchMode, string> = {
  off: "off",
  copy: "copie",
  "preserve-pitch": "pitch",
  resample: "resample",
};

type TrimEdge = "start" | "end";

@customElement("gl-sequencer-page")
export class GlSequencerPage extends LitElement {
  static override styles = [
    tailwind,
    css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      touch-action: none;
    }
    .timeline {
      flex: 1;
      min-width: 0;
      overflow: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      background: var(--gl-ink-elevated);
      position: relative;
    }
    .timeline::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    .timeline-canvas {
      position: relative;
      box-sizing: border-box;
    }
    .track {
      display: flex;
      width: 100%;
      min-width: 100%;
      box-sizing: border-box;
      min-height: 56px;
      border-bottom: 1px solid color-mix(in srgb, var(--gl-fg) 12%, transparent);
    }
    .track-label {
      width: ${TRACK_LABEL_PX}px;
      flex-shrink: 0;
      background: var(--gl-ink);
      position: sticky;
      right: 0;
      z-index: 5;
      box-shadow: -4px 0 10px color-mix(in srgb, #000 28%, transparent);
    }
    .mute-sw {
      position: relative;
      width: 44px;
      height: 24px;
      border-radius: 12px;
      border: 0;
      padding: 0;
      cursor: pointer;
      background: color-mix(in srgb, var(--gl-fg) 22%, transparent);
      flex-shrink: 0;
      min-height: 24px;
    }
    .mute-sw.on {
      background: color-mix(in srgb, var(--gl-danger, #c45) 55%, transparent);
    }
    .mute-sw::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--gl-fg);
      transition: transform 120ms ease;
    }
    .mute-sw.on::after {
      transform: translateX(20px);
      background: var(--gl-ink);
    }
    .lane {
      position: relative;
      flex: 1;
      min-width: 800px;
      min-height: 56px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .lane.drop-target {
      outline: 2px dashed var(--gl-accent);
      outline-offset: -4px;
    }
    .playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--gl-accent);
      pointer-events: none;
      z-index: 2;
      box-shadow: 0 0 8px color-mix(in srgb, var(--gl-accent) 55%, transparent);
    }
    .clip {
      position: absolute;
      top: 8px;
      height: calc(100% - 16px);
      background: var(--gl-accent);
      border-radius: 4px;
      opacity: 0.9;
      min-width: 8px;
      cursor: grab;
      z-index: 1;
      overflow: hidden;
    }
    :host([data-rotate-clip]) .clip {
      cursor: ew-resize;
    }
    .clip canvas.wave {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      border-radius: 4px;
    }
    .clip-name {
      position: absolute;
      top: 2px;
      left: 4px;
      right: 4px;
      z-index: 2;
      margin: 0;
      padding: 0 2px;
      font-size: 0.65rem;
      font-weight: 600;
      line-height: 1.2;
      color: #fff;
      text-shadow: 0 1px 2px color-mix(in srgb, var(--gl-ink) 70%, transparent);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      user-select: none;
    }
    .clip.selected {
      outline: 2px solid var(--gl-fg);
      z-index: 2;
    }
    .clip.snap {
      box-shadow: 0 0 0 2px #e8c547;
    }
    .clip-ctx-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }
    .loop-sel {
      position: absolute;
      top: 0;
      bottom: 0;
      background: color-mix(in srgb, var(--gl-accent) 18%, transparent);
      border-left: 2px solid var(--gl-accent);
      border-right: 2px solid var(--gl-accent);
      pointer-events: none;
      z-index: 1;
      box-sizing: border-box;
    }
    .time-handle {
      position: absolute;
      top: 0;
      bottom: 0;
      width: ${HANDLE_PX}px;
      margin-left: ${-HANDLE_PX / 2}px;
      pointer-events: auto;
      cursor: ew-resize;
      background: transparent;
      /* Below sticky track tools (5) and ruler (6); above clips. */
      z-index: 4;
      touch-action: none;
    }
    .time-handle::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 20%;
      bottom: 20%;
      width: 4px;
      margin-left: -2px;
      background: var(--gl-accent);
      border-radius: 2px;
      opacity: 0.75;
    }
    .time-handle.playhead::after {
      top: 6px;
      bottom: auto;
      left: 50%;
      width: 12px;
      height: 12px;
      margin-left: -6px;
      border-radius: 50%;
      background: var(--gl-accent);
      opacity: 1;
      box-shadow:
        0 0 0 2px color-mix(in srgb, var(--gl-ink) 55%, transparent),
        0 0 8px color-mix(in srgb, var(--gl-accent) 50%, transparent);
    }
    .time-handle.playhead::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 18px;
      bottom: 12%;
      width: 2px;
      margin-left: -1px;
      background: var(--gl-accent);
      opacity: 0.9;
      border-radius: 1px;
    }
    .loop-move {
      position: absolute;
      top: 4px;
      height: calc(100% - 8px);
      pointer-events: auto;
      cursor: grab;
      z-index: 4;
      touch-action: none;
    }
    .loop-move:active {
      cursor: grabbing;
    }
    .loop-move::after {
      content: "";
      position: absolute;
      left: 8px;
      right: 8px;
      top: 50%;
      height: 6px;
      margin-top: -3px;
      border-radius: 3px;
      background: var(--gl-accent);
      opacity: 0.85;
    }
    .handle {
      position: absolute;
      top: 0;
      bottom: 0;
      width: ${HANDLE_PX}px;
      touch-action: none;
      z-index: 4;
    }
    .handle.start {
      left: 0;
      cursor: ew-resize;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--gl-fg) 35%, transparent),
        transparent
      );
    }
    .handle.end {
      right: 0;
      cursor: ew-resize;
      background: linear-gradient(
        270deg,
        color-mix(in srgb, var(--gl-fg) 35%, transparent),
        transparent
      );
    }
    .xfade {
      position: absolute;
      top: 8px;
      height: calc(100% - 16px);
      pointer-events: none;
      z-index: 1;
      border-radius: 2px;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--gl-accent) 10%, transparent),
        color-mix(in srgb, var(--gl-accent) 55%, transparent),
        color-mix(in srgb, var(--gl-accent) 10%, transparent)
      );
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gl-accent) 40%, transparent);
    }
    /* Overlay drop target — only mounted while dragging; no layout reserve. */
    .cancel-zone {
      position: sticky;
      top: 0;
      left: 0;
      z-index: 20;
      width: var(--gl-tl-view-w, 100%);
      box-sizing: border-box;
      height: ${CANCEL_ZONE_H}px;
      margin-bottom: -${CANCEL_ZONE_H}px;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      background: color-mix(in srgb, var(--gl-danger) 32%, transparent);
      color: var(--gl-fg);
      border-bottom: 1px solid color-mix(in srgb, var(--gl-danger) 45%, transparent);
      backdrop-filter: blur(4px);
    }
    .cancel-zone.hot {
      background: color-mix(in srgb, var(--gl-danger) 62%, transparent);
      color: #fff;
    }
    .time-ruler {
      display: flex;
      width: 100%;
      min-width: 100%;
      box-sizing: border-box;
      position: sticky;
      top: 0;
      height: ${RULER_H}px;
      z-index: 6;
      background: var(--gl-ink);
      border-bottom: 1px solid color-mix(in srgb, var(--gl-fg) 14%, transparent);
      user-select: none;
    }
    .ruler-progress {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      background: color-mix(in srgb, var(--gl-accent) 28%, transparent);
      pointer-events: none;
      z-index: 1;
    }
    .ruler-gutter {
      width: ${TRACK_LABEL_PX}px;
      flex-shrink: 0;
      position: sticky;
      right: 0;
      z-index: 3;
      background: var(--gl-ink);
      box-shadow: -4px 0 10px color-mix(in srgb, #000 28%, transparent);
    }
    .ruler-lane {
      position: relative;
      flex: 1;
      min-width: 800px;
      height: 100%;
    }
    .ruler-mark {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px solid color-mix(in srgb, var(--gl-fg) 22%, transparent);
      pointer-events: none;
    }
    .ruler-mark.major {
      border-left-color: color-mix(in srgb, var(--gl-fg) 45%, transparent);
    }
    .ruler-mark .lbl {
      position: absolute;
      left: 4px;
      top: 2px;
      font-family: var(--gl-font-mono);
      font-size: 0.6rem;
      color: var(--gl-fg-muted);
      white-space: nowrap;
    }
    .ruler-mark .clk {
      position: absolute;
      left: 4px;
      bottom: 2px;
      font-family: var(--gl-font-mono);
      font-size: 0.55rem;
      color: color-mix(in srgb, var(--gl-fg-muted) 80%, transparent);
      white-space: nowrap;
    }
    .seq-end {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 10px;
      margin-left: -5px;
      cursor: ew-resize;
      z-index: 3;
      touch-action: none;
    }
    .seq-end::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--gl-accent);
      box-shadow: 0 0 6px color-mix(in srgb, var(--gl-accent) 50%, transparent);
    }
    .seq-end::after {
      content: "";
      position: absolute;
      left: 1px;
      top: 6px;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: var(--gl-accent);
    }
    .drawer[hidden] {
      display: none !important;
    }
    .ghost {
      position: fixed;
      z-index: 40;
      pointer-events: none;
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      background: color-mix(in srgb, var(--gl-accent) 85%, transparent);
      color: var(--gl-ink);
      font-size: 0.75rem;
      transform: translate(-50%, -120%);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
  `,
  ];

  /** Route `/project/:id` — syncs the active workspace when set. */
  @property({ attribute: false }) projectId: string | undefined;

  @state() private project: Project | null = null;
  @state() private tracks: Track[] = [];
  @state() private clips: Clip[] = [];
  @state() private samples: Sample[] = [];
  @state() private selectedId: string | null = null;
  /** Circular contentOffset drag on selected clip (editor rotate parity). */
  @state() private rotateClipTool = false;
  @state() private playing = false;
  @state() private pxPerTick = 0.05;
  @state() private snapHighlightId: string | null = null;
  @state() private magnetOff = false;

  @subscribe(seqDrawerKey.filter)
  @state()
  drawerFilter: SampleClass | "all" | "favorite" | null = "all";

  /** Vertical sample library — open by default so sounds stay one gesture away. */
  @state() private drawerOpen = true;

  @state() private dropTrackId: string | null = null;
  /** Playhead in ticks — px derived at render so zoom stays aligned. */
  @state() private playheadTick = 0;
  @state() private loadingPlay = false;
  @state() private placingSampleId: string | null = null;
  @state() private ghost: { x: number; y: number; label: string } | null =
    null;
  @state() private cancelHot = false;
  /** Trash drop overlay — only after a real drag (not a tap). */
  @state() private dropCancelOpen = false;
  /** Timeline selection = transport loop (null = no loop). */
  @state() private selStartTick: number | null = null;
  @state() private selEndTick: number | null = null;
  @state() private exportOpen = false;
  @state() private exportBusy: string | null = null;
  @state() private exportError: string | null = null;
  @state() private exportPermalink: string | null = null;
  @state() private exportLibraryOk: string | null = null;
  @state() private reelResult: ReelEncodeResult | null = null;
  @state() private reelEncoding = false;
  @state() private seqModal: SeqConfigModal = null;
  @state() private draftBpm = 120;
  @state() private draftBars = 16;
  @state() private draftGenSeed = 1;
  @state() private draftGenDensity: number | GenAuto = 1;
  @state() private draftGenEnergy: number | GenAuto = 0.55;
  @state() private draftGenDrumsTextures: number | GenAuto = 0.55;
  @state() private draftGenMusicStyle: GenMusicStyleChoice = "auto";
  @state() private draftGenGroove: GenGrooveChoice = "auto";
  @state() private draftGenKey: number | GenAuto = "auto";
  @state() private draftGenScale: GenScaleMode = "auto";
  @state() private draftGenPalette: GenPaletteChoice = "auto";
  @state() private draftGenForm: GenFormStyle = "auto";
  @state() private draftGenHumanize: number | GenAuto = "auto";
  @state() private draftGenVariation: number | GenAuto = "auto";
  @state() private draftGenBpmSync: GenTriState = "auto";
  @state() private draftGenLockTempoPow2: GenTriState = "off";
  @state() private draftGenForbidPitchStretch: GenTriState = "off";
  @state() private draftGenReverse: GenTriState = "auto";
  @state() private draftGenStutter: GenTriState = "auto";
  @state() private draftGenCallResponse: GenTriState = "auto";
  @state() private draftGenLockPitch: GenTriState = "off";
  @state() private draftGenPitchUp: number | GenAuto = "auto";
  @state() private draftGenPitchDown: number | GenAuto = "auto";
  /** Pool for generation: all / favorites / sample class. */
  @state() private draftGenSampleFilter: SampleClass | "all" | "favorite" =
    "all";
  @state() private draftGenAdvanced = false;
  /** Long-press context menu (screen coords). */
  @state() private clipCtx: { clipId: string; x: number; y: number } | null =
    null;
  /** Clip options modal (fade / stretch). */
  @state() private clipOptsId: string | null = null;

  @subscribe(exportFormKey.title)
  @state()
  exportTitle = "";

  @subscribe(exportFormKey.sharing)
  @state()
  exportSharing: "private" | "public" = "private";

  @state() private scStatus: SoundCloudStatus | null = null;
  @state() private listenMeta: ListenMeta | null = null;
  @state() private listenVisibility: "unlisted" | "private" = "unlisted";
  #bounceCache: BounceResult | null = null;

  @handle(exportFormKey.title)
  onExportTitle(_title: string): void {
    this.#bounceCache = null;
  }

  #engine: TransportEngine | null = null;
  #fsm = new GestureFsm();
  @state() private dragClipId: string | null = null;
  #dragStartX = 0;
  #dragStartTick = 0;
  #dragStartTrackId = "";
  #lastTapClipId: string | null = null;
  #lastTapAt = 0;
  #selDragging = false;
  #bufferCache = new Map<string, AudioBuffer>();
  #pcmCache = new Map<string, { pcm: Float32Array; sampleRate: number }>();
  #wavePaintToken = 0;
  #wavePaintRaf = 0;
  #pendingScrollLeft: number | null = null;
  #raf = 0;
  /** Bumps to cancel in-flight schedule hydration. */
  #hydrateGen = 0;
  /** Tick horizon already covered by the live schedule window. */
  #scheduledToTick = 0;
  #tlRo: ResizeObserver | null = null;
  /** While true, scroll the lane so the playhead stays centered. */
  #followPlayhead = true;
  /** True while pointer is panning / zooming the timeline (not scrub). */
  #viewBusy = false;
  /** Manual playhead / seek-bar drag — owns position over transport RAF. */
  #scrubbing = false;
  /** Visible tick window on the global seek bar. */
  @state() private viewStartTick = 0;
  @state() private viewEndTick = 0;
  /** "global" = follow playhead; "vue" = free pan. */
  @state() private viewMode: "global" | "vue" = "global";

  #unsubWheel: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    set(seqDrawerKey, { filter: "all" });
    window.addEventListener("keydown", this.#onKey);
    window.addEventListener(SAMPLE_PROCESSED_EVENT, this.#onSampleProcessed);
    window.addEventListener("pagehide", this.#onPageHide);
    void this.#boot();
  }

  #onKey = (e: KeyboardEvent): void => {
    if (!isSpaceKey(e) || shouldIgnoreShortcut(e)) return;
    e.preventDefault();
    void this.#handleTransport(this.playing ? "pause" : "play");
  };

  #onPageHide = (): void => {
    this.#persistUiState();
  };

  override updated(changed: PropertyValues): void {
    if (changed.has("projectId") && this.hasUpdated) {
      const prev = changed.get("projectId") as string | undefined;
      if (prev !== this.projectId) {
        this.#persistUiState();
        void this.#boot();
      }
    }
    if (changed.has("rotateClipTool") || !this.hasUpdated) {
      if (this.rotateClipTool) this.setAttribute("data-rotate-clip", "");
      else this.removeAttribute("data-rotate-clip");
    }
    const pending = this.#pendingScrollLeft;
    if (pending != null) {
      this.#pendingScrollLeft = null;
      const timeline = this.#timelineEl();
      if (timeline) timeline.scrollLeft = pending;
      this.#syncViewWindow();
    }
    if (changed.has("playheadTick") && this.#followPlayhead) {
      this.#syncFollowScroll();
    }
    if (
      changed.has("clips") ||
      changed.has("pxPerTick") ||
      changed.has("project") ||
      changed.has("samples") ||
      changed.has("tracks") ||
      changed.has("selectedId") ||
      !this.hasUpdated
    ) {
      cancelAnimationFrame(this.#wavePaintRaf);
      this.#wavePaintRaf = requestAnimationFrame(() => {
        void this.#paintClipWaves();
      });
    }
  }

  override disconnectedCallback(): void {
    this.#persistUiState();
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(SAMPLE_PROCESSED_EVENT, this.#onSampleProcessed);
    window.removeEventListener("pagehide", this.#onPageHide);
    this.#unsubWheel?.();
    this.#unsubWheel = null;
    const timeline = this.#timelineEl();
    timeline?.removeEventListener("wheel", this.#onTimelineUserWheel);
    timeline?.removeEventListener("scroll", this.#onTimelineScroll);
    this.#tlRo?.disconnect();
    this.#tlRo = null;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#wavePaintRaf);
    this.#engine?.stop();
    this.#revokeReel();
    super.disconnectedCallback();
  }

  #onSampleProcessed = (ev: Event): void => {
    const sampleId = (ev as CustomEvent<{ sampleId?: string }>).detail
      ?.sampleId;
    if (!sampleId) return;
    this.#pcmCache.delete(sampleId);
    for (const key of [...this.#bufferCache.keys()]) {
      if (key === sampleId || key.startsWith(`${sampleId}:`)) {
        this.#bufferCache.delete(key);
      }
    }
    cancelAnimationFrame(this.#wavePaintRaf);
    this.#wavePaintRaf = requestAnimationFrame(() => {
      void this.#paintClipWaves();
    });
  };

  async #boot(): Promise<void> {
    await this.#ensureProject();
    await this.#loadSamples();
    this.#restoreUiState();
  }

  #snapshotUi(): SeqUiState {
    const timeline = this.#timelineEl();
    return {
      pxPerTick: this.pxPerTick,
      playheadTick: this.playheadTick,
      selStartTick: this.selStartTick,
      selEndTick: this.selEndTick,
      selectedId: this.selectedId,
      scrollLeft: timeline?.scrollLeft ?? this.#pendingScrollLeft ?? 0,
      viewMode: this.viewMode,
      drawerOpen: this.drawerOpen,
      drawerFilter: this.drawerFilter ?? "all",
      magnetOff: this.magnetOff,
      followPlayhead: this.#followPlayhead,
      gen: {
        seed: this.draftGenSeed >>> 0,
        density: this.draftGenDensity,
        energy: this.draftGenEnergy,
        drumsVsTexture: this.draftGenDrumsTextures,
        musicStyle: this.draftGenMusicStyle,
        groove: this.draftGenGroove,
        keyRootPc: this.draftGenKey,
        scaleMode: this.draftGenScale,
        palette: this.draftGenPalette,
        formStyle: this.draftGenForm,
        humanize: this.draftGenHumanize,
        variation: this.draftGenVariation,
        bpmSync: this.draftGenBpmSync,
        lockTempoPow2: this.draftGenLockTempoPow2,
        forbidPitchStretch: this.draftGenForbidPitchStretch,
        reverse: this.draftGenReverse,
        stutter: this.draftGenStutter,
        callResponse: this.draftGenCallResponse,
        lockPitch: this.draftGenLockPitch,
        pitchUpSemitones: this.draftGenPitchUp,
        pitchDownSemitones: this.draftGenPitchDown,
        sampleFilter: this.draftGenSampleFilter,
        advanced: this.draftGenAdvanced,
      },
    };
  }

  #persistUiState(): void {
    const id = this.project?.id;
    if (!id) return;
    seqUiState.save(id, this.#snapshotUi());
  }

  #restoreUiState(): void {
    const id = this.project?.id;
    this.#applyUiState(id ? seqUiState.load(id) : null);
  }

  #applyUiState(s: SeqUiState | null): void {
    if (!s) {
      this.pxPerTick = 0.05;
      this.playheadTick = 0;
      this.selStartTick = null;
      this.selEndTick = null;
      this.selectedId = null;
      this.viewMode = "global";
      this.drawerOpen = true;
      this.magnetOff = false;
      this.#followPlayhead = true;
      this.#pendingScrollLeft = 0;
      this.#applyGenUi(DEFAULT_SEQ_GEN_UI);
      set(seqDrawerKey, { filter: "all" });
      return;
    }
    this.pxPerTick = s.pxPerTick;
    this.playheadTick = s.playheadTick;
    this.selStartTick = s.selStartTick;
    this.selEndTick = s.selEndTick;
    this.selectedId =
      s.selectedId && this.clips.some((c) => c.id === s.selectedId)
        ? s.selectedId
        : null;
    this.viewMode = s.viewMode;
    this.drawerOpen = s.drawerOpen;
    this.magnetOff = s.magnetOff;
    this.#followPlayhead = s.followPlayhead;
    this.#applyGenUi(s.gen ?? DEFAULT_SEQ_GEN_UI);
    set(seqDrawerKey, { filter: s.drawerFilter });
    if (s.viewMode === "global" && s.followPlayhead) {
      this.#pendingScrollLeft = null;
      queueMicrotask(() => this.#syncFollowScroll());
    } else {
      this.#pendingScrollLeft = s.scrollLeft;
    }
  }

  #applyGenUi(g: NonNullable<SeqUiState["gen"]>): void {
    this.draftGenSeed = g.seed >>> 0;
    this.draftGenDensity = g.density;
    this.draftGenEnergy = g.energy;
    this.draftGenDrumsTextures = g.drumsVsTexture;
    this.draftGenMusicStyle = g.musicStyle as GenMusicStyleChoice;
    this.draftGenGroove = g.groove as GenGrooveChoice;
    this.draftGenKey = g.keyRootPc;
    this.draftGenScale = g.scaleMode as GenScaleMode;
    this.draftGenPalette = g.palette as GenPaletteChoice;
    this.draftGenForm = g.formStyle as GenFormStyle;
    this.draftGenHumanize = g.humanize;
    this.draftGenVariation = g.variation;
    this.draftGenBpmSync = g.bpmSync as GenTriState;
    this.draftGenLockTempoPow2 =
      g.lockTempoPow2 === "on" ? "on" : "off";
    this.draftGenForbidPitchStretch =
      g.forbidPitchStretch === "on" ? "on" : "off";
    this.draftGenReverse = g.reverse as GenTriState;
    this.draftGenStutter = g.stutter as GenTriState;
    this.draftGenCallResponse = g.callResponse as GenTriState;
    this.draftGenLockPitch = g.lockPitch === "on" ? "on" : "off";
    this.draftGenPitchUp = g.pitchUpSemitones;
    this.draftGenPitchDown = g.pitchDownSemitones;
    this.draftGenSampleFilter = g.sampleFilter;
    this.draftGenAdvanced = g.advanced;
  }

  /** Persist generator drafts (localStorage via seqUiState). */
  #persistGenUi(): void {
    this.#persistUiState();
  }

  override firstUpdated(): void {
    const timeline = this.#timelineEl();
    if (timeline) {
      this.#unsubWheel = bindTimelineWheel(timeline, {
        getPxPerUnit: () => this.pxPerTick,
        contentOriginPx: 0,
        minPx: MIN_PX_PER_TICK,
        maxPx: MAX_PX_PER_TICK,
        onZoom: (next) => {
          this.#pendingScrollLeft = next.scrollLeft;
          this.pxPerTick = next.pxPerUnit;
          queueMicrotask(() => this.#syncViewWindow());
        },
      });
      // Horizontal wheel/trackpad pan = intentional look-away (not follow scroll).
      timeline.addEventListener("wheel", this.#onTimelineUserWheel, {
        passive: true,
      });
      timeline.addEventListener("scroll", this.#onTimelineScroll, {
        passive: true,
      });
      const syncViewW = () => {
        timeline.style.setProperty(
          "--gl-tl-view-w",
          `${Math.max(1, timeline.clientWidth)}px`,
        );
        this.#syncViewWindow();
      };
      syncViewW();
      if (typeof ResizeObserver !== "undefined") {
        this.#tlRo = new ResizeObserver(syncViewW);
        this.#tlRo.observe(timeline);
      }
    }
  }

  #timelineEl(): HTMLElement | null {
    return this.renderRoot.querySelector(".timeline");
  }

  #onTimelineUserWheel = (e: WheelEvent): void => {
    if (this.#viewBusy) return;
    // Vertical / ctrl = zoom (handled elsewhere). Horizontal pan = free view.
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return;
    if (Math.abs(e.deltaX) < 0.5) return;
    this.#setFollowPlayhead(false);
  };

  #onTimelineScroll = (): void => {
    this.#syncViewWindow();
  };

  #setFollowPlayhead(follow: boolean): void {
    this.#followPlayhead = follow;
    this.viewMode = follow ? "global" : "vue";
  }

  /** Visible tick range → seek-bar view window. */
  #syncViewWindow(): void {
    const timeline = this.#timelineEl();
    if (!timeline) return;
    const max = Math.max(1, this.#projectLengthTick());
    const usableW = Math.max(64, timeline.clientWidth - TRACK_LABEL_PX);
    const start = timeline.scrollLeft / this.pxPerTick;
    const end = (timeline.scrollLeft + usableW) / this.pxPerTick;
    this.viewStartTick = Math.max(0, Math.min(max, start));
    this.viewEndTick = Math.max(
      this.viewStartTick,
      Math.min(max, end),
    );
  }

  /**
   * Scroll the sequence under a centered playhead.
   * At sequence start/end, scroll clamps and the bar moves in the view instead.
   * Scrub / seek-bar force follow (priority over play + look-away pan).
   */
  #syncFollowScroll(force = false): void {
    if (!force) {
      if (!this.#followPlayhead || this.#viewBusy) return;
    }
    const timeline = this.#timelineEl();
    if (!timeline) return;
    const usableW = Math.max(64, timeline.clientWidth - TRACK_LABEL_PX);
    const next = scrollLeftToCenterUnit(
      this.playheadTick,
      this.pxPerTick,
      usableW,
      0,
      Math.max(usableW, timeline.scrollWidth - TRACK_LABEL_PX),
    );
    if (timeline.scrollLeft !== next) timeline.scrollLeft = next;
    else this.#syncViewWindow();
  }

  /** Tick under clientX in the scrolled timeline (right tools gutter excluded). */
  #tickAtClientX(clientX: number): number {
    const timeline = this.#timelineEl();
    if (!timeline) return 0;
    const rect = timeline.getBoundingClientRect();
    const contentX = timeline.scrollLeft + (clientX - rect.left);
    return Math.max(0, Math.round(contentX / this.pxPerTick));
  }

  /** Zoom about clientX (AudioRoom vertical / wheel). */
  #zoomAtClientX(dy: number, clientX: number): void {
    const timeline = this.#timelineEl();
    if (!timeline) return;
    const next = zoomAtClientX(
      timeline,
      this.pxPerTick,
      dy,
      clientX,
      0,
      MIN_PX_PER_TICK,
      MAX_PX_PER_TICK,
    );
    if (!next) return;
    // Apply scroll after Lit widens/narrows lanes — else browser clamps
    // scrollLeft against pre-zoom scrollWidth (breaks scrolled / off-screen).
    this.#pendingScrollLeft = next.scrollLeft;
    this.pxPerTick = next.pxPerUnit;
  }

  get #drawerSamples(): Sample[] {
    let list = this.samples;
    // FormCheckable `unique` can write null when sibling buttons mount; treat as all.
    if (this.drawerFilter === "favorite") {
      list = list.filter((s) => s.favorite);
    } else if (this.drawerFilter && this.drawerFilter !== "all") {
      list = list.filter((s) => s.class === this.drawerFilter);
    }
    return list.slice(0, 80);
  }

  override render() {
    const filters: Array<SampleClass | "all" | "favorite"> = [
      "all",
      "favorite",
      "percussive",
      "tonal",
      "texture",
      "noise",
      "rhythmic",
    ];
    const selL =
      this.selStartTick != null && this.selEndTick != null
        ? Math.min(this.selStartTick, this.selEndTick)
        : null;
    const selR =
      this.selStartTick != null && this.selEndTick != null
        ? Math.max(this.selStartTick, this.selEndTick)
        : null;
    const hasLoopSel = selL != null && selR != null && selR > selL + MIN_CLIP_TICKS / 4;
    const laneW = this.#laneMinWidthPx();
    const bars = this.project?.bars ?? 16;
    const seqLenTick = this.#projectLengthTick();
    const seqDurMs = this.project
      ? ticksToMs(seqLenTick, this.project.bpm)
      : 0;
    const seqEndPx = seqLenTick * this.pxPerTick;
    const bpm = this.project?.bpm ?? 120;
    return html`
      <div
        class="toolbar flex shrink-0 flex-wrap items-center gap-2 px-4 pb-1.5 pt-3 max-md:gap-1.5 max-md:px-2.5 max-md:pb-1 max-md:pt-2"
      >
        ${this.selectedId
          ? html`<sonic-button
              size="sm"
              variant="outline"
              type=${this.rotateClipTool ? "primary" : "neutral"}
              @click=${() => {
                this.rotateClipTool = !this.rotateClipTool;
              }}
            >
              ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
              ${t("seq.rotate")}
            </sonic-button>`
          : nothing}
        <sonic-pop class="more ml-auto" placement="bottom-end">
          <sonic-button
            shape="circle"
            variant="ghost"
            type="neutral"
            size="sm"
            icon
            data-aria-label=${t("seq.more")}
          >
            ${glIcon("more-vertical", { size: "sm" })}
          </sonic-button>
          <div
            slot="content"
            class="max-h-[min(70dvh,24rem)] overflow-y-auto overscroll-contain"
          >
            <sonic-menu direction="column" align="left" size="sm">
              <sonic-menu-item
                ?disabled=${!this.project}
                @click=${() => this.#openSeqModal("bpm")}
              >
                ${glIcon("gauge", { slot: "prefix", size: "xs" })}
                ${t("seq.bpmTitle")} · ${bpm}
              </sonic-menu-item>
              <sonic-menu-item
                ?disabled=${!this.project}
                @click=${() => this.#openSeqModal("bars")}
              >
                ${glIcon("ruler", { slot: "prefix", size: "xs" })}
                ${t("seq.barsTitle")} · ${bars} ${t("seq.barsUnit")}
              </sonic-menu-item>
              <sonic-divider></sonic-divider>
              <sonic-menu-item @click=${() => void this.#undo()}>
                ${glIcon("undo", { slot: "prefix", size: "xs" })}
                ${t("seq.undo")}
              </sonic-menu-item>
              <sonic-menu-item
                ?disabled=${!this.project ||
                this.samples.length === 0 ||
                this.tracks.length === 0}
                @click=${() => this.#openSeqModal("generate")}
              >
                ${glIcon("wand", { slot: "prefix", size: "xs" })}
                ${t("seq.generate")}
              </sonic-menu-item>
              <sonic-menu-item
                ?disabled=${!this.project ||
                this.clips.length === 0 ||
                Boolean(this.exportBusy)}
                @click=${() => void this.#toggleExportPanel()}
              >
                ${glIcon("download", { slot: "prefix", size: "xs" })}
                ${this.exportBusy ?? t("export.open")}
              </sonic-menu-item>
              <sonic-divider></sonic-divider>
              <sonic-menu-item @click=${() => this.#openSeqModal("docs")}>
                ${glIcon("book-open", { slot: "prefix", size: "xs" })}
                ${t("seq.docs")}
              </sonic-menu-item>
            </sonic-menu>
          </div>
        </sonic-pop>
      </div>
      ${this.#renderExportModal()}
      ${this.#renderSeqModals(bars, seqDurMs)}
      ${this.#renderClipOptsModal()}
      ${this.#renderClipCtxMenu()}
      <div class="workspace relative flex min-h-0 flex-1 overflow-hidden">
        <div class="timeline">
          ${this.dropCancelOpen
            ? html`<div
                class="cancel-zone ${this.cancelHot ? "hot" : ""}"
                title=${this.dragClipId
                  ? "Supprimer (déposer ici)"
                  : "Annuler (déposer ici)"}
                aria-label=${this.dragClipId
                  ? "Supprimer (déposer ici)"
                  : "Annuler (déposer ici)"}
              >
                ${glIcon("trash-2", { size: "sm" })}
              </div>`
            : nothing}
          <div
            class="timeline-canvas"
            style="min-width:${laneW + TRACK_LABEL_PX + Math.ceil(HANDLE_PX / 2)}px"
          >
            ${this.#renderTimeRuler(
              laneW,
              seqEndPx,
              hasLoopSel,
              selL,
              selR,
              bpm,
              bars,
              seqDurMs,
            )}
            <div
              class="playhead"
              style="left:${this.playheadTick * this.pxPerTick}px"
            ></div>
            ${hasLoopSel
              ? html`<div
                  class="loop-sel"
                  style="left:${selL! * this.pxPerTick}px;width:${Math.max(
                    2,
                    (selR! - selL!) * this.pxPerTick,
                  )}px"
                  title="Sélection = boucle"
                ></div>`
              : null}
            ${hasLoopSel
              ? html`
                  <div
                    class="time-handle"
                    style="left:${selL! * this.pxPerTick}px"
                    title="Entrée de boucle"
                    @pointerdown=${(e: PointerEvent) =>
                      this.#loopEdgeDown(e, "start")}
                  ></div>
                  <div
                    class="time-handle"
                    style="left:${selR! * this.pxPerTick}px"
                    title="Sortie de boucle"
                    @pointerdown=${(e: PointerEvent) =>
                      this.#loopEdgeDown(e, "end")}
                  ></div>
                `
              : null}
            <div
              class="time-handle playhead"
              style="left:${this.playheadTick * this.pxPerTick}px"
              title="Tête de lecture"
              @pointerdown=${this.#playheadDown}
            ></div>
            ${this.tracks.map((tr) => this.#renderTrack(tr, laneW))}
          </div>
        </div>
        ${this.#renderSampleDrawer(filters)}
      </div>
      <div
        class="seek-row mx-4 mb-1.5 flex shrink-0 items-center gap-1.5 max-md:mx-2.5 max-md:mb-1.5"
      >
        <gl-seek-bar
          class="block min-w-0 flex-1"
          .value=${this.playheadTick}
          .max=${Math.max(1, this.#projectLengthTick())}
          .viewStart=${this.viewStartTick}
          .viewEnd=${this.viewEndTick}
          ?disabled=${!this.project}
          @gl-seek-start=${this.#onSeekBarStart}
          @gl-seek=${this.#onSeekBar}
          @gl-seek-end=${this.#onSeekBarEnd}
        ></gl-seek-bar>
        <span
          class="view-mode min-w-[2.6rem] shrink-0 select-none text-right font-mono text-[0.6rem] lowercase tracking-wide text-neutral-500"
          title=${t("tl.viewModeHint")}
          >${this.viewMode === "vue" ? t("tl.view") : t("tl.global")}</span
        >
      </div>
      <div class="transport-wrap shrink-0 px-4 pb-1.5 max-md:px-2.5 max-md:pb-1">
        <gl-transport-bar
          .playing=${this.playing}
          .loading=${this.loadingPlay}
          .clock=${formatClock(
            this.project
              ? ticksToMs(this.playheadTick, this.project.bpm)
              : 0,
          )}
          ?disabled=${!this.project}
          @gl-transport=${this.#onTransport}
        >
        </gl-transport-bar>
      </div>
      ${this.ghost
        ? html`<div
            class="ghost"
            style="left:${this.ghost.x}px;top:${this.ghost.y}px"
          >
            ${this.ghost.label}
          </div>`
        : null}
    `;
  }

  #renderSampleDrawer(
    filters: Array<SampleClass | "all" | "favorite">,
  ) {
    const label = this.drawerOpen
      ? t("seq.libraryClose")
      : t("seq.libraryOpen");
    return html`
      <button
        type="button"
        class="drawer-switch z-10 inline-flex w-7 shrink-0 cursor-pointer items-center justify-center self-stretch border-0 border-l border-neutral-500/15 bg-neutral-0 p-0 text-neutral-500 hover:bg-neutral-100 hover:text-content focus-visible:bg-neutral-100 focus-visible:text-content"
        title=${label}
        aria-label=${label}
        aria-expanded=${this.drawerOpen}
        aria-controls="gl-seq-drawer"
        @click=${() => (this.drawerOpen = !this.drawerOpen)}
      >
        ${glIcon(this.drawerOpen ? "chevron-right" : "chevron-left", {
          size: "xs",
        })}
      </button>
      <aside
        id="gl-seq-drawer"
        class="drawer absolute inset-y-0 right-7 z-[9] flex h-full max-h-full min-h-0 w-[min(280px,42vw)] flex-col gap-2 overflow-hidden bg-neutral-0 p-2.5 pb-3 shadow-[-8px_0_28px_rgba(0,0,0,0.4)] max-md:w-[min(300px,88vw)] max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        ?hidden=${!this.drawerOpen}
        aria-label=${t("seq.library")}
      >
        <div class="drawer-head flex shrink-0 items-center gap-1.5">
          <strong class="text-[0.8rem] tracking-wide">${t("seq.library")}</strong>
        </div>
        <div class="drawer-filters flex shrink-0 flex-wrap items-center gap-1">
          ${this.#renderDrawerFilterPop(filters)}
        </div>
        <div
          class="drawer-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]"
        >
          ${this.#drawerSamples.length === 0
            ? html`<p class="font-mono text-[0.7rem] text-neutral-500">
                Aucun sample — capture d’abord.
              </p>`
            : this.#drawerSamples.map(
                (s) => html`
                  <button
                    class="drawer-item grid min-h-touch cursor-grab grid-cols-[8px_1fr_auto] items-center gap-2 rounded-md border-0 bg-neutral-100 p-2 text-left font-[inherit] text-inherit touch-none select-none ${this.placingSampleId === s.id
                      ? "opacity-45"
                      : ""}"
                    type="button"
                    @pointerdown=${(e: PointerEvent) =>
                      this.#drawerDown(e, s)}
                  >
                    <span
                      class="h-7 w-2 rounded-sm"
                      style="background:${CLASS_COLORS[s.class]}"
                    ></span>
                    <span>
                      <div>${s.userName ?? s.name}</div>
                      <div class="font-mono text-[0.7rem] text-neutral-500">
                        ${s.class} · ${s.durationMs}ms
                      </div>
                    </span>
                    <span class="font-mono text-[0.7rem] text-neutral-500"
                      >${s.favorite ? "★" : "⋮⋮"}</span
                    >
                  </button>
                `,
              )}
        </div>
      </aside>
    `;
  }

  #renderDrawerFilterPop(
    filters: Array<SampleClass | "all" | "favorite">,
  ) {
    const current = this.drawerFilter ?? "all";
    return html`
      <gl-pop-select
        class="w-full max-w-full"
        size="2xs"
        .value=${current}
        .options=${filters.map((f) => ({
          value: f,
          label:
            f === "all"
              ? t("seq.allFilters")
              : f === "favorite"
                ? t("seq.filterFavorite")
                : f,
        }))}
        placeholder=${t("seq.allFilters")}
        searchPlaceholder=${t("seq.popSearch")}
        ?active=${current !== "all"}
        @gl-change=${(e: CustomEvent<{ value: string }>) => {
          set(
            seqDrawerKey.filter,
            e.detail.value as SampleClass | "all" | "favorite",
          );
        }}
      ></gl-pop-select>
    `;
  }

  #renderTimeRuler(
    laneW: number,
    seqEndPx: number,
    hasLoopSel: boolean,
    selL: number | null,
    selR: number | null,
    bpm: number,
    bars: number,
    seqDurMs: number,
  ) {
    const marks = this.#rulerMarks();
    return html`
      <div class="time-ruler">
        <div
          class="ruler-lane"
          style="min-width:${laneW}px"
          @pointerdown=${this.#rulerDown}
        >
          ${marks.map(
            (m) => html`
              <div
                class="ruler-mark ${m.major ? "major" : ""}"
                style="left:${m.tick * this.pxPerTick}px"
              >
                ${m.label
                  ? html`<span class="lbl">${m.label}</span>`
                  : null}
                ${m.clock
                  ? html`<span class="clk">${m.clock}</span>`
                  : null}
              </div>
            `,
          )}
          <div
            class="ruler-progress"
            style="width:${Math.max(0, this.playheadTick * this.pxPerTick)}px"
            aria-hidden="true"
          ></div>
          ${hasLoopSel && selL != null && selR != null
            ? html`<div
                class="loop-move"
                style="left:${selL * this.pxPerTick}px;width:${Math.max(
                  2,
                  (selR - selL) * this.pxPerTick,
                )}px"
                title="Déplacer la boucle"
                @pointerdown=${this.#loopMoveDown}
              ></div>`
            : null}
          <div
            class="seq-end"
            style="left:${seqEndPx}px"
            title="Glisser pour changer la durée"
            @pointerdown=${this.#seqEndDown}
          ></div>
        </div>
        <div
          class="ruler-gutter flex flex-col justify-center gap-px px-1 font-mono text-[0.6rem] text-neutral-500"
          aria-label=${t("seq.barsTitle")}
        >
          <button
            type="button"
            class="stat block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-px px-0.5 text-left font-mono text-[0.55rem] leading-tight text-neutral-500 hover:bg-neutral-500/10 hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
            ?disabled=${!this.project}
            title=${t("seq.bpmTitle")}
            @click=${() => this.#openSeqModal("bpm")}
          >
            ${bpm} ${t("seq.bpm")}
          </button>
          <button
            type="button"
            class="stat block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-px px-0.5 text-left font-mono text-[0.55rem] leading-tight text-neutral-500 hover:bg-neutral-500/10 hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
            ?disabled=${!this.project}
            title=${t("seq.barsTitle")}
            @click=${() => this.#openSeqModal("bars")}
          >
            ${bars} ${t("seq.barsUnit")} · ${formatClock(seqDurMs)}
          </button>
        </div>
      </div>
    `;
  }

  #renderTrack(tr: Track, laneW: number) {
    const laneClips = this.clips.filter((c) => c.trackId === tr.id);
    const xfades = trackXfadeZones(laneClips);
    const lin = gainDbToLin(tr.gainDb);
    return html`
      <div class="track">
        <div
          class="lane ${this.dropTrackId === tr.id ? "drop-target" : ""}"
          data-track=${tr.id}
          style="min-width:${laneW}px"
          @pointerdown=${(e: PointerEvent) => this.#laneDown(e, tr.id)}
        >
          ${xfades.map(
            (z) => html`
              <div
                class="xfade"
                style="left:${z.startTick * this.pxPerTick}px;width:${z.lengthTick *
                this.pxPerTick}px"
                title="crossfade"
              ></div>
            `,
          )}
          ${laneClips.map((c) => this.#renderClip(c))}
        </div>
        <div
          class="track-label flex flex-col justify-center gap-0.5 px-1.5 py-1.5 text-xs text-neutral-500"
        >
          <span class="truncate text-content">${tr.name}</span>
          <div class="flex flex-wrap items-center gap-0.5">
            <button
              type="button"
              class="mute-sw ${tr.mute ? "on" : ""}"
              title=${tr.mute ? "Unmute" : "Mute"}
              aria-pressed=${tr.mute}
              aria-label=${tr.mute ? "Unmute" : "Mute"}
              @click=${() => void this.#toggleMute(tr)}
            ></button>
            <gl-track-volume-rotary
              .gainDb=${tr.gainDb}
              @gl-gain=${(e: CustomEvent<{ gainDb: number; commit: boolean }>) =>
                void this.#onTrackGain(tr, e.detail.gainDb, e.detail.commit)}
            ></gl-track-volume-rotary>
            <button
              type="button"
              class="solo inline-flex h-6 w-7 items-center justify-center rounded-md border border-neutral-500/20 bg-transparent p-0 text-neutral-500 ${tr.solo
                ? "border-transparent bg-primary text-neutral-0"
                : ""}"
              title="Solo"
              aria-pressed=${tr.solo}
              @click=${() => void this.#toggleSolo(tr)}
            >
              ${glIcon("headphones", { size: "xs" })}
            </button>
            <gl-track-fx-control
              .fx=${tr.fx}
              @gl-fx=${(e: CustomEvent<{ fx: TrackFx; commit: boolean }>) =>
                void this.#onTrackFx(tr, e.detail.fx, e.detail.commit)}
            ></gl-track-fx-control>
          </div>
          <span class="font-mono text-[0.6rem] opacity-75"
            >×${lin.toFixed(lin === 0 || lin === 1 || lin === 2 ? 0 : 2)}</span
          >
        </div>
      </div>
    `;
  }

  #renderClip(c: Clip) {
    const sample = this.samples.find((s) => s.id === c.sampleId);
    const color = sample
      ? CLASS_COLORS[sample.class]
      : CLASS_COLORS.texture;
    const selected = this.selectedId === c.id;
    const clipW = Math.max(8, c.lengthTick * this.pxPerTick);
    const clipName = sample?.userName ?? sample?.name ?? "";
    return html`
      <div
        class="clip ${selected ? "selected" : ""} ${this.snapHighlightId ===
        c.id
          ? "snap"
          : ""}"
        style="left:${c.startTick * this.pxPerTick}px;width:${clipW}px;background:${color}"
        data-clip=${c.id}
        title=${clipName
          ? `${clipName} · fade ${c.fadeInMs}/${c.fadeOutMs} ms`
          : `fade ${c.fadeInMs}/${c.fadeOutMs} ms`}
        @pointerdown=${(e: PointerEvent) => this.#clipDown(e, c)}
      >
        ${clipName
          ? html`<span class="clip-name">${clipName}</span>`
          : nothing}
        ${selected
          ? html`<canvas
              class="wave"
              data-wave-clip=${c.id}
              aria-hidden="true"
            ></canvas>`
          : null}
        ${selected
          ? html`
              <div
                class="handle start"
                @pointerdown=${(e: PointerEvent) =>
                  this.#trimDown(e, c, "start")}
              ></div>
              <div
                class="handle end"
                @pointerdown=${(e: PointerEvent) =>
                  this.#trimDown(e, c, "end")}
              ></div>
            `
          : null}
      </div>
    `;
  }

  async #loadSamples(): Promise<void> {
    const projectId = this.project?.id ?? (await projectWorkspace.currentId());
    this.samples = await db.samples
      .where("projectId")
      .equals(projectId)
      .filter((s) => !s.deletedAt && s.class !== "voice")
      .reverse()
      .sortBy("createdAt");
  }

  async #audition(s: Sample): Promise<void> {
    this.#engine ??= new TransportEngine();
    const data = await loadSampleAudio(s);
    if (!data) return;
    const buf = this.#engine.ctx.createBuffer(
      1,
      data.pcm.length,
      data.sampleRate,
    );
    buf.copyToChannel(new Float32Array(data.pcm), 0);
    this.#engine.audition(buf, 5);
  }

  #drawerDown = (e: PointerEvent, sample: Sample): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let mode: "pending" | "drag" = "pending";
    const label = sample.userName ?? sample.name;

    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (mode === "pending" && dist >= 8) {
        mode = "drag";
        this.placingSampleId = sample.id;
        this.dropCancelOpen = true;
      }
      if (mode !== "drag") return;
      this.ghost = { x: ev.clientX, y: ev.clientY, label };
      this.cancelHot = this.#inCancelZone(ev.clientX, ev.clientY);
      this.dropTrackId = this.cancelHot
        ? null
        : this.#trackIdAtPoint(ev.clientX, ev.clientY);
    };

    const up = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.ghost = null;
      this.cancelHot = false;
      this.dropCancelOpen = false;
      this.placingSampleId = null;
      const trackId = this.dropTrackId;
      this.dropTrackId = null;

      if (mode === "pending") {
        await this.#audition(sample);
        return;
      }
      if (this.#inCancelZone(ev.clientX, ev.clientY) || !trackId) return;
      const track = this.tracks.find((t) => t.id === trackId);
      if (!track) return;
      await this.#placeSample(sample, track, ev.clientX);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  #trackIdAtPoint(clientX: number, clientY: number): string | null {
    const root = this.shadowRoot;
    if (!root) return null;
    const stack = root.elementsFromPoint?.(clientX, clientY) ?? [
      root.elementFromPoint(clientX, clientY),
    ];
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      const lane = el.closest(".lane") as HTMLElement | null;
      if (lane?.dataset.track) return lane.dataset.track;
    }
    return null;
  }

  /** Resolve track by Y — needed while dragging a clip (hit target stays under pointer). */
  #trackIdAtY(clientY: number): string | null {
    const root = this.shadowRoot;
    if (!root) return null;
    for (const tr of this.tracks) {
      const lane = root.querySelector(
        `.lane[data-track="${tr.id}"]`,
      ) as HTMLElement | null;
      const row = lane?.closest(".track") as HTMLElement | null;
      const rect = row?.getBoundingClientRect();
      if (rect && clientY >= rect.top && clientY < rect.bottom) return tr.id;
    }
    return null;
  }

  async #placeSample(
    sample: Sample,
    track: Track,
    clientX: number,
  ): Promise<void> {
    if (!this.project) return;
    let startTick = this.#tickAtClientX(clientX);
    const lengthTick = Math.max(
      MIN_CLIP_TICKS,
      Math.round(((sample.durationMs / 1000) * this.project.bpm * PPQ) / 60),
    );
    const radius = pxRadiusToTicks(12, this.pxPerTick);
    const sameTrack = this.clips.filter((c) => c.trackId === track.id);
    const snapped = snapTick(
      startTick,
      [
        ...clipEdgeTargets(sameTrack),
        ...gridTargets(startTick - 2000, startTick + 2000, 240),
      ],
      radius,
    );
    startTick = snapped.tick;

    let draft = { startTick, lengthTick };
    for (const other of sameTrack) {
      const r = clampOverlapStart(draft, other);
      if (r.blocked) draft = { ...draft, startTick: Math.max(0, r.startTick) };
    }
    draft = this.#clampClipToSeq(draft.startTick, draft.lengthTick);

    const clip: Clip = {
      id: createEntityId(),
      trackId: track.id,
      sampleVersionId: createEntityId(),
      sampleId: sample.id,
      startTick: draft.startTick,
      lengthTick: draft.lengthTick,
      contentOffsetMs: 0,
      loopEnabled: sample.loopScore != null && sample.loopScore > 0.5,
      loopLengthMs:
        sample.loopEndMs && sample.loopStartMs
          ? sample.loopEndMs - sample.loopStartMs
          : undefined,
      gainDb: 0,
      fadeInMs: 5,
      fadeOutMs: 5,
      fadeCurve: "equal-power",
      pitchSemitones: 0,
      stretchMode: "off",
      reverse: false,
    };
    await db.clips.put(clip);
    await db.ops.add({
      id: createEntityId(),
      entityType: "clip",
      entityId: clip.id,
      op: "create",
      payload: clip as unknown as Record<string, unknown>,
      clientSeq: Date.now(),
      clientId: "local",
      createdAt: nowIso(),
    });
    let next = [...this.clips, clip];
    next = await this.#persistFades(next, track.id);
    this.clips = next;
    this.selectedId = clip.id;
    if (navigator.vibrate) navigator.vibrate(8);
    if (this.playing) await this.#resyncSchedule();
  }

  async #persistFades(clips: Clip[], trackId: string): Promise<Clip[]> {
    if (!this.project) return clips;
    const next = applyOverlapFades(clips, trackId, this.project.bpm);
    const changed = next.filter((c, i) => {
      const prev = clips[i];
      return (
        prev &&
        (prev.fadeInMs !== c.fadeInMs || prev.fadeOutMs !== c.fadeOutMs)
      );
    });
    // Also catch by id when order differs
    for (const c of next) {
      const prev = clips.find((p) => p.id === c.id);
      if (
        prev &&
        (prev.fadeInMs !== c.fadeInMs || prev.fadeOutMs !== c.fadeOutMs)
      ) {
        await db.clips.put(c);
      }
    }
    void changed;
    return next;
  }

  async #ensureProject(): Promise<void> {
    let p: Project | null = null;
    if (this.projectId) {
      const routed = await db.projects.get(this.projectId);
      if (routed && !routed.deletedAt) p = routed;
    }
    if (!p) {
      p = await projectWorkspace.ensure();
    } else {
      const cur = await projectWorkspace.currentId();
      if (cur !== p.id) await projectWorkspace.switchTo(p.id);
    }
    if (this.playing) {
      this.#engine?.stop();
      this.playing = false;
    }
    this.project = p;
    const rawTracks = await db.tracks
      .where("projectId")
      .equals(p.id)
      .sortBy("index");
    this.tracks = rawTracks.map(normalizeTrack);
    this.clips = await db.clips
      .where("trackId")
      .anyOf(this.tracks.map((t) => t.id))
      .toArray();
    this.selectedId = null;
    this.#engine = new TransportEngine();
    this.#engine.master.gain.value = dbToGain(p.masterGainDb);
    this.#syncTrackBuses();
  }

  #syncTrackBuses(): void {
    const bpm = this.project?.bpm ?? 120;
    this.#engine?.syncTrackBuses(
      this.tracks.map((tr) => trackToInsertConfig(tr, bpm)),
    );
  }

  async #toggleMute(tr: Track): Promise<void> {
    tr.mute = !tr.mute;
    await db.tracks.put(tr);
    this.tracks = [...this.tracks];
    if (this.playing) await this.#resyncSchedule();
  }

  async #toggleSolo(tr: Track): Promise<void> {
    tr.solo = !tr.solo;
    await db.tracks.put(tr);
    this.tracks = [...this.tracks];
    if (this.playing) await this.#resyncSchedule();
  }

  #gainWriteBusy = false;

  async #onTrackGain(
    tr: Track,
    gainDb: number,
    commit: boolean,
  ): Promise<void> {
    tr.gainDb = gainDb;
    this.tracks = [...this.tracks];
    this.#bounceCache = null;
    this.#engine?.setTrackInsert(
      trackToInsertConfig(tr, this.project?.bpm ?? 120),
    );
    if (!commit) {
      if (this.playing && !this.#gainWriteBusy) {
        this.#gainWriteBusy = true;
        try {
          await db.tracks.put(tr);
        } finally {
          this.#gainWriteBusy = false;
        }
      }
      return;
    }
    await db.tracks.put(tr);
  }

  async #onTrackFx(
    tr: Track,
    fx: TrackFx,
    commit: boolean,
  ): Promise<void> {
    tr.fx = fx;
    this.tracks = [...this.tracks];
    this.#bounceCache = null;
    this.#engine?.setTrackInsert(
      trackToInsertConfig(tr, this.project?.bpm ?? 120),
    );
    if (commit) await db.tracks.put(tr);
  }

  async #ensureSamplePcm(
    sampleId: string,
  ): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
    const cached = this.#pcmCache.get(sampleId);
    if (cached) {
      // Refresh LRU order
      this.#pcmCache.delete(sampleId);
      this.#pcmCache.set(sampleId, cached);
      return cached;
    }
    const sample = await db.samples.get(sampleId);
    if (!sample) return null;
    const data = await loadSampleAudio(sample);
    if (!data || data.pcm.length === 0) return null;
    const entry = {
      pcm: new Float32Array(data.pcm),
      sampleRate: data.sampleRate,
    };
    this.#pcmCache.set(sampleId, entry);
    while (this.#pcmCache.size > PCM_CACHE_MAX) {
      const oldest = this.#pcmCache.keys().next().value;
      if (oldest == null) break;
      this.#pcmCache.delete(oldest);
    }
    return entry;
  }

  async #paintClipWaves(): Promise<void> {
    if (!this.project || !this.selectedId) return;
    const token = ++this.#wavePaintToken;
    const clip = this.clips.find((c) => c.id === this.selectedId);
    if (!clip?.sampleId) return;
    const canvas = this.renderRoot.querySelector<HTMLCanvasElement>(
      `canvas[data-wave-clip="${CSS.escape(clip.id)}"]`,
    );
    if (!canvas) return;
    const entry = await this.#ensureSamplePcm(clip.sampleId);
    if (token !== this.#wavePaintToken) return;
    if (!entry) return;
    const clipSamples = ticksToSamples(
      asTick(clip.lengthTick),
      this.project.bpm,
      entry.sampleRate,
    );
    const offsetSamples = msToSamples(clip.contentOffsetMs, entry.sampleRate);
    const track = this.tracks.find((t) => t.id === clip.trackId);
    const cssW = Math.max(8, clip.lengthTick * this.pxPerTick);
    const cssH = Math.max(24, (track?.heightPx ?? 56) - 8);
    const pcm = clip.reverse ? Float32Array.from(entry.pcm).reverse() : entry.pcm;
    paintStretchedWave(
      canvas,
      pcm,
      clip.stretchMode,
      Math.max(1, clipSamples),
      offsetSamples,
      cssW,
      cssH,
    );
  }

  async #loadBufferForSample(
    sampleId: string,
    clip?: Clip,
    opts?: { bakeCopy?: boolean },
  ): Promise<AudioBuffer | null> {
    if (!this.#engine || !this.project) return null;
    const bakeCopy = opts?.bakeCopy === true;
    const cacheKey = clip
      ? `${sampleId}:${clip.stretchMode}:${clip.lengthTick}:${clip.contentOffsetMs}:${clip.loopEnabled ? 1 : 0}:${clip.loopLengthMs ?? 0}:${clip.reverse ? 1 : 0}:${bakeCopy ? "bake" : "live"}`
      : sampleId;
    const cached = this.#bufferCache.get(cacheKey);
    if (cached) {
      this.#bufferCache.delete(cacheKey);
      this.#bufferCache.set(cacheKey, cached);
      return cached;
    }
    const data = await this.#ensureSamplePcm(sampleId);
    if (!data) return null;
    let pcm = data.pcm.slice();

    if (clip?.reverse) {
      pcm.reverse();
    }

    // Live play: never tile `copy` / loop to full clip length (OOM on long clips).
    // Export/bounce still bakes a contiguous buffer for OfflineAudioContext.
    if (
      clip &&
      bakeCopy &&
      (clip.stretchMode === "copy" || clip.loopEnabled)
    ) {
      const target = ticksToSamples(
        asTick(clip.lengthTick),
        this.project.bpm,
        data.sampleRate,
      );
      const offset = msToSamples(clip.contentOffsetMs, data.sampleRate);
      if (
        clip.loopEnabled &&
        clip.loopLengthMs != null &&
        clip.loopLengthMs > 0
      ) {
        const loopSamples = Math.max(
          1,
          msToSamples(clip.loopLengthMs, data.sampleRate),
        );
        const end = Math.min(pcm.length, offset + loopSamples);
        const slice = pcm.subarray(Math.min(offset, pcm.length), end);
        pcm = new Float32Array(
          tileBuffer(slice.length > 0 ? slice : pcm, Math.max(1, target), 0),
        );
      } else {
        pcm = new Float32Array(tileBuffer(pcm, Math.max(1, target), offset));
      }
    } else if (
      clip &&
      clip.stretchMode !== "off" &&
      clip.stretchMode !== "copy"
    ) {
      const target = ticksToSamples(
        asTick(clip.lengthTick),
        this.project.bpm,
        data.sampleRate,
      );
      const ratio = pcm.length / Math.max(1, target);
      if (Math.abs(ratio - 1) > 0.01) {
        const mode =
          clip.stretchMode === "resample" ? "resample" : "preserve-pitch";
        pcm = new Float32Array(stretchBuffer(pcm, ratio, mode));
      }
    }

    const buf = this.#engine.ctx.createBuffer(1, pcm.length, data.sampleRate);
    buf.copyToChannel(pcm, 0);
    this.#bufferCache.set(cacheKey, buf);
    while (this.#bufferCache.size > BUFFER_CACHE_MAX) {
      const oldest = this.#bufferCache.keys().next().value;
      if (oldest == null) break;
      this.#bufferCache.delete(oldest);
    }
    return buf;
  }

  #playPreloadTicks(): number {
    return PLAY_PRELOAD_BEATS * PPQ;
  }

  async #buildSchedule(opts?: {
    ignoreLoop?: boolean;
    /** Only clips intersecting this tick window (live play). Omit = all. */
    windowTicks?: { from: number; to: number };
    /** Bake stretchMode `copy` into a full buffer (export only). */
    bakeCopy?: boolean;
  }) {
    if (!this.#engine || !this.project) return [];
    this.#syncTrackBuses();
    const audible = audibleTrackIds(this.tracks);
    const loopRange = opts?.ignoreLoop ? null : this.#loopSelRange();
    const win = opts?.windowTicks;
    const bakeCopy = opts?.bakeCopy === true;
    const out = [];
    for (const clip of this.clips) {
      if (!audible.has(clip.trackId)) continue;
      if (!clip.sampleId) continue;
      const clipEnd = clip.startTick + clip.lengthTick;
      if (loopRange) {
        if (clipEnd <= loopRange.start || clip.startTick >= loopRange.end) {
          continue;
        }
      }
      if (win) {
        if (clipEnd <= win.from || clip.startTick >= win.to) continue;
      }
      const buf = await this.#loadBufferForSample(clip.sampleId, clip, {
        bakeCopy,
      });
      if (!buf) continue;
      // Live `copy`: keep source buffer + force loop (no giant tile).
      // Export bake: contentOffset / loop window already tiled into the buffer.
      const scheduledClip =
        clip.stretchMode === "copy" || (bakeCopy && clip.loopEnabled)
          ? bakeCopy
            ? {
                ...clip,
                contentOffsetMs: 0,
                loopEnabled: false,
                loopLengthMs: undefined,
              }
            : { ...clip, loopEnabled: true }
          : clip;
      out.push(
        clipToScheduled(
          scheduledClip,
          buf,
          this.project.bpm,
          this.#engine.sampleRate,
        ),
      );
    }
    return out;
  }

  async #resyncSchedule(): Promise<void> {
    if (!this.#engine || !this.playing || !this.project) return;
    const ph = this.playheadTick;
    const preload = this.#playPreloadTicks();
    const scheduled = await this.#buildSchedule({
      windowTicks: { from: ph, to: ph + preload },
    });
    this.#engine.setClips(scheduled);
    this.#scheduledToTick = ph + preload;
  }

  /** Keep decoding a moving window ahead of the playhead (no full-seq preload). */
  #armScheduleHydration(fromTick: number): void {
    const gen = ++this.#hydrateGen;
    this.#scheduledToTick = fromTick + this.#playPreloadTicks();
    const pump = async () => {
      while (this.playing && gen === this.#hydrateGen && this.#engine && this.project) {
        const ph = this.playheadTick;
        const preload = this.#playPreloadTicks();
        const needTo = ph + preload;
        // Also warm the transport loop start when we're near the end.
        const loop = this.#transportLoopRange();
        let from = ph;
        let to = needTo;
        if (loop && ph + preload >= loop.end) {
          from = Math.min(from, loop.start);
          to = Math.max(to, loop.start + preload);
        }
        if (to <= this.#scheduledToTick && !(loop && ph + preload >= loop.end)) {
          await new Promise<void>((r) => setTimeout(r, 120));
          continue;
        }
        const scheduled = await this.#buildSchedule({
          windowTicks: { from, to },
        });
        if (!this.playing || gen !== this.#hydrateGen || !this.#engine) return;
        this.#engine.setClips(scheduled);
        this.#scheduledToTick = to;
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    };
    void pump();
  }

  /** Hard sequence length from project.bars (not extended by clips). */
  #projectLengthTick(): number {
    const p = this.project;
    if (!p) return 16 * 4 * PPQ;
    return p.bars * p.timeSignature[0] * PPQ;
  }

  /** Lane scroll width = sequence + small pad. */
  #seqEndTick(): number {
    return this.#projectLengthTick() + LANE_PAD_TICKS;
  }

  #laneMinWidthPx(): number {
    return Math.max(800, Math.ceil(this.#seqEndTick() * this.pxPerTick));
  }

  #rulerMarks(): Array<{
    tick: number;
    label: string;
    clock: string;
    major: boolean;
  }> {
    const p = this.project;
    if (!p) return [];
    const beatsPerBar = p.timeSignature[0];
    const barTicks = beatsPerBar * PPQ;
    const end = this.#projectLengthTick();
    const barPx = barTicks * this.pxPerTick;
    const barStep = Math.max(1, Math.ceil(36 / Math.max(1, barPx)));
    const out: Array<{
      tick: number;
      label: string;
      clock: string;
      major: boolean;
    }> = [];
    for (let bar = 0; bar <= p.bars; bar += barStep) {
      const tick = bar * barTicks;
      if (tick > end) break;
      out.push({
        tick,
        label: bar === p.bars ? "" : String(bar + 1),
        clock: formatClock(ticksToMs(tick, p.bpm)),
        major: true,
      });
    }
    if (barPx >= 72) {
      for (let beat = 1; beat < p.bars * beatsPerBar; beat++) {
        if (beat % beatsPerBar === 0) continue;
        out.push({
          tick: beat * PPQ,
          label: "",
          clock: "",
          major: false,
        });
      }
    }
    return out;
  }

  #clampClipToSeq(
    startTick: number,
    lengthTick: number,
  ): { startTick: number; lengthTick: number } {
    const end = this.#projectLengthTick();
    if (end < MIN_CLIP_TICKS) {
      return { startTick: 0, lengthTick: MIN_CLIP_TICKS };
    }
    let start = Math.max(0, Math.min(startTick, end - MIN_CLIP_TICKS));
    let len = Math.max(MIN_CLIP_TICKS, lengthTick);
    if (start + len > end) len = Math.max(MIN_CLIP_TICKS, end - start);
    return { startTick: start, lengthTick: len };
  }

  async #setBars(bars: number): Promise<void> {
    if (!this.project) return;
    const nextBars = Math.max(
      MIN_BARS,
      Math.min(MAX_BARS, Math.round(bars)),
    );
    if (!Number.isFinite(nextBars) || nextBars === this.project.bars) return;

    const endTick = nextBars * this.project.timeSignature[0] * PPQ;
    const outside = this.clips.filter((c) => c.startTick >= endTick);
    if (outside.length > 0) {
      const msg =
        outside.length === 1
          ? "1 clip hors séquence sera supprimé. Continuer ?"
          : `${outside.length} clips hors séquence seront supprimés. Continuer ?`;
      const ok = await glDialog.confirm({
        message: msg,
        confirmLabel: t("dialog.confirm"),
        danger: true,
      });
      if (!ok) return;
    }

    const outsideIds = new Set(outside.map((c) => c.id));
    const touchedTracks = new Set<string>();
    for (const c of outside) {
      await db.clips.delete(c.id);
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: c.id,
        op: "delete",
        payload: c as unknown as Record<string, unknown>,
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
      touchedTracks.add(c.trackId);
    }

    let next = this.clips.filter((c) => !outsideIds.has(c.id));
    const trimmed: Clip[] = [];
    next = next.map((c) => {
      if (c.startTick + c.lengthTick <= endTick) return c;
      const lengthTick = Math.max(MIN_CLIP_TICKS, endTick - c.startTick);
      if (lengthTick === c.lengthTick) return c;
      const updated = { ...c, lengthTick };
      trimmed.push(updated);
      touchedTracks.add(c.trackId);
      return updated;
    });
    for (const c of trimmed) {
      await db.clips.put(c);
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: c.id,
        op: "trim",
        payload: {
          lengthTick: c.lengthTick,
          prev: { lengthTick: this.clips.find((x) => x.id === c.id)?.lengthTick },
        },
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
    }

    for (const trackId of touchedTracks) {
      next = await this.#persistFades(next, trackId);
    }

    if (
      this.selectedId &&
      outsideIds.has(this.selectedId)
    ) {
      this.selectedId = null;
    }

    if (this.selStartTick != null && this.selEndTick != null) {
      const a = Math.min(this.selStartTick, this.selEndTick);
      const b = Math.max(this.selStartTick, this.selEndTick);
      if (a >= endTick) {
        this.selStartTick = null;
        this.selEndTick = null;
      } else if (b > endTick) {
        this.selStartTick = a;
        this.selEndTick = endTick;
      }
    }

    const now = nowIso();
    this.project = {
      ...this.project,
      bars: nextBars,
      updatedAt: now,
      revision: this.project.revision + 1,
    };
    await db.projects.put(this.project);
    this.clips = next;
    this.#syncTransportLoop();
    if (this.playing) await this.#resyncSchedule();
  }

  #seqEndDown = (e: PointerEvent): void => {
    if (!this.project || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const originX = e.clientX;
    const originBars = this.project.bars;
    const beatsPerBar = this.project.timeSignature[0];
    const barPx = beatsPerBar * PPQ * this.pxPerTick;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!this.project) return;
      const dx = ev.clientX - originX;
      const deltaBars = Math.round(dx / Math.max(1, barPx));
      const preview = Math.max(
        MIN_BARS,
        Math.min(MAX_BARS, originBars + deltaBars),
      );
      // Live preview of end only (commit on up)
      if (preview !== this.project.bars) {
        this.project = { ...this.project, bars: preview };
      }
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!this.project) return;
      const committed = this.project.bars;
      // Restore origin then apply via #setBars (handles confirm / clip cleanup)
      this.project = { ...this.project, bars: originBars };
      await this.#setBars(committed);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  #loopSelRange(): { start: number; end: number } | null {
    if (this.selStartTick == null || this.selEndTick == null) return null;
    const start = Math.min(this.selStartTick, this.selEndTick);
    const end = Math.max(this.selStartTick, this.selEndTick);
    if (end <= start + MIN_CLIP_TICKS / 4) return null;
    return { start, end };
  }

  /** Transport loop: ruler selection if any, else full sequence (editor parity). */
  #transportLoopRange(): { start: number; end: number } | null {
    const sel = this.#loopSelRange();
    if (sel) return sel;
    if (!this.project) return null;
    const end = this.#projectLengthTick();
    if (end <= 0) return null;
    return { start: 0, end };
  }

  /** Selection / sequence → transport loop bounds (playheadSample wrap). */
  #syncTransportLoop(): void {
    if (!this.#engine || !this.playing || !this.project) return;
    const range = this.#transportLoopRange();
    if (!range) {
      this.#engine.setLoop(false, asSampleIndex(0), asSampleIndex(0));
      return;
    }
    const startS = ticksToSamples(
      asTick(range.start),
      this.project.bpm,
      this.#engine.sampleRate,
    );
    const endS = ticksToSamples(
      asTick(range.end),
      this.project.bpm,
      this.#engine.sampleRate,
    );
    this.#engine.setLoop(true, startS, endS);
  }

  #renderExportModal() {
    const sc = this.scStatus;
    const busy = this.exportBusy;
    return html`
      <sonic-modal
        align="left"
        maxWidth="36rem"
        .visible=${this.exportOpen}
        @hide=${this.onExportHide}
      >
        <sonic-modal-title>${t("export.title")}</sonic-modal-title>
        <sonic-modal-content>
          <div
            class="export-modal-body flex w-full flex-col gap-3"
            formDataProvider=${exportFormKey.path}
          >
            <sonic-input
              name="title"
              label=${t("export.trackTitle")}
              type="text"
            ></sonic-input>
            <div class="row flex flex-wrap items-center gap-2">
              <sonic-button
                type="primary"
                ?disabled=${!!busy}
                ?loading=${busy === t("export.bouncing") ||
                busy === t("export.encodingWav")}
                @click=${() => void this.#exportDownload("wav")}
              >
                ${glIcon("download", { slot: "prefix", size: "xs" })}
                ${t("export.downloadWav")}
              </sonic-button>
              <sonic-button
                variant="outline"
                type="neutral"
                ?disabled=${!!busy}
                ?loading=${busy === t("export.encodingMp3")}
                @click=${() => void this.#exportDownload("mp3")}
              >
                ${glIcon("download", { slot: "prefix", size: "xs" })}
                ${t("export.downloadMp3")}
              </sonic-button>
              <sonic-button
                variant="outline"
                type="neutral"
                ?disabled=${!!busy}
                ?loading=${busy === t("export.octatrackSlices")}
                @click=${() => void this.#exportOctatrackSlices()}
              >
                ${glIcon("download", { slot: "prefix", size: "xs" })}
                ${t("export.octatrackSlices")}
              </sonic-button>
            </div>
            <p class="m-0 text-sm text-neutral-9">${t("export.octatrackHint")}</p>
            <div class="row flex flex-wrap items-center gap-2">
              <sonic-button
                type="primary"
                ?disabled=${!!busy}
                ?loading=${busy === t("export.savingLibrary") ||
                busy === t("export.bouncing") ||
                busy === t("export.encodingWav")}
                @click=${() => void this.#exportToLibrary()}
              >
                ${glIcon("library", { slot: "prefix", size: "xs" })}
                ${t("export.toLibrary")}
              </sonic-button>
            </div>
            <p class="m-0 text-sm text-neutral-9">${t("export.toLibraryHint")}</p>
            <div class="row flex flex-wrap items-center gap-2">
              <strong>${t("export.soundcloud")}</strong>
              ${sc?.connected
                ? html`<sonic-badge type="success" size="sm"
                      >${sc.displayName ?? "OK"}</sonic-badge
                    >
                    <sonic-button
                      variant="outline"
                      type="neutral"
                      size="sm"
                      ?disabled=${!!busy}
                      @click=${() => void this.#scDisconnect()}
                    >
                      ${t("export.soundcloudDisconnect")}
                    </sonic-button>`
                : sc?.available
                  ? html`<sonic-button
                      type="primary"
                      size="sm"
                      ?disabled=${!!busy}
                      @click=${() => void this.#scConnect()}
                    >
                      ${t("export.soundcloudConnect")}
                    </sonic-button>`
                  : html`<span
                        class="font-mono text-[0.7rem] text-neutral-500"
                        >${t("export.soundcloudUnavailable")}</span
                      >
                      <sonic-button
                        variant="outline"
                        type="neutral"
                        size="sm"
                        @click=${() => exportPublish.openSoundCloudAssist()}
                      >
                        ${t("export.soundcloudAssist")}
                      </sonic-button>`}
            </div>
            ${sc?.connected
              ? html`
                  <div class="row flex flex-wrap items-center gap-2">
                    <gl-pop-select
                      label=${t("export.sharing")}
                      size="sm"
                      .value=${this.exportSharing || "private"}
                      .options=${[
                        {
                          value: "private",
                          label: t("export.private"),
                        },
                        {
                          value: "public",
                          label: t("export.public"),
                        },
                      ]}
                      @gl-change=${(e: CustomEvent<{ value: string }>) =>
                        set(exportFormKey.sharing, e.detail.value)}
                    ></gl-pop-select>
                    <sonic-button
                      type="primary"
                      ?disabled=${!!busy}
                      @click=${() => void this.#scUpload()}
                    >
                      ${t("export.soundcloudUpload")}
                    </sonic-button>
                  </div>
                `
              : nothing}
            <div class="row flex flex-wrap items-center gap-2">
              <strong>${t("export.bandcamp")}</strong>
              <sonic-button
                variant="outline"
                type="neutral"
                ?disabled=${!!busy}
                @click=${() => void this.#bandcampAssist()}
              >
                ${t("export.bandcampAssist")}
              </sonic-button>
            </div>
            <div class="flex flex-col gap-2 border-t border-neutral-3 pt-3">
              <strong>${t("export.reel")}</strong>
              <div class="row flex flex-wrap items-center gap-2">
                <sonic-button
                  type="primary"
                  ?disabled=${!!busy}
                  ?loading=${this.reelEncoding}
                  @click=${() => void this.#exportReelGenerate()}
                >
                  ${t("export.reelGenerate")}
                </sonic-button>
                <sonic-button
                  variant="outline"
                  type="neutral"
                  ?disabled=${!!busy || !this.reelResult}
                  @click=${() => void this.#exportReelDownload()}
                >
                  ${glIcon("download", { slot: "prefix", size: "xs" })}
                  ${t("export.reelDownload")}
                </sonic-button>
                ${reelExport.canShare()
                  ? html`<sonic-button
                      variant="outline"
                      type="neutral"
                      ?disabled=${!!busy || !this.reelResult}
                      @click=${() => void this.#exportReelShare()}
                    >
                      ${t("export.reelShare")}
                    </sonic-button>`
                  : nothing}
              </div>
              <p class="m-0 text-sm text-neutral-9">${t("export.reelHint")}</p>
              ${this.reelResult
                ? html`<video
                      class="mx-auto max-h-64 w-auto rounded-md bg-neutral-1"
                      style="aspect-ratio:9/16"
                      controls
                      playsinline
                      src=${this.reelResult.objectUrl}
                    ></video>`
                : nothing}
            </div>
            <div class="flex flex-col gap-2 border-t border-neutral-3 pt-3">
              <strong>${t("export.listenLink")}</strong>
              ${!auth.getJwt()
                ? html`<p class="text-sm text-neutral-9">
                      ${t("export.listenNeedLogin")}
                      <sonic-button
                        size="sm"
                        variant="outline"
                        type="neutral"
                        @click=${() => {
                          this.exportOpen = false;
                          navigate({ name: "account" });
                        }}
                      >
                        ${t("nav.account")}
                      </sonic-button>
                    </p>`
                : html`
                    <div class="row flex flex-wrap items-center gap-2">
                      <gl-pop-select
                        size="sm"
                        .value=${this.listenVisibility}
                        .options=${[
                          {
                            value: "unlisted",
                            label: t("export.listenUnlisted"),
                          },
                          {
                            value: "private",
                            label: t("export.listenPrivate"),
                          },
                        ]}
                        @gl-change=${(e: CustomEvent<{ value: string }>) => {
                          this.listenVisibility =
                            e.detail.value === "private"
                              ? "private"
                              : "unlisted";
                        }}
                      ></gl-pop-select>
                      <sonic-button
                        type="primary"
                        ?disabled=${!!busy}
                        @click=${() => void this.#publishListen()}
                      >
                        ${t("export.listenPublish")}
                      </sonic-button>
                      ${this.listenMeta
                        ? html`<sonic-button
                              variant="outline"
                              type="neutral"
                              size="sm"
                              @click=${() => void this.#copyListenLink()}
                            >
                              ${t("export.listenCopy")}
                            </sonic-button>
                            <sonic-button
                              variant="outline"
                              type="neutral"
                              size="sm"
                              @click=${() => void this.#revokeListen()}
                            >
                              ${t("export.listenRevoke")}
                            </sonic-button>`
                        : nothing}
                    </div>
                    ${this.listenMeta
                      ? html`<sonic-alert status="success" label=${t("export.listenPublished")}>
                          <a href=${this.listenMeta.url} target="_blank" rel="noopener"
                            >${this.listenMeta.url}</a
                          >
                        </sonic-alert>`
                      : nothing}
                  `}
            </div>
            ${busy
              ? html`<sonic-alert status="info" label="Export">${busy}</sonic-alert>`
              : this.exportError
                ? html`<sonic-alert status="error" label="Erreur"
                    >${this.exportError}</sonic-alert
                  >`
                : this.exportLibraryOk
                  ? html`<sonic-alert
                      status="success"
                      label=${t("export.toLibraryDone")}
                      >${this.exportLibraryOk}</sonic-alert
                    >`
                  : this.exportPermalink
                    ? html`<sonic-alert status="success" label=${t("export.uploaded")}>
                        <a
                          href=${this.exportPermalink}
                          target="_blank"
                          rel="noopener"
                          >${this.exportPermalink}</a
                        >
                      </sonic-alert>`
                    : nothing}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${glIcon("x", { slot: "prefix", size: "xs" })}
            ${t("export.close")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  onExportHide = (): void => {
    this.exportOpen = false;
    this.#revokeReel();
  };

  #revokeReel(): void {
    if (this.reelResult) {
      reelExport.revoke(this.reelResult.objectUrl);
      this.reelResult = null;
    }
  }

  #openSeqModal(kind: Exclude<SeqConfigModal, null>): void {
    if (!this.project && kind !== "docs") return;
    this.draftBpm = this.project?.bpm ?? 120;
    this.draftBars = this.project?.bars ?? 16;
    this.seqModal = kind;
  }

  onSeqModalHide = (): void => {
    if (this.seqModal === "generate") this.#persistGenUi();
    this.seqModal = null;
  };

  #renderSeqModals(bars: number, seqDurMs: number) {
    const modal = this.seqModal;
    const bpmOpen = modal === "bpm";
    const barsOpen = modal === "bars";
    const genOpen = modal === "generate";
    const docsOpen = modal === "docs";
    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${bpmOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.bpmTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-3 text-sm text-content">
            <label class="flex flex-col gap-1.5 text-xs text-neutral-500">
              ${t("seq.bpm")} (${MIN_BPM}–${MAX_BPM})
              <input
                class="box-border w-full rounded-md border border-neutral-500/25 bg-neutral-0 px-2.5 py-2 font-mono text-base text-inherit [font:inherit]"
                type="number"
                min=${MIN_BPM}
                max=${MAX_BPM}
                .value=${String(this.draftBpm)}
                @input=${(e: Event) => {
                  this.draftBpm = Number((e.target as HTMLInputElement).value);
                }}
              />
            </label>
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.cancel")}
          </sonic-button>
          <sonic-button
            type="primary"
            @click=${() => void this.#commitBpm()}
          >
            ${t("seq.apply")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>

      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${barsOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.barsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-3 text-sm text-content">
            <label class="flex flex-col gap-1.5 text-xs text-neutral-500">
              ${t("seq.barsUnit")} (${MIN_BARS}–${MAX_BARS})
              <input
                class="box-border w-full rounded-md border border-neutral-500/25 bg-neutral-0 px-2.5 py-2 font-mono text-base text-inherit [font:inherit]"
                type="number"
                min=${MIN_BARS}
                max=${MAX_BARS}
                .value=${String(this.draftBars)}
                @input=${(e: Event) => {
                  this.draftBars = Number((e.target as HTMLInputElement).value);
                }}
              />
            </label>
            <span class="font-mono text-[0.7rem] text-neutral-500"
              >${bars} ${t("seq.barsUnit")} · ${formatClock(seqDurMs)}</span
            >
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.cancel")}
          </sonic-button>
          <sonic-button
            type="primary"
            @click=${() => void this.#commitBars()}
          >
            ${t("seq.apply")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>

      <sonic-modal
        align="left"
        maxWidth="28rem"
        .visible=${genOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.generateTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-3 text-sm text-content">
            <p>${t("seq.generateBody")}</p>
            <span class="font-mono text-[0.7rem] text-neutral-500"
              >${this.project?.bpm ?? 120} ${t("seq.bpm")} · ${bars}
              ${t("seq.barsUnit")} · ${formatClock(seqDurMs)}</span
            >
            <div class="flex flex-wrap gap-2">
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                @click=${() => this.#setAllGenAuto()}
              >
                ${t("seq.genRandomizeAll")}
              </sonic-button>
            </div>
            <label class="flex flex-col gap-1 text-xs text-neutral-500">
              ${t("seq.genSeed")}
              <span class="flex gap-2">
                <input
                  class="box-border min-w-0 flex-1 rounded-md border border-neutral-500/25 bg-neutral-0 px-2.5 py-2 font-mono text-sm text-inherit [font:inherit]"
                  type="number"
                  min="0"
                  .value=${String(this.draftGenSeed)}
                  @input=${(e: Event) => {
                    this.draftGenSeed =
                      Number((e.target as HTMLInputElement).value) >>> 0;
                    this.#persistGenUi();
                  }}
                />
                <sonic-button
                  variant="outline"
                  type="neutral"
                  size="sm"
                  @click=${() => {
                    this.draftGenSeed = (Math.random() * 0xffffffff) >>> 0;
                    this.#persistGenUi();
                  }}
                >
                  ${t("seq.genSeedReroll")}
                </sonic-button>
              </span>
              <span class="text-[0.65rem] opacity-80">${t("seq.genSeedHint")}</span>
            </label>
            ${this.#renderGenChoice({
              label: t("seq.genSampleFilter"),
              value: this.draftGenSampleFilter,
              options: [
                ["all", t("seq.allFilters")],
                ["favorite", t("seq.filterFavorite")],
                ["percussive", "percussive"],
                ["tonal", "tonal"],
                ["texture", "texture"],
                ["noise", "noise"],
                ["rhythmic", "rhythmic"],
              ],
              onPick: (v) => {
                this.draftGenSampleFilter = v as SampleClass | "all" | "favorite";
              },
            })}
            <span class="font-mono text-[0.65rem] text-neutral-500"
              >${tf("seq.genSampleFilterCount", {
                n: this.#genPoolSamples().length,
              })}</span
            >
            ${this.#renderGenSlider({
              label: t("seq.genDensity"),
              value: this.draftGenDensity,
              min: 35,
              max: 150,
              fallback: 100,
              format: (n) => `×${(n / 100).toFixed(2)}`,
              onChange: (v) => {
                this.draftGenDensity = v === "auto" ? "auto" : v / 100;
              },
            })}
            ${this.#renderGenSlider({
              label: t("seq.genEnergy"),
              value: this.draftGenEnergy,
              min: 0,
              max: 100,
              fallback: 55,
              format: (n) => `${Math.round(n)}%`,
              onChange: (v) => {
                this.draftGenEnergy = v === "auto" ? "auto" : v / 100;
              },
            })}
            ${this.#renderGenSlider({
              label: t("seq.genDrumsTextures"),
              value: this.draftGenDrumsTextures,
              min: 0,
              max: 100,
              fallback: 55,
              format: () => "",
              footer: html`
                <span class="flex justify-between font-mono text-[0.65rem]">
                  <span>${t("seq.genTextures")}</span>
                  <span>${t("seq.genDrums")}</span>
                </span>
              `,
              onChange: (v) => {
                this.draftGenDrumsTextures = v === "auto" ? "auto" : v / 100;
              },
            })}
            ${this.#renderGenChoice({
              label: t("seq.genMusicStyle"),
              value: this.draftGenMusicStyle,
              options: [
                ["auto", t("seq.genAuto")],
                ...MUSIC_STYLE_IDS.map(
                  (id) =>
                    [
                      id,
                      t(`seq.genStyle.${id}` as MessageKey),
                    ] as [string, string],
                ),
              ],
              onPick: (v) => {
                this.draftGenMusicStyle = v as GenMusicStyleChoice;
              },
            })}
            ${this.#renderGenChoice({
              label: t("seq.genGroove"),
              value: this.draftGenGroove,
              options: [
                ["auto", t("seq.genAuto")],
                ["straight", t("seq.genGrooveStraight")],
                ["shuffle", t("seq.genGrooveShuffle")],
                ["half-time", t("seq.genGrooveHalftime")],
              ],
              onPick: (v) => {
                this.draftGenGroove = v as GenGrooveChoice;
              },
            })}
            <sonic-button
              size="sm"
              variant="outline"
              type="neutral"
              ?active=${this.draftGenAdvanced}
              @click=${() => {
                this.draftGenAdvanced = !this.draftGenAdvanced;
                this.#persistGenUi();
              }}
            >
              ${t("seq.genAdvanced")}
            </sonic-button>
            ${this.draftGenAdvanced
              ? html`
                  ${this.#renderGenChoice({
                    label: t("seq.genLockPitch"),
                    value: this.draftGenLockPitch === "on" ? "on" : "off",
                    options: [
                      ["off", t("seq.genOff")],
                      ["on", t("seq.genOn")],
                    ],
                    onPick: (v) => {
                      this.draftGenLockPitch = v === "on" ? "on" : "off";
                    },
                  })}
                  <span class="text-[0.65rem] text-neutral-500 opacity-80"
                    >${t("seq.genLockPitchHint")}</span
                  >
                  ${this.draftGenLockPitch === "on"
                    ? nothing
                    : html`
                        ${this.#renderGenChoice({
                          label: t("seq.genPitchDown"),
                          value:
                            this.draftGenPitchDown === "auto"
                              ? "auto"
                              : String(this.draftGenPitchDown),
                          options: [
                            ["auto", t("seq.genAuto")],
                            ...([0, 1, 2, 3, 5, 7, 12, 24] as const).map(
                              (n) => [String(n), String(n)] as [string, string],
                            ),
                          ],
                          onPick: (v) => {
                            this.draftGenPitchDown =
                              v === "auto" ? "auto" : Number(v);
                          },
                        })}
                        ${this.#renderGenChoice({
                          label: t("seq.genPitchUp"),
                          value:
                            this.draftGenPitchUp === "auto"
                              ? "auto"
                              : String(this.draftGenPitchUp),
                          options: [
                            ["auto", t("seq.genAuto")],
                            ...([0, 1, 2, 3, 5, 7, 12, 24] as const).map(
                              (n) => [String(n), String(n)] as [string, string],
                            ),
                          ],
                          onPick: (v) => {
                            this.draftGenPitchUp =
                              v === "auto" ? "auto" : Number(v);
                          },
                        })}
                        <span class="text-[0.65rem] text-neutral-500 opacity-80"
                          >${t("seq.genPitchRangeHint")}</span
                        >
                        ${this.#renderGenChoice({
                          label: t("seq.genKey"),
                          value:
                            this.draftGenKey === "auto"
                              ? "auto"
                              : String(this.draftGenKey),
                          options: [
                            ["auto", t("seq.genAuto")],
                            ...Array.from({ length: 12 }, (_, pc) => [
                              String(pc),
                              keyPcLabel(pc),
                            ] as [string, string]),
                          ],
                          onPick: (v) => {
                            this.draftGenKey =
                              v === "auto" ? "auto" : Number(v) >>> 0;
                          },
                        })}
                        ${this.#renderGenChoice({
                          label: t("seq.genScale"),
                          value: this.draftGenScale,
                          options: [
                            ["auto", t("seq.genAuto")],
                            ["major", t("seq.genScaleMajor")],
                            ["minor", t("seq.genScaleMinor")],
                          ],
                          onPick: (v) => {
                            this.draftGenScale = v as GenScaleMode;
                          },
                        })}
                        ${this.#renderGenChoice({
                          label: t("seq.genPalette"),
                          value: this.draftGenPalette,
                          options: [
                            ["auto", t("seq.genAuto")],
                            ["pop", t("seq.genPalettePop")],
                            ["modal", t("seq.genPaletteModal")],
                            ["jazz", t("seq.genPaletteJazz")],
                            ["ambient", t("seq.genPaletteAmbient")],
                            ["mixed", t("seq.genPaletteMixed")],
                          ],
                          onPick: (v) => {
                            this.draftGenPalette = v as GenPaletteChoice;
                          },
                        })}
                      `}
                  ${this.#renderGenChoice({
                    label: t("seq.genForm"),
                    value: this.draftGenForm,
                    options: [
                      ["auto", t("seq.genAuto")],
                      ["song", t("seq.genFormSong")],
                      ["ambient", t("seq.genFormAmbient")],
                    ],
                    onPick: (v) => {
                      this.draftGenForm = v as GenFormStyle;
                    },
                  })}
                  ${this.#renderGenSlider({
                    label: t("seq.genHumanize"),
                    value: this.draftGenHumanize,
                    min: 0,
                    max: 100,
                    fallback: 65,
                    format: (n) => `${Math.round(n)}%`,
                    onChange: (v) => {
                      this.draftGenHumanize = v === "auto" ? "auto" : v / 100;
                    },
                  })}
                  ${this.#renderGenSlider({
                    label: t("seq.genVariation"),
                    value: this.draftGenVariation,
                    min: 0,
                    max: 100,
                    fallback: 55,
                    format: (n) => `${Math.round(n)}%`,
                    onChange: (v) => {
                      this.draftGenVariation = v === "auto" ? "auto" : v / 100;
                    },
                  })}
                  ${this.#renderGenChoice({
                    label: t("seq.genBpmSync"),
                    value: this.draftGenBpmSync,
                    options: [
                      ["auto", t("seq.genAuto")],
                      ["on", t("seq.genOn")],
                      ["off", t("seq.genOff")],
                    ],
                    onPick: (v) => {
                      this.draftGenBpmSync = v as GenTriState;
                    },
                  })}
                  ${this.#renderGenChoice({
                    label: t("seq.genLockTempoPow2"),
                    value:
                      this.draftGenLockTempoPow2 === "on" ? "on" : "off",
                    options: [
                      ["off", t("seq.genOff")],
                      ["on", t("seq.genOn")],
                    ],
                    onPick: (v) => {
                      this.draftGenLockTempoPow2 =
                        v === "on" ? "on" : "off";
                    },
                  })}
                  <span class="text-[0.65rem] text-neutral-500 opacity-80"
                    >${t("seq.genLockTempoPow2Hint")}</span
                  >
                  ${this.#renderGenChoice({
                    label: t("seq.genForbidPitchStretch"),
                    value:
                      this.draftGenForbidPitchStretch === "on" ? "on" : "off",
                    options: [
                      ["off", t("seq.genOff")],
                      ["on", t("seq.genOn")],
                    ],
                    onPick: (v) => {
                      this.draftGenForbidPitchStretch =
                        v === "on" ? "on" : "off";
                    },
                  })}
                  <span class="text-[0.65rem] text-neutral-500 opacity-80"
                    >${t("seq.genForbidPitchStretchHint")}</span
                  >
                  ${this.#renderGenChoice({
                    label: t("seq.genReverse"),
                    value: this.draftGenReverse,
                    options: [
                      ["auto", t("seq.genAuto")],
                      ["on", t("seq.genOn")],
                      ["off", t("seq.genOff")],
                    ],
                    onPick: (v) => {
                      this.draftGenReverse = v as GenTriState;
                    },
                  })}
                  ${this.#renderGenChoice({
                    label: t("seq.genStutter"),
                    value: this.draftGenStutter,
                    options: [
                      ["auto", t("seq.genAuto")],
                      ["on", t("seq.genOn")],
                      ["off", t("seq.genOff")],
                    ],
                    onPick: (v) => {
                      this.draftGenStutter = v as GenTriState;
                    },
                  })}
                  ${this.#renderGenChoice({
                    label: t("seq.genCallResponse"),
                    value: this.draftGenCallResponse,
                    options: [
                      ["auto", t("seq.genAuto")],
                      ["on", t("seq.genOn")],
                      ["off", t("seq.genOff")],
                    ],
                    onPick: (v) => {
                      this.draftGenCallResponse = v as GenTriState;
                    },
                  })}
                `
              : nothing}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.cancel")}
          </sonic-button>
          <sonic-button
            type="primary"
            ?disabled=${this.#genPoolSamples().length === 0}
            @click=${() => void this.#commitGenerate()}
          >
            ${t("seq.generateConfirm")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>

      <sonic-modal
        align="left"
        maxWidth="28rem"
        .visible=${docsOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.docsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-3 text-sm text-content">
            <ul
              class="m-0 flex list-disc flex-col gap-1.5 pl-[1.1rem] text-[0.85rem] text-neutral-500"
            >
              <li>Outils de piste : colonne sticky à droite (mute / volume / solo / FX)</li>
              <li>Sons : tiroir vertical à droite (glisser sur une piste)</li>
              <li>Lecture en boucle</li>
              <li>Fond : ↕ zoom · ↔ pan</li>
              <li>Règle = région de boucle · BPM / durée dans le gutter droit</li>
              <li>Poignées = in-out / tête de lecture</li>
              <li>Poignée timeline = déplacer la boucle</li>
              <li>Clip = temps / piste · Alt = sans aimant</li>
              <li>Appui long clip = options (fade / stretch / offset) / dupliquer</li>
              <li>Poignées clip = trim · poubelle = supprimer · fin = durée</li>
              <li>${t("seq.rotateDocs")}</li>
            </ul>
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">
            ${t("dialog.ok")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  async #commitBpm(): Promise<void> {
    await this.#setBpm(this.draftBpm);
    this.seqModal = null;
  }

  async #commitBars(): Promise<void> {
    await this.#setBars(this.draftBars);
    this.seqModal = null;
  }

  async #commitGenerate(): Promise<void> {
    this.#persistGenUi();
    this.seqModal = null;
    await this.#generateSequence({ confirmed: true });
  }

  #setAllGenAuto(): void {
    this.draftGenDensity = "auto";
    this.draftGenEnergy = "auto";
    this.draftGenDrumsTextures = "auto";
    this.draftGenMusicStyle = "auto";
    this.draftGenGroove = "auto";
    this.draftGenKey = "auto";
    this.draftGenScale = "auto";
    this.draftGenPalette = "auto";
    this.draftGenForm = "auto";
    this.draftGenHumanize = "auto";
    this.draftGenVariation = "auto";
    this.draftGenBpmSync = "auto";
    this.draftGenLockTempoPow2 = "off";
    this.draftGenForbidPitchStretch = "off";
    this.draftGenReverse = "auto";
    this.draftGenStutter = "auto";
    this.draftGenCallResponse = "auto";
    this.draftGenLockPitch = "off";
    this.draftGenPitchUp = "auto";
    this.draftGenPitchDown = "auto";
    this.draftGenSampleFilter = "all";
    this.draftGenAdvanced = true;
    this.draftGenSeed = (Math.random() * 0xffffffff) >>> 0;
    this.#persistGenUi();
  }

  #genPoolSamples(): Sample[] {
    let list = this.samples.filter((s) => !s.deletedAt);
    const f = this.draftGenSampleFilter;
    if (f === "favorite") list = list.filter((s) => s.favorite);
    else if (f !== "all") list = list.filter((s) => s.class === f);
    return list;
  }

  #renderGenChoice(opts: {
    label: string;
    value: string;
    options: Array<[string, string]>;
    onPick: (value: string) => void;
  }) {
    return html`
      <div class="flex flex-col gap-1.5 text-xs text-neutral-500">
        ${opts.label}
        <div class="flex flex-wrap gap-[0.35rem]" role="radiogroup">
          ${opts.options.map(
            ([value, label]) => html`
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                ?active=${opts.value === value}
                @click=${() => {
                  opts.onPick(value);
                  this.#persistGenUi();
                }}
              >
                ${label}
              </sonic-button>
            `,
          )}
        </div>
      </div>
    `;
  }

  #renderGenSlider(opts: {
    label: string;
    value: number | GenAuto;
    min: number;
    max: number;
    fallback: number;
    format: (n: number) => string;
    footer?: unknown;
    onChange: (v: number | GenAuto) => void;
  }) {
    const sliderValue =
      opts.value === "auto"
        ? opts.fallback
        : Math.round(opts.value * 100);
    const display =
      opts.value === "auto" ? t("seq.genAuto") : opts.format(sliderValue);
    const isAuto = opts.value === "auto";
    return html`
      <label class="flex flex-col gap-1 text-xs text-neutral-500">
        <span class="flex items-center justify-between gap-2">
          <span>${opts.label}</span>
          <sonic-button
            size="sm"
            variant="outline"
            type="neutral"
            ?active=${isAuto}
            @click=${() => {
              opts.onChange(isAuto ? opts.fallback : "auto");
              this.#persistGenUi();
            }}
          >
            ${t("seq.genAuto")}
          </sonic-button>
        </span>
        <input
          type="range"
          class="w-full"
          min=${opts.min}
          max=${opts.max}
          ?disabled=${isAuto}
          .valueAsNumber=${sliderValue}
          @input=${(e: Event) => {
            opts.onChange((e.target as HTMLInputElement).valueAsNumber);
            this.#persistGenUi();
          }}
        />
        ${display
          ? html`<span class="font-mono text-[0.65rem]">${display}</span>`
          : nothing}
        ${opts.footer ?? nothing}
      </label>
    `;
  }

  async #setBpm(bpm: number): Promise<void> {
    if (!this.project) return;
    const next = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
    if (!Number.isFinite(next) || next === this.project.bpm) return;
    this.project = {
      ...this.project,
      bpm: next,
      updatedAt: nowIso(),
      revision: this.project.revision + 1,
    };
    await db.projects.put(this.project);
    this.#syncTransportLoop();
    this.#syncTrackBuses();
    if (this.playing) await this.#resyncSchedule();
  }

  async #toggleExportPanel(): Promise<void> {
    if (this.exportOpen) {
      this.exportOpen = false;
      return;
    }
    this.exportError = null;
    this.exportPermalink = null;
    this.exportLibraryOk = null;
    this.#bounceCache = null;
    this.#revokeReel();
    set(exportFormKey, {
      title: this.project?.title ?? "Glane",
      sharing: this.exportSharing || "private",
    });
    this.exportOpen = true;
    this.scStatus = await exportPublish.fetchSoundCloudStatus();
  }

  #setExportProgress(msg: string): void {
    this.exportBusy = msg;
    exportToast.progress(msg);
  }

  #beginExportJob(): boolean {
    if (this.exportBusy) {
      exportToast.progress(t("export.busy"));
      return false;
    }
    this.exportOpen = false;
    this.exportError = null;
    this.exportPermalink = null;
    this.exportLibraryOk = null;
    return true;
  }

  #onBounceProgress = (p: {
    stage: "mix" | "wav" | "mp3";
    ratio?: number;
  }): void => {
    if (p.stage === "mix") {
      this.#setExportProgress(t("export.bouncing"));
      return;
    }
    if (p.stage === "wav") {
      this.#setExportProgress(t("export.encodingWav"));
      return;
    }
    const pct = Math.round((p.ratio ?? 0) * 100);
    this.#setExportProgress(tf("export.encodingMp3Pct", { pct }));
  };

  async #ensureBounce(needMp3 = false): Promise<BounceResult | null> {
    if (!this.#engine || !this.project) return null;
    if (this.#bounceCache && (!needMp3 || this.#bounceCache.mp3)) {
      return this.#bounceCache;
    }
    this.#setExportProgress(t("export.bouncing"));
    this.exportError = null;
    try {
      this.#engine ??= new TransportEngine();
      if (!this.#bounceCache) {
        const scheduled = await this.#buildSchedule({
          ignoreLoop: true,
          bakeCopy: true,
        });
        if (scheduled.length === 0) {
          this.exportError = t("export.empty");
          return null;
        }
        this.#bounceCache = await exportPublish.bounceProject({
          engine: this.#engine,
          clips: scheduled,
          project: this.project,
          lengthTick: this.#projectLengthTick(),
          tracks: this.tracks.map((tr) =>
            trackToInsertConfig(tr, this.project!.bpm),
          ),
          encodeMp3: false,
          onProgress: this.#onBounceProgress,
        });
      }
      if (needMp3 && !this.#bounceCache.mp3) {
        this.#setExportProgress(t("export.encodingMp3"));
        await exportPublish.ensureMp3(this.#bounceCache, (ratio) => {
          this.#setExportProgress(
            tf("export.encodingMp3Pct", { pct: Math.round(ratio * 100) }),
          );
        });
      }
      return this.#bounceCache;
    } catch (e) {
      this.exportError =
        e instanceof Error ? e.message : t("export.error");
      return null;
    }
  }

  async #exportDownload(kind: "wav" | "mp3"): Promise<void> {
    if (!this.#beginExportJob()) return;
    try {
      const bounce = await this.#ensureBounce(kind === "mp3");
      if (!bounce) {
        exportToast.fail(this.exportError ?? t("export.error"));
        return;
      }
      const blob =
        kind === "wav"
          ? bounce.wav
          : await exportPublish.ensureMp3(bounce, (ratio) => {
              this.#setExportProgress(
                tf("export.encodingMp3Pct", { pct: Math.round(ratio * 100) }),
              );
            });
      exportPublish.downloadExport(this.exportTitle || "glane", kind, blob);
      exportToast.done(t("export.doneDownload"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #exportToLibrary(): Promise<void> {
    if (!this.project) return;
    if (!this.#beginExportJob()) return;
    try {
      const bounce = await this.#ensureBounce(false);
      if (!bounce) {
        exportToast.fail(this.exportError ?? t("export.error"));
        return;
      }
      this.#setExportProgress(t("export.savingLibrary"));
      const sample = await saveBounceToLibrary(
        this.project.id,
        bounce.buffer,
        this.exportTitle || this.project.title || "Export",
      );
      await this.#loadSamples();
      this.exportLibraryOk = sample.userName ?? sample.name;
      exportToast.done(
        `${t("export.toLibraryDone")} — ${this.exportLibraryOk}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #exportOctatrackSlices(): Promise<void> {
    if (!this.#engine || !this.project) return;
    if (!this.#beginExportJob()) return;
    this.#setExportProgress(t("export.octatrackSlices"));
    try {
      this.#engine ??= new TransportEngine();
      const scheduled = await this.#buildSchedule({
        ignoreLoop: true,
        bakeCopy: true,
      });
      if (scheduled.length === 0) {
        this.exportError = t("export.empty");
        exportToast.fail(t("export.empty"));
        return;
      }
      const { blob } = await seqOctatrackExport.buildZip({
        engine: this.#engine,
        clips: scheduled,
        tracks: this.tracks,
        trackInserts: this.tracks.map((tr) =>
          trackToInsertConfig(tr, this.project!.bpm),
        ),
        project: this.project,
        lengthTick: this.#projectLengthTick(),
        title: this.exportTitle || this.project.title || "glane",
        onProgress: ({ done, total }) => {
          this.#setExportProgress(
            tf("export.octatrackProgress", { done, total }),
          );
        },
      });
      seqOctatrackExport.download(
        this.exportTitle || this.project.title || "glane",
        blob,
      );
      exportToast.done(t("export.doneDownload"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #scConnect(): Promise<void> {
    this.exportError = null;
    if (!exportPublish.hasJwt()) {
      this.exportError = t("export.soundcloudNeedLogin");
      return;
    }
    const r = await exportPublish.connectSoundCloud();
    if (!r.ok) {
      this.exportError =
        r.error === "authentication_required"
          ? t("export.soundcloudNeedLogin")
          : r.error === "unavailable"
            ? t("export.soundcloudUnavailable")
            : r.error;
    }
  }

  async #scDisconnect(): Promise<void> {
    await exportPublish.disconnectSoundCloud();
    this.scStatus = await exportPublish.fetchSoundCloudStatus();
  }

  async #scUpload(): Promise<void> {
    if (!this.#beginExportJob()) return;
    try {
      const bounce = await this.#ensureBounce(true);
      if (!bounce?.mp3) {
        exportToast.fail(this.exportError ?? t("export.error"));
        return;
      }
      this.#setExportProgress(t("export.uploading"));
      this.exportPermalink = null;
      const r = await exportPublish.uploadToSoundCloud({
        mp3: bounce.mp3,
        title: this.exportTitle || "Glane",
        sharing: this.exportSharing,
      });
      if ("error" in r) {
        this.exportError = r.error;
        exportToast.fail(r.error);
      } else {
        this.exportPermalink = r.permalink_url ?? null;
        exportToast.done(t("export.uploaded"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #bandcampAssist(): Promise<void> {
    if (!this.#beginExportJob()) return;
    try {
      const bounce = await this.#ensureBounce(true);
      if (!bounce?.mp3) {
        exportToast.fail(this.exportError ?? t("export.error"));
        return;
      }
      exportPublish.downloadExport(
        this.exportTitle || "glane",
        "mp3",
        bounce.mp3,
      );
      exportToast.done(t("export.doneDownload"));
      await exportPublish.openBandcampAssist(this.exportTitle || "Glane");
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #exportReelGenerate(): Promise<void> {
    if (this.exportBusy) {
      exportToast.progress(t("export.busy"));
      return;
    }
    this.exportError = null;
    this.reelEncoding = true;
    try {
      const bounce = await this.#ensureBounce(false);
      if (!bounce) {
        exportToast.fail(this.exportError ?? t("export.error"));
        return;
      }
      this.#revokeReel();
      this.#setExportProgress(t("export.reelEncoding"));
      const styleId =
        this.draftGenMusicStyle === "auto"
          ? undefined
          : this.draftGenMusicStyle;
      const result = await reelExport.encode({
        buffer: bounce.buffer,
        title: this.exportTitle || this.project?.title || "Glane",
        styleId,
        onProgress: (ratio) => {
          this.#setExportProgress(
            tf("export.reelEncodingPct", { pct: Math.round(ratio * 100) }),
          );
        },
      });
      this.reelResult = result;
      exportToast.done(t("export.reelReady"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.reelEncoding = false;
      this.exportBusy = null;
    }
  }

  #exportReelDownload(): void {
    if (!this.reelResult) return;
    reelExport.download(
      this.exportTitle || this.project?.title || "glane",
      this.reelResult,
    );
    exportToast.done(t("export.doneDownload"));
  }

  async #exportReelShare(): Promise<void> {
    if (!this.reelResult) return;
    const r = await reelExport.share(
      this.exportTitle || this.project?.title || "Glane",
      this.reelResult,
    );
    if (r === "unsupported") {
      this.exportError = t("export.reelShareUnsupported");
      exportToast.fail(t("export.reelShareUnsupported"));
      return;
    }
    if (r === "failed") {
      exportToast.fail(t("export.error"));
    }
  }

  async #publishListen(): Promise<void> {
    if (!this.#beginExportJob()) return;
    this.#setExportProgress(t("export.bouncing"));
    try {
      const bounce = await this.#ensureBounce(true);
      if (!bounce?.mp3) {
        this.exportError = t("export.empty");
        exportToast.fail(t("export.empty"));
        return;
      }
      this.#setExportProgress(t("export.uploading"));
      const durationMs = Math.round(
        (bounce.buffer.length / bounce.buffer.sampleRate) * 1000,
      );
      const r = await listenShare.publishListen({
        mp3: bounce.mp3,
        title: this.exportTitle || "Glane",
        visibility: this.listenVisibility,
        localProjectId: this.project?.id,
        durationMs,
      });
      if (!r.ok) {
        this.exportError =
          r.error === "authentication_required"
            ? t("export.listenNeedLogin")
            : r.error;
        exportToast.fail(this.exportError);
        return;
      }
      this.listenMeta = {
        ...r.meta,
        url: listenShare.frontListenUrl(r.meta.token),
      };
      exportToast.done(t("export.listenPublished"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("export.error");
      this.exportError = msg;
      exportToast.fail(msg);
    } finally {
      this.exportBusy = null;
    }
  }

  async #copyListenLink(): Promise<void> {
    if (!this.listenMeta) return;
    try {
      await navigator.clipboard.writeText(this.listenMeta.url);
    } catch {
      /* ignore */
    }
  }

  async #revokeListen(): Promise<void> {
    if (!this.listenMeta) return;
    const r = await listenShare.updateListen(this.listenMeta.token, {
      revoke: true,
    });
    if (r.ok) this.listenMeta = { ...r.meta, url: this.listenMeta.url };
  }

  #onTransport = (e: CustomEvent<{ action: TransportAction }>): void => {
    void this.#handleTransport(e.detail.action);
  };

  #haltTransport(resetTick?: number): void {
    this.#hydrateGen++;
    if (this.playing && this.#engine && this.project) {
      this.playheadTick = samplesToTicks(
        this.#engine.playheadSample(),
        this.project.bpm,
        this.#engine.sampleRate,
      );
    }
    this.#engine?.stop();
    this.playing = false;
    cancelAnimationFrame(this.#raf);
    if (resetTick != null) this.playheadTick = resetTick;
  }

  #handleTransport = async (action: TransportAction): Promise<void> => {
    if (!this.#engine || !this.project) return;
    if (action === "pause") {
      this.#haltTransport();
      return;
    }
    this.loadingPlay = true;
    try {
      const range = this.#transportLoopRange();
      let fromTick = this.playheadTick;
      if (range) {
        const startS = ticksToSamples(
          asTick(range.start),
          this.project.bpm,
          this.#engine.sampleRate,
        );
        const endS = ticksToSamples(
          asTick(range.end),
          this.project.bpm,
          this.#engine.sampleRate,
        );
        this.#engine.setLoop(true, startS, endS);
        if (fromTick < range.start || fromTick >= range.end) {
          fromTick = this.#loopSelRange() ? range.start : 0;
        }
      } else {
        this.#engine.setLoop(false, asSampleIndex(0), asSampleIndex(0));
      }

      // Decode only the next ~16 beats — never the whole sequence up front.
      const preload = this.#playPreloadTicks();
      const scheduled = await this.#buildSchedule({
        windowTicks: { from: fromTick, to: fromTick + preload },
      });
      this.#engine.master.gain.value = dbToGain(this.project.masterGainDb);
      this.#engine.setClips(scheduled);

      const from = ticksToSamples(
        asTick(fromTick),
        this.project.bpm,
        this.#engine.sampleRate,
      );

      this.#engine.play(from);
      this.playing = true;
      this.#setFollowPlayhead(true);
      this.playheadTick = fromTick;
      this.#syncFollowScroll();
      this.#armScheduleHydration(fromTick);
      const tick = () => {
        if (!this.#engine || !this.playing || !this.project) return;
        if (!this.#scrubbing) {
          const ph = this.#engine.playheadSample();
          this.playheadTick = samplesToTicks(
            ph,
            this.project.bpm,
            this.#engine.sampleRate,
          );
        }
        this.#syncFollowScroll();
        this.#raf = requestAnimationFrame(tick);
      };
      this.#raf = requestAnimationFrame(tick);
    } finally {
      this.loadingPlay = false;
    }
  };

  /** Hit-test the sticky cancel/delete strip (not raw viewport Y — toolbar sits above). */
  #inCancelZone(clientX: number, clientY: number): boolean {
    const el = this.shadowRoot?.querySelector(".cancel-zone");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const pad = 10;
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  async #deleteClip(clip: Clip): Promise<void> {
    await db.clips.delete(clip.id);
    await db.ops.add({
      id: createEntityId(),
      entityType: "clip",
      entityId: clip.id,
      op: "delete",
      payload: clip as unknown as Record<string, unknown>,
      clientSeq: Date.now(),
      clientId: "local",
      createdAt: nowIso(),
    });
    let next = this.clips.filter((c) => c.id !== clip.id);
    next = await this.#persistFades(next, clip.trackId);
    this.clips = next;
    if (this.selectedId === clip.id) this.selectedId = null;
    if (navigator.vibrate) navigator.vibrate(12);
    if (this.playing) await this.#resyncSchedule();
  }

  #undo = async (): Promise<void> => {
    const last = await db.ops.orderBy("clientSeq").reverse().first();
    if (!last) return;
    if (last.op === "create" && last.entityType === "clip") {
      await db.clips.delete(last.entityId);
      this.clips = this.clips.filter((c) => c.id !== last.entityId);
    } else if (last.op === "delete" && last.entityType === "clip") {
      const restored = last.payload as unknown as Clip;
      if (restored?.id) {
        await db.clips.put(restored);
        let next = [...this.clips, restored];
        next = await this.#persistFades(next, restored.trackId);
        this.clips = next;
        this.selectedId = restored.id;
      }
    } else if (last.op === "move" && last.entityType === "clip") {
      const payload = last.payload as {
        startTick?: number;
        prevStartTick?: number;
        prevTrackId?: string;
      };
      if (payload.prevStartTick != null || payload.prevTrackId != null) {
        const clip = this.clips.find((c) => c.id === last.entityId);
        if (clip) {
          const fromTrack = clip.trackId;
          const restored = {
            ...clip,
            ...(payload.prevStartTick != null
              ? { startTick: payload.prevStartTick }
              : {}),
            ...(payload.prevTrackId != null
              ? { trackId: payload.prevTrackId }
              : {}),
          };
          await db.clips.put(restored);
          let next = this.clips.map((c) =>
            c.id === last.entityId ? restored : c,
          );
          next = await this.#persistFades(next, fromTrack);
          if (restored.trackId !== fromTrack) {
            next = await this.#persistFades(next, restored.trackId);
          }
          this.clips = next;
        }
      }
    } else if (last.op === "trim" && last.entityType === "clip") {
      const payload = last.payload as Partial<Clip> & {
        prev?: Partial<Clip>;
      };
      if (payload.prev) {
        const clip = this.clips.find((c) => c.id === last.entityId);
        if (clip) {
          const restored = { ...clip, ...payload.prev };
          await db.clips.put(restored);
          this.clips = this.clips.map((c) =>
            c.id === last.entityId ? restored : c,
          );
          if (restored.sampleId) this.#invalidateSampleBuffers(restored.sampleId);
        }
      }
    } else if (last.op === "offset" && last.entityType === "clip") {
      const payload = last.payload as {
        contentOffsetMs?: number;
        prev?: { contentOffsetMs?: number };
      };
      if (payload.prev?.contentOffsetMs != null) {
        const clip = this.clips.find((c) => c.id === last.entityId);
        if (clip) {
          const restored = {
            ...clip,
            contentOffsetMs: payload.prev.contentOffsetMs,
          };
          await db.clips.put(restored);
          this.clips = this.clips.map((c) =>
            c.id === last.entityId ? restored : c,
          );
          if (restored.sampleId) this.#invalidateSampleBuffers(restored.sampleId);
        }
      }
    }
    await db.ops.delete(last.id);
    if (this.playing) await this.#resyncSchedule();
  };

  #openClipEditor(clip: Clip): void {
    if (!clip.sampleId) return;
    this.#lastTapClipId = null;
    navigate({ name: "sample", id: clip.sampleId });
  }

  #clipDown = (e: PointerEvent, clip: Clip): void => {
    if ((e.target as HTMLElement).classList.contains("handle")) return;
    e.stopPropagation();
    this.#dismissClipMenus();
    this.selectedId = clip.id;
    // Native mouse double-click (detail ≥ 2) — don't start a drag.
    if (e.detail >= 2 && clip.sampleId) {
      this.#openClipEditor(clip);
      return;
    }
    if (this.rotateClipTool) {
      this.#clipRotateDown(e, clip);
      return;
    }
    this.#fsm.reset();
    this.#fsm.push({
      type: "down",
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      target: "clip",
    });
    this.dragClipId = clip.id;
    this.#dragStartX = e.clientX;
    this.#dragStartTick = clip.startTick;
    this.#dragStartTrackId = clip.trackId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const t0 = e.timeStamp;
    let lastX = e.clientX;
    let lastY = e.clientY;
    let menuOpened = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const holdTimer = window.setTimeout(() => {
      const resolved = this.#fsm.push({
        type: "hold",
        pointerId: e.pointerId,
        x: lastX,
        y: lastY,
        t: t0 + LONGPRESS_MS,
        target: "clip",
      });
      if (resolved.status === "resolved" && resolved.kind === "longpress") {
        menuOpened = true;
        this.#lastTapClipId = null;
        this.dragClipId = null;
        this.dropCancelOpen = false;
        this.cancelHot = false;
        this.clipCtx = { clipId: clip.id, x: lastX, y: lastY };
        if (navigator.vibrate) navigator.vibrate(8);
      }
    }, LONGPRESS_MS);
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (menuOpened) return;
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      // Ignore sub-threshold jitter — otherwise snap can shift the clip on a
      // zero-delta pointermove and kill double-tap detection (`moved`).
      if (dist < MOVE_THRESHOLD_PX) return;
      window.clearTimeout(holdTimer);
      if (!this.dropCancelOpen) this.dropCancelOpen = true;
      const overCancel = this.#inCancelZone(ev.clientX, ev.clientY);
      this.cancelHot = overCancel;
      if (overCancel) {
        this.dropTrackId = null;
        this.snapHighlightId = null;
        // Park at origin while over delete zone so the lane doesn't keep shifting.
        this.clips = this.clips.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                startTick: this.#dragStartTick,
                trackId: this.#dragStartTrackId,
              }
            : c,
        );
        return;
      }
      const dx = ev.clientX - this.#dragStartX;
      let next = Math.max(
        0,
        this.#dragStartTick + Math.round(dx / this.pxPerTick),
      );
      const targetTrackId =
        this.#trackIdAtY(ev.clientY) ?? this.#dragStartTrackId;
      this.dropTrackId = targetTrackId;
      this.magnetOff = ev.altKey;

      if (!this.magnetOff) {
        const radius = pxRadiusToTicks(12, this.pxPerTick);
        const sameTrack = this.clips.filter(
          (c) => c.trackId === targetTrackId && c.id !== clip.id,
        );
        const targets = [
          ...clipEdgeTargets(sameTrack, clip.id),
          ...gridTargets(next - 2000, next + 2000, 240),
        ];
        const snapped = snapTick(next, targets, radius);
        if (snapped.snapped && snapped.tick !== next) {
          next = snapped.tick;
          if (this.snapHighlightId !== clip.id) {
            this.snapHighlightId = clip.id;
            if (navigator.vibrate) navigator.vibrate(8);
          }
        } else if (!snapped.snapped) {
          this.snapHighlightId = null;
        } else {
          next = snapped.tick;
          this.snapHighlightId = clip.id;
        }
      }

      let blocked = false;
      for (const other of this.clips) {
        if (other.id === clip.id || other.trackId !== targetTrackId) continue;
        const r = clampOverlapStart(
          { startTick: next, lengthTick: clip.lengthTick },
          other,
        );
        if (r.blocked) {
          next = Math.max(0, r.startTick);
          blocked = true;
        }
      }
      if (blocked && navigator.vibrate) navigator.vibrate(8);

      const clamped = this.#clampClipToSeq(next, clip.lengthTick);
      next = clamped.startTick;

      this.clips = this.clips.map((c) =>
        c.id === clip.id
          ? {
              ...c,
              startTick: next,
              lengthTick: clamped.lengthTick,
              trackId: targetTrackId,
            }
          : c,
      );
    };
    const up = async (ev: PointerEvent) => {
      window.clearTimeout(holdTimer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.snapHighlightId = null;
      this.magnetOff = false;
      this.cancelHot = false;
      this.dropCancelOpen = false;
      this.dropTrackId = null;
      if (menuOpened) {
        this.dragClipId = null;
        this.#fsm.push({
          type: "up",
          pointerId: ev.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          t: ev.timeStamp,
          target: "clip",
        });
        return;
      }
      if (this.#inCancelZone(ev.clientX, ev.clientY)) {
        this.dragClipId = null;
        await this.#deleteClip({
          ...clip,
          startTick: this.#dragStartTick,
          trackId: this.#dragStartTrackId,
        });
        return;
      }
      const updated = this.clips.find((c) => c.id === clip.id);
      const moved =
        updated &&
        (updated.startTick !== this.#dragStartTick ||
          updated.trackId !== this.#dragStartTrackId ||
          updated.lengthTick !== clip.lengthTick);
      if (updated && moved) {
        await db.clips.put(updated);
        await db.ops.add({
          id: createEntityId(),
          entityType: "clip",
          entityId: clip.id,
          op: "move",
          payload: {
            startTick: updated.startTick,
            prevStartTick: this.#dragStartTick,
            trackId: updated.trackId,
            prevTrackId: this.#dragStartTrackId,
          },
          clientSeq: Date.now(),
          clientId: "local",
          createdAt: nowIso(),
        });
        let next = await this.#persistFades(
          this.clips,
          this.#dragStartTrackId,
        );
        if (updated.trackId !== this.#dragStartTrackId) {
          next = await this.#persistFades(next, updated.trackId);
        }
        this.clips = next;
        if (this.playing) await this.#resyncSchedule();
      }
      if (this.#fsm.state.status === "pending") {
        const resolved = this.#fsm.push({
          type: "up",
          pointerId: ev.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          t: ev.timeStamp,
          target: "clip",
        });
        if (resolved.status === "resolved" && resolved.kind === "longpress") {
          this.#lastTapClipId = null;
          this.clipCtx = {
            clipId: clip.id,
            x: ev.clientX,
            y: ev.clientY,
          };
          if (navigator.vibrate) navigator.vibrate(8);
        } else if (
          resolved.status === "resolved" &&
          resolved.kind === "tap" &&
          !moved &&
          clip.sampleId
        ) {
          const now = performance.now();
          if (
            this.#lastTapClipId === clip.id &&
            now - this.#lastTapAt < DOUBLE_TAP_MS
          ) {
            this.#openClipEditor(clip);
          } else {
            this.#lastTapClipId = clip.id;
            this.#lastTapAt = now;
          }
        } else {
          this.#lastTapClipId = null;
        }
      }
      this.dragClipId = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  #trimDown = (e: PointerEvent, clip: Clip, edge: TrimEdge): void => {
    e.stopPropagation();
    e.preventDefault();
    // After select, handles cover short clips — 2nd click of a double-click
    // often lands on a handle instead of the clip body.
    if (clip.sampleId) {
      const now = performance.now();
      if (
        e.detail >= 2 ||
        (this.#lastTapClipId === clip.id && now - this.#lastTapAt < DOUBLE_TAP_MS)
      ) {
        this.#openClipEditor(clip);
        return;
      }
    }
    this.selectedId = clip.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const originX = e.clientX;
    const originStart = clip.startTick;
    const originLen = clip.lengthTick;
    const originOffset = clip.contentOffsetMs;
    const bpm = this.project?.bpm ?? 120;

    const move = (ev: PointerEvent) => {
      const dxTicks = Math.round((ev.clientX - originX) / this.pxPerTick);
      let startTick = originStart;
      let lengthTick = originLen;
      let contentOffsetMs = originOffset;

      if (edge === "end") {
        lengthTick = Math.max(MIN_CLIP_TICKS, originLen + dxTicks);
      } else {
        const maxDx = originLen - MIN_CLIP_TICKS;
        const clampedDx = Math.min(maxDx, Math.max(-originStart, dxTicks));
        startTick = originStart + clampedDx;
        lengthTick = originLen - clampedDx;
        const msPerTick = (60 / bpm / PPQ) * 1000;
        contentOffsetMs = Math.max(0, originOffset + clampedDx * msPerTick);
      }

      let draft = { startTick, lengthTick };
      for (const other of this.clips) {
        if (other.id === clip.id || other.trackId !== clip.trackId) continue;
        const r = clampOverlapTrim(draft, other, edge, MIN_CLIP_TICKS);
        if (r.blocked) {
          draft = { startTick: r.startTick, lengthTick: r.lengthTick };
          if (navigator.vibrate) navigator.vibrate(8);
        }
      }
      draft = this.#clampClipToSeq(draft.startTick, draft.lengthTick);

      if (edge === "start") {
        const appliedDx = draft.startTick - originStart;
        const msPerTick = (60 / bpm / PPQ) * 1000;
        contentOffsetMs = Math.max(0, originOffset + appliedDx * msPerTick);
      }

      this.clips = this.clips.map((c) =>
        c.id === clip.id
          ? {
              ...c,
              startTick: draft.startTick,
              lengthTick: draft.lengthTick,
              contentOffsetMs,
            }
          : c,
      );
    };

    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const updated = this.clips.find((c) => c.id === clip.id);
      if (
        !updated ||
        (updated.startTick === originStart &&
          updated.lengthTick === originLen)
      ) {
        return;
      }
      await db.clips.put(updated);
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: clip.id,
        op: "trim",
        payload: {
          startTick: updated.startTick,
          lengthTick: updated.lengthTick,
          contentOffsetMs: updated.contentOffsetMs,
          prev: {
            startTick: originStart,
            lengthTick: originLen,
            contentOffsetMs: originOffset,
          },
        },
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
      this.clips = await this.#persistFades(this.clips, clip.trackId);
      if (this.playing) await this.#resyncSchedule();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  #laneDown = (e: PointerEvent, _trackId: string): void => {
    if ((e.target as HTMLElement).closest(".clip")) return;
    this.selectedId = null;
    const lane = e.currentTarget as HTMLElement;

    // Lane: pan / zoom / tap-clear only — loop region is ruler + handles.
    this.#fsm.reset();
    this.#fsm.push({
      type: "down",
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      target: "background",
    });
    let lastX = e.clientX;
    let lastY = e.clientY;
    let kind: GestureKind | null = null;
    lane.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (kind == null) {
        const st = this.#fsm.push({
          type: "move",
          pointerId: ev.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          t: ev.timeStamp,
          target: "background",
        });
        if (st.status === "resolved") {
          if (st.kind === "scroll" || st.kind === "zoom") kind = st.kind;
          else return;
        } else {
          return;
        }
      }
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (kind === "scroll") {
        this.#viewBusy = true;
        const timeline = this.#timelineEl();
        if (timeline) timeline.scrollLeft -= dx;
      } else if (kind === "zoom") {
        this.#viewBusy = true;
        this.#zoomAtClientX(dy, ev.clientX);
      }
    };

    const up = (ev: PointerEvent) => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      lane.removeEventListener("pointercancel", up);
      this.#viewBusy = false;
      if (kind === "scroll") this.#setFollowPlayhead(false);
      const st = this.#fsm.push({
        type: "up",
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        t: ev.timeStamp,
        target: "background",
      });
      if (
        kind == null &&
        st.status === "resolved" &&
        (st.kind === "tap" || st.kind === "longpress")
      ) {
        this.selStartTick = null;
        this.selEndTick = null;
        this.#syncTransportLoop();
        if (this.playing) void this.#resyncSchedule();
      }
      this.#fsm.reset();
    };

    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
    lane.addEventListener("pointercancel", up);
  };

  #tickAtClamped = (clientX: number): number =>
    Math.max(
      0,
      Math.min(this.#projectLengthTick(), this.#tickAtClientX(clientX)),
    );

  /** Click-drag on the time ruler creates / redraws the loop region. */
  #rulerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".loop-move, .seq-end")) return;
    const lane = e.currentTarget as HTMLElement;
    const origin = this.#tickAtClamped(e.clientX);
    this.selStartTick = origin;
    this.selEndTick = origin;
    this.#selDragging = true;
    lane.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!this.#selDragging) return;
      this.selEndTick = this.#tickAtClamped(ev.clientX);
      this.#syncTransportLoop();
    };
    const up = (ev: PointerEvent) => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      lane.removeEventListener("pointercancel", up);
      this.#selDragging = false;
      const end = this.#tickAtClamped(ev.clientX);
      this.selEndTick = end;
      const a = Math.min(origin, end);
      const b = Math.max(origin, end);
      if (b <= a + MIN_CLIP_TICKS / 4) {
        this.selStartTick = null;
        this.selEndTick = null;
      } else {
        this.selStartTick = a;
        this.selEndTick = b;
      }
      this.#syncTransportLoop();
      if (this.playing) void this.#resyncSchedule();
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
    lane.addEventListener("pointercancel", up);
  };

  #loopEdgeDown = (e: PointerEvent, edge: "start" | "end"): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.selStartTick == null || this.selEndTick == null) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const a0 = Math.min(this.selStartTick, this.selEndTick);
    const b0 = Math.max(this.selStartTick, this.selEndTick);
    const move = (ev: PointerEvent) => {
      const t = this.#tickAtClamped(ev.clientX);
      if (edge === "start") {
        this.selStartTick = Math.min(t, b0 - MIN_CLIP_TICKS / 4);
        this.selEndTick = b0;
      } else {
        this.selStartTick = a0;
        this.selEndTick = Math.max(t, a0 + MIN_CLIP_TICKS / 4);
      }
      this.#syncTransportLoop();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.selStartTick != null && this.selEndTick != null) {
        const a = Math.min(this.selStartTick, this.selEndTick);
        const b = Math.max(this.selStartTick, this.selEndTick);
        this.selStartTick = a;
        this.selEndTick = b;
      }
      this.#syncTransportLoop();
      if (this.playing) void this.#resyncSchedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  #loopMoveDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.selStartTick == null || this.selEndTick == null) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const a0 = Math.min(this.selStartTick, this.selEndTick);
    const b0 = Math.max(this.selStartTick, this.selEndTick);
    const width = Math.max(1, b0 - a0);
    const originTick = this.#tickAtClamped(e.clientX);
    const move = (ev: PointerEvent) => {
      const delta = this.#tickAtClamped(ev.clientX) - originTick;
      let nextA = a0 + delta;
      let nextB = nextA + width;
      const maxT = this.#projectLengthTick();
      if (nextA < 0) {
        nextA = 0;
        nextB = width;
      }
      if (nextB > maxT) {
        nextB = maxT;
        nextA = Math.max(0, nextB - width);
      }
      this.selStartTick = nextA;
      this.selEndTick = nextB;
      this.#syncTransportLoop();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.#syncTransportLoop();
      if (this.playing) void this.#resyncSchedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  #seekPlayheadTick(tick: number): void {
    const maxT = this.#projectLengthTick();
    const next = Math.max(0, Math.min(maxT, Math.round(tick)));
    this.playheadTick = next;
    this.#setFollowPlayhead(true);
    if (this.playing && this.#engine && this.project) {
      const sample = ticksToSamples(
        asTick(next),
        this.project.bpm,
        this.#engine.sampleRate,
      );
      this.#engine.seek(sample);
      void this.#resyncSchedule().then(() => {
        if (this.playing) this.#armScheduleHydration(next);
      });
    }
    this.#syncFollowScroll(true);
  }

  #playheadDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    this.#scrubbing = true;
    this.#setFollowPlayhead(true);
    // Delta scrub keeps the playhead centered like play-mode follow.
    let lastX = e.clientX;
    this.#syncFollowScroll(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      this.#seekPlayheadTick(this.playheadTick + dx / this.pxPerTick);
    };
    const up = () => {
      this.#scrubbing = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.#setFollowPlayhead(true);
      this.#syncFollowScroll(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  #onSeekBarStart = (): void => {
    this.#scrubbing = true;
    this.#setFollowPlayhead(true);
  };

  #onSeekBar = (e: CustomEvent<{ value: number }>): void => {
    this.#seekPlayheadTick(e.detail.value);
  };

  #onSeekBarEnd = (): void => {
    this.#scrubbing = false;
    this.#setFollowPlayhead(true);
    this.#syncFollowScroll(true);
  };

  #renderClipCtxMenu() {
    const ctx = this.clipCtx;
    if (!ctx) return nothing;
    return html`
      <div
        class="clip-ctx-backdrop"
        @pointerdown=${(e: PointerEvent) => {
          e.preventDefault();
          this.clipCtx = null;
        }}
      ></div>
      <div
        class="clip-ctx fixed z-[41] min-w-[11rem] -translate-x-3 -translate-y-full rounded-md bg-neutral-100 p-1 text-content shadow-[0_8px_24px_rgba(0,0,0,0.35)] max-md:max-w-[min(18rem,calc(100vw-1.5rem))]"
        style="left:${ctx.x}px;top:${ctx.y}px;margin-top:-0.35rem"
        @pointerdown=${(e: Event) => e.stopPropagation()}
      >
        <sonic-menu direction="column" align="left" size="sm">
          <sonic-menu-item @click=${() => void this.#openClipOptions()}>
            ${glIcon("sliders", { slot: "prefix", size: "xs" })}
            ${t("seq.clipOptions")}
          </sonic-menu-item>
          <sonic-menu-item @click=${() => void this.#duplicateFromCtx()}>
            ${glIcon("copy", { slot: "prefix", size: "xs" })}
            ${t("seq.duplicate")}
          </sonic-menu-item>
        </sonic-menu>
      </div>
    `;
  }

  #renderClipOptsModal() {
    const clipId = this.clipOptsId;
    const clip = clipId
      ? this.clips.find((c) => c.id === clipId)
      : undefined;
    const open = !!clip;
    const fadeMax = clip ? this.#fadeMaxMs(clip) : 0;
    const label = STRETCH_LABEL[clip?.stretchMode ?? "off"];
    const sample = clip?.sampleId
      ? this.samples.find((s) => s.id === clip.sampleId)
      : undefined;
    const offsetMax = Math.max(1, sample?.durationMs ?? 1);
    const offsetMs = clip
      ? Math.round(
          ((clip.contentOffsetMs % offsetMax) + offsetMax) % offsetMax,
        )
      : 0;
    return html`
      <sonic-modal
        align="left"
        maxWidth="22rem"
        .visible=${open}
        @hide=${this.onClipOptsHide}
      >
        <sonic-modal-title>${t("seq.clipOptionsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-3 text-sm text-content">
            ${clip
              ? html`
                  <label
                    class="flex flex-col gap-1.5 text-xs text-neutral-500"
                  >
                    ${t("seq.fadeIn")} · ${clip.fadeInMs} ms
                    <input
                      class="w-full accent-primary"
                      type="range"
                      min="0"
                      max=${fadeMax}
                      .value=${String(clip.fadeInMs)}
                      @input=${(e: Event) =>
                        void this.#setClipFades(
                          clip.id,
                          Number((e.target as HTMLInputElement).value),
                          clip.fadeOutMs,
                        )}
                    />
                  </label>
                  <label
                    class="flex flex-col gap-1.5 text-xs text-neutral-500"
                  >
                    ${t("seq.fadeOut")} · ${clip.fadeOutMs} ms
                    <input
                      class="w-full accent-primary"
                      type="range"
                      min="0"
                      max=${fadeMax}
                      .value=${String(clip.fadeOutMs)}
                      @input=${(e: Event) =>
                        void this.#setClipFades(
                          clip.id,
                          clip.fadeInMs,
                          Number((e.target as HTMLInputElement).value),
                        )}
                    />
                  </label>
                  <label
                    class="flex flex-col gap-1.5 text-xs text-neutral-500"
                  >
                    ${t("seq.contentOffset")} · ${offsetMs} ms
                    <input
                      class="w-full accent-primary"
                      type="range"
                      min="0"
                      max=${offsetMax - 1}
                      .value=${String(offsetMs)}
                      @input=${(e: Event) =>
                        void this.#setClipContentOffset(
                          clip.id,
                          Number((e.target as HTMLInputElement).value),
                        )}
                    />
                  </label>
                  <sonic-button
                    variant="outline"
                    type="neutral"
                    size="sm"
                    @click=${() => void this.#cycleStretch(clip.id)}
                  >
                    ${glIcon("move-horizontal", { slot: "prefix", size: "xs" })}
                    ${t("seq.stretch")} ${label}
                  </sonic-button>
                `
              : nothing}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal type="primary">
            ${t("dialog.ok")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }

  onClipOptsHide = (): void => {
    this.clipOptsId = null;
  };

  #dismissClipMenus(): void {
    this.clipCtx = null;
    this.clipOptsId = null;
  }

  #openClipOptions(): void {
    const ctx = this.clipCtx;
    if (!ctx) return;
    this.clipCtx = null;
    this.selectedId = ctx.clipId;
    this.clipOptsId = ctx.clipId;
  }

  async #duplicateFromCtx(): Promise<void> {
    const ctx = this.clipCtx;
    if (!ctx) return;
    const clip = this.clips.find((c) => c.id === ctx.clipId);
    this.clipCtx = null;
    if (clip) await this.#duplicate(clip);
  }

  async #duplicate(clip: Clip): Promise<void> {
    const placed = this.#clampClipToSeq(
      clip.startTick + clip.lengthTick,
      clip.lengthTick,
    );
    if (placed.startTick >= this.#projectLengthTick()) return;
    const copy: Clip = {
      ...clip,
      id: createEntityId(),
      startTick: placed.startTick,
      lengthTick: placed.lengthTick,
    };
    await db.clips.put(copy);
    await db.ops.add({
      id: createEntityId(),
      entityType: "clip",
      entityId: copy.id,
      op: "create",
      payload: copy as unknown as Record<string, unknown>,
      clientSeq: Date.now(),
      clientId: "local",
      createdAt: nowIso(),
    });
    let next = [...this.clips, copy];
    next = await this.#persistFades(next, clip.trackId);
    this.clips = next;
    this.selectedId = copy.id;
    if (navigator.vibrate) navigator.vibrate(8);
    if (this.playing) await this.#resyncSchedule();
  }

  #selectedClip(): Clip | undefined {
    return this.clips.find((x) => x.id === this.selectedId);
  }

  #fadeMaxMs(clip: Clip): number {
    if (!this.project) return 2000;
    return Math.max(
      0,
      Math.min(2000, Math.floor(ticksToMs(clip.lengthTick, this.project.bpm))),
    );
  }

  async #setClipFades(
    clipId: string,
    fadeInMs: number,
    fadeOutMs: number,
  ): Promise<void> {
    const clip = this.clips.find((c) => c.id === clipId);
    if (!clip || !this.project) return;
    const max = this.#fadeMaxMs(clip);
    const fi = Math.max(0, Math.min(max, Math.round(fadeInMs)));
    const fo = Math.max(0, Math.min(max, Math.round(fadeOutMs)));
    if (fi === clip.fadeInMs && fo === clip.fadeOutMs) return;
    const updated = { ...clip, fadeInMs: fi, fadeOutMs: fo };
    await db.clips.put(updated);
    this.clips = this.clips.map((c) => (c.id === clip.id ? updated : c));
    if (this.playing) await this.#resyncSchedule();
  }

  #wrapContentOffsetMs(ms: number, durationMs: number): number {
    const dur = Math.max(1, Math.round(durationMs));
    let x = Math.round(ms) % dur;
    if (x < 0) x += dur;
    return x;
  }

  #clipSampleDurationMs(clip: Clip): number {
    if (!clip.sampleId) return 1;
    const sample = this.samples.find((s) => s.id === clip.sampleId);
    if (sample && sample.durationMs > 0) return sample.durationMs;
    const entry = this.#pcmCache.get(clip.sampleId);
    if (entry?.pcm.length && entry.sampleRate > 0) {
      return Math.max(1, Math.round((entry.pcm.length / entry.sampleRate) * 1000));
    }
    return 1;
  }

  #invalidateSampleBuffers(sampleId: string): void {
    for (const key of [...this.#bufferCache.keys()]) {
      if (key === sampleId || key.startsWith(`${sampleId}:`)) {
        this.#bufferCache.delete(key);
      }
    }
  }

  async #setClipContentOffset(
    clipId: string,
    contentOffsetMs: number,
  ): Promise<void> {
    const clip = this.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const next = this.#wrapContentOffsetMs(
      contentOffsetMs,
      this.#clipSampleDurationMs(clip),
    );
    if (next === clip.contentOffsetMs) return;
    const updated = { ...clip, contentOffsetMs: next };
    await db.clips.put(updated);
    this.clips = this.clips.map((c) => (c.id === clip.id ? updated : c));
    if (clip.sampleId) this.#invalidateSampleBuffers(clip.sampleId);
    if (this.playing) await this.#resyncSchedule();
  }

  /** Rotate tool: drag shifts contentOffsetMs (wrap) without moving the clip. */
  #clipRotateDown = (e: PointerEvent, clip: Clip): void => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const originX = e.clientX;
    const originOffset = clip.contentOffsetMs;
    const bpm = this.project?.bpm ?? 120;
    const durMs = this.#clipSampleDurationMs(clip);
    const clipW = Math.max(8, clip.lengthTick * this.pxPerTick);
    const clipMs = ticksToMs(clip.lengthTick, bpm);

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - originX;
      // Drag left → waveform moves left → positive contentOffset (editor parity).
      const deltaMs = clipW > 0 ? (-dx / clipW) * clipMs : 0;
      const contentOffsetMs = this.#wrapContentOffsetMs(
        originOffset + deltaMs,
        durMs,
      );
      this.clips = this.clips.map((c) =>
        c.id === clip.id ? { ...c, contentOffsetMs } : c,
      );
    };

    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const updated = this.clips.find((c) => c.id === clip.id);
      if (!updated || updated.contentOffsetMs === originOffset) return;
      await db.clips.put(updated);
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: clip.id,
        op: "offset",
        payload: {
          contentOffsetMs: updated.contentOffsetMs,
          prev: { contentOffsetMs: originOffset },
        },
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
      if (clip.sampleId) this.#invalidateSampleBuffers(clip.sampleId);
      if (this.playing) await this.#resyncSchedule();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  async #cycleStretch(clipId?: string): Promise<void> {
    const id = clipId ?? this.selectedId;
    const clip = id
      ? this.clips.find((c) => c.id === id)
      : this.#selectedClip();
    if (!clip) return;
    const i = STRETCH_ORDER.indexOf(clip.stretchMode);
    const stretchMode = STRETCH_ORDER[(i + 1) % STRETCH_ORDER.length]!;
    const updated = { ...clip, stretchMode };
    await db.clips.put(updated);
    this.clips = this.clips.map((c) => (c.id === clip.id ? updated : c));
    this.#bufferCache.clear();
    if (this.playing) await this.#resyncSchedule();
  }

  /** Library → full sequence over project.bars; replaces existing clips. */
  async #generateSequence(opts?: { confirmed?: boolean }): Promise<void> {
    if (!this.project || this.tracks.length === 0 || this.samples.length === 0) {
      return;
    }
    if (!opts?.confirmed && this.clips.length > 0) {
      const n = this.clips.length;
      const msg =
        n === 1
          ? "Remplacer le clip actuel par une nouvelle séquence ?"
          : `Remplacer les ${n} clips par une nouvelle séquence ?`;
      const ok = await glDialog.confirm(msg);
      if (!ok) return;
    }

    const pool = this.#genPoolSamples();
    if (pool.length === 0) {
      await glDialog.alert(t("seq.genSampleFilterEmpty"));
      return;
    }

    const analysisRows = await db.analyses.bulkGet(pool.map((s) => s.id));
    const analysisById = new Map(
      analysisRows
        .filter((a): a is NonNullable<typeof a> => a != null)
        .map((a) => [a.sampleId, a]),
    );

    const planned = planSequence({
      bars: this.project.bars,
      beatsPerBar: this.project.timeSignature[0],
      ppq: PPQ,
      bpm: this.project.bpm,
      seed: this.draftGenSeed >>> 0,
      density: this.draftGenDensity,
      energy: this.draftGenEnergy,
      drumsVsTexture: this.draftGenDrumsTextures,
      musicStyle: this.draftGenMusicStyle,
      groove: this.draftGenGroove,
      keyRootPc: this.draftGenKey,
      scaleMode: this.draftGenScale,
      palette: this.draftGenPalette,
      formStyle: this.draftGenForm,
      humanize: this.draftGenHumanize,
      variation: this.draftGenVariation,
      bpmSync: this.draftGenBpmSync,
      reverse: this.draftGenReverse,
      stutter: this.draftGenStutter,
      callResponse: this.draftGenCallResponse,
      lockPitch: this.draftGenLockPitch,
      pitchUpSemitones: this.draftGenPitchUp,
      pitchDownSemitones: this.draftGenPitchDown,
      lockTempoPow2: this.draftGenLockTempoPow2,
      forbidPitchStretch: this.draftGenForbidPitchStretch,
      tracks: this.tracks.map((t) => ({ id: t.id, index: t.index })),
      samples: pool.map((s) => {
        const a = analysisById.get(s.id);
        const features = a?.features as Record<string, unknown> | undefined;
        const clap = clapFeatureFromAnalysis(features);
        return {
          id: s.id,
          durationMs: s.durationMs,
          class: s.class,
          favorite: s.favorite,
          loopScore: s.loopScore ?? a?.loopScore,
          loopStartMs: s.loopStartMs,
          loopEndMs: s.loopEndMs,
          loopXfadeMs: s.loopXfadeMs,
          pitchHz: a?.pitchHz,
          noteName: a?.noteName,
          harmonicity: a?.harmonicity,
          centroidHz: a?.centroidHz,
          transientDensity: a?.transientDensity,
          analysisBpm: a?.bpm,
          lufs: a?.lufs,
          peakDbtp: a?.peakDbtp,
          classScores: s.classScores as Record<string, number> | undefined,
          forceRole: s.forceRole,
          tags: s.tags,
          subclass: s.subclass,
          confidence: s.confidence,
          interestScore: s.interestScore,
          rating: s.rating,
          parentSampleId: s.parentSampleId,
          stem: parseStemFromTags(s.tags),
          yamnet: resolveYamnetSlugs(s.tags, features),
          clapVector: clap?.vector,
        };
      }),
    });
    if (planned.clips.length === 0) return;

    for (const c of this.clips) {
      await db.clips.delete(c.id);
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: c.id,
        op: "delete",
        payload: c as unknown as Record<string, unknown>,
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
    }

    const mixById = new Map(planned.tracks.map((t) => [t.trackId, t]));
    const nextTracks = this.tracks.map((tr) => {
      const mix = mixById.get(tr.id);
      if (!mix) return tr;
      return {
        ...tr,
        gainDb: mix.gainDb,
        pan: mix.pan,
        fx: mix.fx,
      };
    });
    await db.tracks.bulkPut(nextTracks);
    this.tracks = nextTracks;
    this.#bounceCache = null;
    this.#syncTrackBuses();

    const sampleById = new Map(pool.map((s) => [s.id, s]));
    const created: Clip[] = planned.clips.map((p) => {
      const sample = sampleById.get(p.sampleId);
      return {
        id: createEntityId(),
        trackId: p.trackId,
        sampleVersionId: createEntityId(),
        sampleId: p.sampleId,
        startTick: p.startTick,
        lengthTick: p.lengthTick,
        contentOffsetMs: p.contentOffsetMs,
        loopEnabled: p.loopEnabled,
        loopLengthMs:
          p.loopLengthMs ??
          (sample?.loopEndMs && sample.loopStartMs
            ? sample.loopEndMs - sample.loopStartMs
            : undefined),
        gainDb: p.gainDb,
        fadeInMs: p.fadeInMs,
        fadeOutMs: p.fadeOutMs,
        fadeCurve: p.fadeCurve,
        pitchSemitones: p.pitchSemitones,
        stretchMode: p.stretchMode,
        reverse: p.reverse,
      };
    });

    await db.clips.bulkPut(created);
    for (const c of created) {
      await db.ops.add({
        id: createEntityId(),
        entityType: "clip",
        entityId: c.id,
        op: "create",
        payload: c as unknown as Record<string, unknown>,
        clientSeq: Date.now(),
        clientId: "local",
        createdAt: nowIso(),
      });
    }

    let next = created;
    const touched = new Set(created.map((c) => c.trackId));
    for (const trackId of touched) {
      next = await this.#persistFades(next, trackId);
    }
    this.clips = next;
    this.selectedId = created[0]?.id ?? null;
    this.#bufferCache.clear();
    if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
    if (this.playing) await this.#resyncSchedule();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-sequencer-page": GlSequencerPage;
  }
}
