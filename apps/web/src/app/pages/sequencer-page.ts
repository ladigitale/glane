import {
  CLASS_COLORS,
  DEFAULT_MASTER_FX,
  PPQ,
  asSampleIndex,
  asTick,
  createEntityId,
  msToSamples,
  normalizeMasterFx,
  normalizeProject,
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
import { TransportEngine, type TapeScrubVoice, type TrackInsertConfig } from "@glane/audio-engine";
import {
  frameCount,
  interleavedToAudioBuffer,
  mapInterleavedChannels,
  reverseInterleaved,
  stretchBuffer,
  tileBuffer,
  toMonoPcm,
} from "@glane/audio-dsp";
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
  styleSuggestedTempoBars,
  styleTempoBarsFit,
  type GenAuto,
  type GenFormStyle,
  type GenGrooveChoice,
  type GenMusicStyleChoice,
  type GenPaletteChoice,
  type GenScaleMode,
  type GenTriState,
  type GenEnsembleRelation,
  type VoiceRelation,
} from "../generative.js";
import { SonicToast } from "@supersoniks/concorde/toast";
import { clapFeatureFromAnalysis } from "../ml/clap-runtime.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { SAMPLE_PROCESSED_EVENT, resolveSamplePitchHz } from "../process-queue.js";
import { exportFormKey, seqDrawerKey } from "../dp-keys.js";
import { glDialog } from "../dialog.js";
import { navigate } from "../router.js";
import { stashSynthHandoff } from "../synth-handoff.js";
import { stashEditorHandoff } from "../editor-handoff.js";
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
  type ReelSceneId,
} from "../reel-export.js";
import { auth } from "../auth.js";
import { saveBounceToLibrary } from "../sample-actions.js";
import {
  CANCEL_ZONE_H,
  MAX_PX_PER_TICK,
  MIN_PX_PER_TICK,
  RULER_H,
  bindTimelineWheel,
  TRACK_GUTTER_PX,
  formatClock,
  paintStretchedWave,
  scrollLeftToCenterUnit,
  edgeScrollAtClientX,
  zoomAtClientX,
  pinchZoomAtClientX,
  lanePointerDistance,
  lanePointerMidpoint,
  TimelineScrollInertia,
} from "../timeline/timeline.js";
import "../track-volume-rotary.js";
import "../track-fx-control.js";
import { formatTrackFxSummaryLines } from "../track-fx-control.js";
import "../pop-select.js";
import "../seek-bar.js";
import "../transport-bar.js";
import "../vu-meter.js";
import { glIcon } from "../icon.js";
import { renderSamplePlayButton, setSampleAuditionPlaying, getSampleAuditionPlaying, clearSampleAudition } from "../sample-play-button.js";
import { tip } from "../tip.js";
import { GL_MODAL_PRESETS, GL_MODAL_SCROLL_LAYOUT } from "../modal-layout.js";
import { chromeMore, type MoreMenuEntry } from "../more-menu.js";
import { isSpaceKey, shouldIgnoreShortcut } from "../keyboard.js";
import type { TransportAction } from "../transport-bar.js";
import type { GlSeekBar } from "../seek-bar.js";
import type { GlTransportBar } from "../transport-bar.js";
import "../form-stack.js";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/form-actions";
import "@supersoniks/concorde/input";
import "@supersoniks/concorde/table";
import "@supersoniks/concorde/table-tbody";
import "@supersoniks/concorde/table-tr";
import "@supersoniks/concorde/table-td";

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
/** Refill the live window when remaining coverage drops below this (hysteresis). */
const PLAY_REFILL_BEATS = 8;
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

const GEN_STRETCH_UP_RATIOS = [1, 1.5, 2, 4, 8] as const;
const GEN_STRETCH_DOWN_RATIOS = [1, 0.5, 0.25, 0.125] as const;

function genStretchRatioLabel(n: number): string {
  if (n === 0.5) return "×½";
  if (n === 0.25) return "×¼";
  if (n === 0.125) return "×⅛";
  return `×${n}`;
}

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
      --sc-label-fs: 0.9rem;
      --sc-label-fw: 500;
    }
    .form-label {
      margin-bottom: 0.22em;
      display: block;
      font-size: var(--sc-label-fs);
      font-weight: var(--sc-label-fw);
      line-height: 1.2;
    }
    .form-description {
      color: var(--sc-base-400, var(--sc-neutral-500, #888));
      font-size: 0.85em;
      margin-top: 0.2em;
      display: block;
    }
    .seq-settings-modal {
      max-height: min(80vh, 42rem);
      overflow-y: auto;
    }
    .transport-wrap,
    .master-mix,
    .master-mix-conf {
      overflow: visible;
    }
    .seq-gen-modal input[type="range"] {
      width: 100%;
      accent-color: var(--sc-primary, #3d7ea6);
    }
    .timeline {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
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
      display: flex;
      flex-direction: column;
      flex: 1 0 auto;
      min-height: 100%;
    }
    .track {
      display: flex;
      flex: 1 1 0;
      min-height: 0;
      width: 100%;
      min-width: 100%;
      box-sizing: border-box;
      border-bottom: 1px solid color-mix(in srgb, var(--gl-fg) 12%, transparent);
    }
    .track-label {
      width: ${TRACK_GUTTER_PX}px;
      flex-shrink: 0;
      min-height: 0;
      overflow: visible;
      background: var(--gl-ink);
      position: sticky;
      right: 0;
      z-index: 5;
      box-shadow: -4px 0 10px color-mix(in srgb, #000 28%, transparent);
    }
    /* Active track switch: checked = audible (green). */
    .track-active-sw {
      --sc-primary: var(--sc-success);
      --sc-primary-content: var(--sc-success-content);
    }
    .lane {
      position: relative;
      flex: 1;
      min-width: 800px;
      min-height: 0;
      box-sizing: border-box;
      overflow: visible;
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
    :host([data-rotate-clip]) .clip:not(.rotate-target) {
      opacity: 0.22;
      filter: saturate(0.35);
      pointer-events: none;
    }
    :host([data-rotate-clip]) .xfade {
      opacity: 0.15;
    }
    :host([data-rotate-clip]) .clip.rotate-target {
      cursor: ew-resize;
      opacity: 1;
      filter: none;
      z-index: 4;
      outline: 2px solid var(--gl-fg);
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--gl-accent) 70%, transparent),
        0 0 14px color-mix(in srgb, var(--gl-accent) 45%, transparent);
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
      flex-shrink: 0;
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
      flex-shrink: 0;
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
      width: ${TRACK_GUTTER_PX}px;
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
    /* Keep list chrome inside the drawer width (no cell min-widths blowout). */
    .drawer sonic-table {
      width: 100%;
      max-width: 100%;
    }
    .drawer .drawer-row-title {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
  /** Track settings modal (active / volume / FX). */
  @state() private trackSettingsId: string | null = null;
  /** Master mix settings modal (preamp + FX). */
  @state() private masterSettingsOpen = false;
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
  @state() private draftGenSampleVariety: number | GenAuto = "auto";
  @state() private draftGenBpmSync: GenTriState = "auto";
  @state() private draftGenLockTempoPow2: GenTriState = "off";
  @state() private draftGenForbidPitchStretch: GenTriState = "off";
  @state() private draftGenStretchUp: number | GenAuto = "auto";
  @state() private draftGenStretchDown: number | GenAuto = "auto";
  @state() private draftGenReverse: GenTriState = "auto";
  @state() private draftGenStutter: GenTriState = "auto";
  @state() private draftGenCallResponse: GenTriState = "auto";
  @state() private draftGenEnsembleRelation: GenEnsembleRelation = "auto";
  @state() private draftGenLockPitch: GenTriState = "off";
  @state() private draftGenPitchUp: number | GenAuto = "auto";
  @state() private draftGenPitchDown: number | GenAuto = "auto";
  /** Pool for generation: all / favorites / sample class. */
  @state() private draftGenSampleFilter: SampleClass | "all" | "favorite" =
    "all";
  /** Exact tag matches (OR); empty = all. */
  @state() private draftGenTagFilter: string[] = [];
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

  @subscribe(exportFormKey.reelBg)
  @state()
  reelBg = reelExport.defaults.bgColor;

  @subscribe(exportFormKey.reelAccent)
  @state()
  reelAccent = reelExport.defaults.accentColor;

  @subscribe(exportFormKey.reelScenes)
  @state()
  reelScenes: string[] = [...reelExport.defaults.scenes];

  @state() private scStatus: SoundCloudStatus | null = null;
  @state() private listenMeta: ListenMeta | null = null;
  @state() private listenVisibility: "unlisted" | "private" = "unlisted";
  #bounceCache: BounceResult | null = null;

  @handle(exportFormKey.title)
  onExportTitle(_title: string): void {
    this.#bounceCache = null;
  }

  #engine: TransportEngine | null = null;
  #auditionGen = 0;
  #fsm = new GestureFsm();
  @state() private dragClipId: string | null = null;
  #dragStartX = 0;
  #dragStartTick = 0;
  #dragStartTrackId = "";
  #lastTapClipId: string | null = null;
  #lastTapAt = 0;
  #selDragging = false;
  /** Edge auto-pan while dragging loop selection / edges. */
  #selEdgeScrollRaf = 0;
  #selEdgeScrollX = 0;
  #selEdgeScrollApply: (() => void) | null = null;
  /** Lane pan / zoom / pinch — multi-pointer bookkeeping. */
  #lanePtrs = new Map<number, { x: number; y: number }>();
  #laneKind: GestureKind | "pinch" | "pinch-done" | null = null;
  #lanePinchDist = 0;
  #laneLastX = 0;
  #laneLastY = 0;
  #laneListening = false;
  #scrollInertia = new TimelineScrollInertia();
  #bufferCache = new Map<string, AudioBuffer>();
  #pcmCache = new Map<
    string,
    { pcm: Float32Array; sampleRate: number; channelCount: number }
  >();
  #wavePaintToken = 0;
  #wavePaintRaf = 0;
  #pendingScrollLeft: number | null = null;
  #raf = 0;
  /** Bumps to cancel in-flight schedule hydration. */
  #hydrateGen = 0;
  /** Bumps on pause / superseding play — only latest play arm may set playing. */
  #playGen = 0;
  /** Tick horizon already covered by the live schedule window. */
  #scheduledToTick = 0;
  #tlRo: ResizeObserver | null = null;
  /** While true, scroll the lane so the playhead stays centered. */
  #followPlayhead = true;
  /** True while pointer is panning / zooming the timeline (not scrub). */
  #viewBusy = false;
  /** Manual playhead / seek-bar drag — owns position over transport RAF. */
  #scrubbing = false;
  #tapeRaf = 0;
  /** Resume transport after tape scrub if it was playing. */
  #resumeAfterTape = false;
  /** ~30 fps transport paint on coarse pointers (mobile). */
  #transportFrameMs =
    typeof matchMedia !== "undefined" &&
    matchMedia("(pointer: coarse)").matches
      ? 32
      : 0;
  #lastTransportFrame = 0;
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
    if (e.key === "Escape" && this.rotateClipTool) {
      e.preventDefault();
      this.#clearRotateClipTool();
      return;
    }
    if (!isSpaceKey(e) || shouldIgnoreShortcut(e)) return;
    e.preventDefault();
    void this.#handleTransport(
      this.playing || this.loadingPlay ? "pause" : "play",
    );
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
    this.#syncChromeMore();
  }

  #seqMoreItems(): MoreMenuEntry[] {
    const bars = this.project?.bars ?? 16;
    const bpm = this.project?.bpm ?? 120;
    return [
      {
        label: t("seq.bpmTitle"),
        icon: "gauge",
        hint: String(bpm),
        disabled: !this.project,
        onClick: () => this.#openSeqModal("bpm"),
      },
      {
        label: t("seq.barsTitle"),
        icon: "ruler",
        hint: `${bars} ${t("seq.barsUnit")}`,
        disabled: !this.project,
        onClick: () => this.#openSeqModal("bars"),
      },
      "divider",
      {
        label: t("seq.undo"),
        icon: "undo",
        onClick: () => void this.#undo(),
      },
      {
        label: t("seq.generate"),
        icon: "wand",
        disabled:
          !this.project ||
          this.samples.length === 0 ||
          this.tracks.length === 0,
        onClick: () => this.#openSeqModal("generate"),
      },
      {
        label: this.exportBusy ?? t("export.open"),
        icon: "download",
        disabled:
          !this.project ||
          this.clips.length === 0 ||
          Boolean(this.exportBusy),
        onClick: () => void this.#toggleExportPanel(),
      },
      "divider",
      {
        label: t("seq.docs"),
        icon: "book-open",
        onClick: () => this.#openSeqModal("docs"),
      },
    ];
  }

  #syncChromeMore(): void {
    if (!this.isConnected) return;
    chromeMore.set({
      ariaLabel: t("seq.more"),
      items: this.#seqMoreItems(),
    });
  }

  override disconnectedCallback(): void {
    chromeMore.clear();
    this.#persistUiState();
    window.removeEventListener("keydown", this.#onKey);
    window.removeEventListener(SAMPLE_PROCESSED_EVENT, this.#onSampleProcessed);
    window.removeEventListener("pagehide", this.#onPageHide);
    window.removeEventListener("pointermove", this.#onLanePointerMove);
    window.removeEventListener("pointerup", this.#onLanePointerUp);
    window.removeEventListener("pointercancel", this.#onLanePointerUp);
    this.#laneListening = false;
    this.#lanePtrs.clear();
    this.#unsubWheel?.();
    this.#unsubWheel = null;
    const timeline = this.#timelineEl();
    timeline?.removeEventListener("wheel", this.#onTimelineUserWheel);
    timeline?.removeEventListener("scroll", this.#onTimelineScroll);
    this.#tlRo?.disconnect();
    this.#tlRo = null;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#wavePaintRaf);
    this.#stopSelEdgeScroll();
    this.#scrollInertia.cancel();
    this.#engine?.stop();
    clearSampleAudition();
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
      playheadTick: this.#transportPlayheadTick(),
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
        sampleVariety: this.draftGenSampleVariety,
        bpmSync: this.draftGenBpmSync,
        lockTempoPow2: this.draftGenLockTempoPow2,
        forbidPitchStretch: this.draftGenForbidPitchStretch,
        stretchUpRatio: this.draftGenStretchUp,
        stretchDownRatio: this.draftGenStretchDown,
        reverse: this.draftGenReverse,
        stutter: this.draftGenStutter,
        callResponse: this.draftGenCallResponse,
        ensembleRelation: this.draftGenEnsembleRelation,
        lockPitch: this.draftGenLockPitch,
        pitchUpSemitones: this.draftGenPitchUp,
        pitchDownSemitones: this.draftGenPitchDown,
        sampleFilter: this.draftGenSampleFilter,
        tagFilter: this.draftGenTagFilter,
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
    this.draftGenSampleVariety = g.sampleVariety;
    this.draftGenBpmSync = g.bpmSync as GenTriState;
    this.draftGenLockTempoPow2 =
      g.lockTempoPow2 === "on" ? "on" : "off";
    this.draftGenForbidPitchStretch =
      g.forbidPitchStretch === "on" ? "on" : "off";
    this.draftGenStretchUp = g.stretchUpRatio;
    this.draftGenStretchDown = g.stretchDownRatio;
    this.draftGenReverse = g.reverse as GenTriState;
    this.draftGenStutter = g.stutter as GenTriState;
    this.draftGenCallResponse = g.callResponse as GenTriState;
    this.draftGenEnsembleRelation = (
      g.ensembleRelation === "lock" ||
      g.ensembleRelation === "respond" ||
      g.ensembleRelation === "kinship"
        ? g.ensembleRelation
        : "auto"
    ) as GenEnsembleRelation;
    this.draftGenLockPitch = g.lockPitch === "on" ? "on" : "off";
    this.draftGenPitchUp = g.pitchUpSemitones;
    this.draftGenPitchDown = g.pitchDownSemitones;
    this.draftGenSampleFilter = g.sampleFilter;
    this.draftGenTagFilter = g.tagFilter;
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
        cancelAnimationFrame(this.#wavePaintRaf);
        this.#wavePaintRaf = requestAnimationFrame(() => {
          void this.#paintClipWaves();
        });
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
    const usableW = Math.max(64, timeline.clientWidth - TRACK_GUTTER_PX);
    const start = timeline.scrollLeft / this.pxPerTick;
    const end = (timeline.scrollLeft + usableW) / this.pxPerTick;
    const viewStart = Math.max(0, Math.min(max, start));
    const viewEnd = Math.max(viewStart, Math.min(max, end));
    // During play, paint seek-bar imperatively — @state / @property re-renders the bar.
    if (this.playing && !this.#scrubbing) {
      const seek = this.renderRoot.querySelector<GlSeekBar>("gl-seek-bar");
      if (seek) {
        seek.paintPosition({
          value: this.#transportPlayheadTick(),
          max,
          viewStart,
          viewEnd,
        });
      }
      return;
    }
    this.viewStartTick = viewStart;
    this.viewEndTick = viewEnd;
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
    const usableW = Math.max(64, timeline.clientWidth - TRACK_GUTTER_PX);
    const next = scrollLeftToCenterUnit(
      this.#transportPlayheadTick(),
      this.pxPerTick,
      usableW,
      0,
      Math.max(usableW, timeline.scrollWidth - TRACK_GUTTER_PX),
    );
    if (timeline.scrollLeft !== next) {
      if (Math.abs(next - timeline.scrollLeft) >= 1) {
        timeline.scrollLeft = next;
      } else {
        this.#syncViewWindow();
      }
    } else {
      this.#syncViewWindow();
    }
  }

  /** Engine clock during play (avoids stale @state playheadTick). */
  #transportPlayheadTick(): number {
    if (this.#engine && this.playing && this.project && !this.#scrubbing) {
      const lat = Math.floor(
        this.#engine.outputLatencySec * this.#engine.sampleRate,
      );
      const sample = asSampleIndex(
        Math.max(0, this.#engine.playheadSample() - lat),
      );
      return samplesToTicks(sample, this.project.bpm, this.#engine.sampleRate);
    }
    return this.playheadTick;
  }

  /** Move playhead chrome without a Lit render of the whole sequencer. */
  #paintTransportPlayhead(tick: number): void {
    const px = tick * this.pxPerTick;
    const root = this.renderRoot;
    const line = root.querySelector<HTMLElement>(".timeline-canvas > .playhead");
    const handle = root.querySelector<HTMLElement>(".time-handle.playhead");
    const progress = root.querySelector<HTMLElement>(".ruler-progress");
    if (line) line.style.left = `${px}px`;
    if (handle) handle.style.left = `${px}px`;
    if (progress) progress.style.width = `${Math.max(0, px)}px`;
    const seek = root.querySelector<GlSeekBar>("gl-seek-bar");
    if (seek) {
      const max = Math.max(1, this.#projectLengthTick());
      const timeline = this.#timelineEl();
      let viewStart = this.viewStartTick;
      let viewEnd = this.viewEndTick;
      if (timeline) {
        const usableW = Math.max(64, timeline.clientWidth - TRACK_GUTTER_PX);
        const start = timeline.scrollLeft / this.pxPerTick;
        const end = (timeline.scrollLeft + usableW) / this.pxPerTick;
        viewStart = Math.max(0, Math.min(max, start));
        viewEnd = Math.max(viewStart, Math.min(max, end));
      }
      seek.paintPosition({ value: tick, max, viewStart, viewEnd });
    }
    const bar = root.querySelector<GlTransportBar>("gl-transport-bar");
    if (bar && this.project) {
      bar.paintClock(formatClock(ticksToMs(tick, this.project.bpm)));
    }
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

  /** Pinch zoom about midpoint (mobile multitouch). */
  #pinchZoomAtClientX(
    distance0: number,
    distance1: number,
    clientX: number,
  ): void {
    const timeline = this.#timelineEl();
    if (!timeline) return;
    const next = pinchZoomAtClientX(
      timeline,
      this.pxPerTick,
      distance0,
      distance1,
      clientX,
      0,
      MIN_PX_PER_TICK,
      MAX_PX_PER_TICK,
    );
    if (!next) return;
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
      ${this.rotateClipTool
        ? html`<div
            class="toolbar flex shrink-0 flex-wrap items-center gap-2 px-4 pb-1.5 pt-3 max-md:gap-1.5 max-md:px-2.5 max-md:pb-1 max-md:pt-2"
          >
            <div
              class="flex min-w-0 flex-1 items-center gap-2 text-xs text-content"
              role="status"
            >
              <span class="truncate">${t("seq.rotateHint")}</span>
              <sonic-button
                size="xs"
                variant="ghost"
                type="neutral"
                @click=${() => this.#clearRotateClipTool()}
              >
                ${t("dialog.cancel")}
              </sonic-button>
            </div>
          </div>`
        : nothing}
      ${this.#renderExportModal()}
      ${this.#renderSeqModals(bars, seqDurMs)}
      ${this.#renderClipOptsModal()}
      ${this.#renderTrackSettingsModal()}
      ${this.#renderMasterSettingsModal()}
      ${this.#renderClipCtxMenu()}
      <div class="workspace relative flex min-h-0 flex-1 overflow-visible">
        <div class="timeline">
          ${this.dropCancelOpen
            ? html`<div
                class="cancel-zone ${this.cancelHot ? "hot" : ""}"
                title=${this.dragClipId
                  ? t("seq.dropDelete")
                  : t("seq.dropCancel")}
                aria-label=${this.dragClipId
                  ? t("seq.dropDelete")
                  : t("seq.dropCancel")}
              >
                ${glIcon("trash-2", { size: "sm" })}
              </div>`
            : nothing}
          <div
            class="timeline-canvas"
            style="min-width:${laneW + TRACK_GUTTER_PX + Math.ceil(HANDLE_PX / 2)}px"
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
                  title=${t("seq.loopSel")}
                ></div>`
              : null}
            ${hasLoopSel
              ? html`
                  <div
                    class="time-handle"
                    style="left:${selL! * this.pxPerTick}px"
                    title=${t("seq.loopIn")}
                    @pointerdown=${(e: PointerEvent) =>
                      this.#loopEdgeDown(e, "start")}
                  ></div>
                  <div
                    class="time-handle"
                    style="left:${selR! * this.pxPerTick}px"
                    title=${t("seq.loopOut")}
                    @pointerdown=${(e: PointerEvent) =>
                      this.#loopEdgeDown(e, "end")}
                  ></div>
                `
              : null}
            <div
              class="time-handle playhead"
              style="left:${this.playheadTick * this.pxPerTick}px"
              title=${t("seq.playhead")}
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
      <div class="transport-wrap shrink-0 px-4 pb-2.5 max-md:px-2.5 max-md:pb-2">
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
          ${this.project ? this.#renderMasterMix() : nothing}
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
      ${tip(
        label,
        html`
          <button
            type="button"
            class="drawer-switch z-10 inline-flex w-7 shrink-0 cursor-pointer items-center justify-center self-stretch border-0 border-l border-neutral-500/15 bg-neutral-0 p-0 text-neutral-500 hover:bg-neutral-100 hover:text-content focus-visible:bg-neutral-100 focus-visible:text-content"
            aria-label=${label}
            aria-expanded=${this.drawerOpen}
            aria-controls="gl-seq-drawer"
            @click=${() => (this.drawerOpen = !this.drawerOpen)}
          >
            ${glIcon(this.drawerOpen ? "chevron-right" : "chevron-left", {
              size: "xs",
            })}
          </button>
        `,
      )}
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
        <div class="drawer-list flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          <sonic-table
            class="block h-full min-h-0 w-full max-w-full"
            size="sm"
            bordered
            rounded
            maxHeight="100%"
          >
            <sonic-tbody>
              ${this.#drawerSamples.length === 0
                ? html`
                    <sonic-tr>
                      <sonic-td>
                        <span class="font-mono text-[0.7rem] text-neutral-500"
                          >Aucun sample — capture d’abord.</span
                        >
                      </sonic-td>
                    </sonic-tr>
                  `
                : this.#drawerSamples.map((s) => this.#renderDrawerSampleRow(s))}
            </sonic-tbody>
          </sonic-table>
        </div>
      </aside>
    `;
  }

  #renderDrawerSampleRow(s: Sample) {
    const placing = this.placingSampleId === s.id;
    const playing = getSampleAuditionPlaying() === s.id;
    const title = s.userName ?? s.name;
    return html`
      <sonic-tr
        class="cursor-grab touch-none select-none ${placing ? "opacity-45" : ""}"
        type=${placing || playing ? "info" : nothing}
        @pointerdown=${(e: PointerEvent) => this.#drawerDown(e, s)}
      >
        <sonic-td width="0.75rem" vAlign="middle">
          <span
            class="block h-7 w-2 rounded-sm"
            style="background:${CLASS_COLORS[s.class]}"
          ></span>
        </sonic-td>
        <sonic-td vAlign="middle">
          ${tip(
            t("seq.placeSample"),
            html`
              <div class="drawer-row-title">${title}</div>
              <div
                class="drawer-row-title font-mono text-[0.7rem] text-neutral-500"
              >
                ${s.class} · ${s.durationMs}ms
              </div>
            `,
            { class: "w-full max-w-full justify-start text-left", focusable: true },
          )}
        </sonic-td>
        <sonic-td width="1.75rem" align="center" vAlign="middle">
          ${renderSamplePlayButton({
            sampleId: s.id,
            size: "2xs",
            onClick: () => void this.#audition(s),
          })}
        </sonic-td>
        <sonic-td width="1.25rem" align="right" vAlign="middle">
          <span class="font-mono text-[0.7rem] text-neutral-500"
            >${s.favorite ? "★" : "⋮⋮"}</span
          >
        </sonic-td>
      </sonic-tr>
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
                title=${t("seq.loopMove")}
                @pointerdown=${this.#loopMoveDown}
              ></div>`
            : null}
          <div
            class="seq-end"
            style="left:${seqEndPx}px"
            title=${t("seq.seqEndDrag")}
            @pointerdown=${this.#seqEndDown}
          ></div>
        </div>
        <div
          class="ruler-gutter flex flex-col justify-center gap-px px-1 font-mono text-[0.6rem] text-neutral-500"
          aria-label=${t("seq.barsTitle")}
        >
          ${tip(
            t("seq.editBpm"),
            html`
              <button
                type="button"
                class="stat block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-px px-0.5 text-left font-mono text-[0.55rem] leading-tight text-neutral-500 hover:bg-neutral-500/10 hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!this.project}
                @click=${() => this.#openSeqModal("bpm")}
              >
                ${bpm} ${t("seq.bpm")}
              </button>
            `,
            { class: "block w-full" },
          )}
          ${tip(
            t("seq.editBars"),
            html`
              <button
                type="button"
                class="stat block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-px px-0.5 text-left font-mono text-[0.55rem] leading-tight text-neutral-500 hover:bg-neutral-500/10 hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!this.project}
                @click=${() => this.#openSeqModal("bars")}
              >
                ${bars} ${t("seq.barsUnit")} · ${formatClock(seqDurMs)}
              </button>
            `,
            { class: "block w-full" },
          )}
        </div>
      </div>
    `;
  }

  #renderTrack(tr: Track, laneW: number) {
    const laneClips = this.clips.filter((c) => c.trackId === tr.id);
    const xfades = trackXfadeZones(laneClips);
    const lines = this.#trackConfLines(tr);
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
                title=${t("seq.crossfade")}
              ></div>
            `,
          )}
          ${laneClips.map((c) => this.#renderClip(c))}
        </div>
        <div
          class="track-label relative flex min-h-0 flex-col justify-center overflow-visible py-1 pl-1 pr-7 text-neutral-500"
        >
          <div
            class="flex min-w-0 flex-col gap-px font-mono text-[0.6rem] leading-tight"
            title=${lines.join(" · ")}
          >
            ${lines.map(
              (line) => html`<span class="truncate">${line}</span>`,
            )}
          </div>
          ${tip(
            t("seq.trackSettingsHint"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="xs"
                icon
                class="shrink-0"
                data-aria-label=${`${tr.name} — ${t("seq.trackSettingsHint")}`}
                @click=${() => {
                  this.trackSettingsId = tr.id;
                }}
              >
                ${glIcon("sliders", { size: "xs" })}
              </sonic-button>
            `,
            { class: "absolute right-0.5 top-0.5" },
          )}
        </div>
      </div>
    `;
  }

  #gainLinLabel(gainDb: number): string {
    const lin = gainDbToLin(gainDb);
    return `×${lin.toFixed(lin === 0 || lin === 1 || lin === 2 ? 0 : 2)}`;
  }

  /** One line per conf family for the sticky gutter (no track name). */
  #trackConfLines(tr: Track): string[] {
    const lines: string[] = [];
    if (tr.mute) lines.push("M");
    lines.push(this.#gainLinLabel(tr.gainDb));
    lines.push(...formatTrackFxSummaryLines(tr.fx));
    return lines;
  }

  #masterConfLines(p: Project): string[] {
    const [fx0, fx1] = this.#masterFxPair();
    const lines = [this.#gainLinLabel(p.preampGainDb ?? 0)];
    lines.push(...formatTrackFxSummaryLines(fx0, true));
    lines.push(...formatTrackFxSummaryLines(fx1, true));
    return lines;
  }

  #renderTrackSettingsModal() {
    const tr = this.tracks.find((t) => t.id === this.trackSettingsId);
    const open = !!tr;
    const m = GL_MODAL_PRESETS.panel;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${open}
        @hide=${() => {
          this.trackSettingsId = null;
        }}
      >
        <sonic-modal-title
          >${tr
            ? `${t("seq.trackSettings")} — ${tr.name}`
            : t("seq.trackSettings")}</sonic-modal-title
        >
        <sonic-modal-content>
          ${tr
            ? html`
                <gl-form-stack class="seq-settings-modal text-content">
                  <gl-form-section label=${t("seq.sectionVolume")} tight>
                    <div class="flex flex-wrap items-center gap-2">
                      <sonic-switch
                        class="track-active-sw"
                        .checked=${tr.mute ? null : true}
                        @change=${(e: Event) => {
                          const on =
                            (e.target as HTMLElement & { checked: true | null })
                              .checked === true;
                          void this.#setTrackActive(tr, on);
                        }}
                      >
                        ${t("seq.trackActive")}
                      </sonic-switch>
                      <gl-track-volume-rotary
                        .gainDb=${tr.gainDb}
                        @gl-gain=${(e: CustomEvent<{
                          gainDb: number;
                          commit: boolean;
                        }>) =>
                          void this.#onTrackGain(
                            tr,
                            e.detail.gainDb,
                            e.detail.commit,
                          )}
                      ></gl-track-volume-rotary>
                      <span class="font-mono text-xs text-neutral-500"
                        >${this.#gainLinLabel(tr.gainDb)}</span
                      >
                    </div>
                  </gl-form-section>
                  <gl-track-fx-control
                    inline
                    .fx=${tr.fx}
                    .fxAriaLabel=${t("seq.sectionFx")}
                    @gl-fx=${(e: CustomEvent<{
                      fx: TrackFx;
                      commit: boolean;
                    }>) =>
                      void this.#onTrackFx(tr, e.detail.fx, e.detail.commit)}
                  ></gl-track-fx-control>
                </gl-form-stack>
              `
            : nothing}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.ok")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }


  #renderClip(c: Clip) {
    const sample = this.samples.find((s) => s.id === c.sampleId);
    const color = sample
      ? CLASS_COLORS[sample.class]
      : CLASS_COLORS.texture;
    const selected = this.selectedId === c.id;
    const rotateTarget = this.rotateClipTool && selected;
    const clipW = Math.max(8, c.lengthTick * this.pxPerTick);
    const clipName = sample?.userName ?? sample?.name ?? "";
    return html`
      <div
        class="clip ${selected ? "selected" : ""} ${rotateTarget
          ? "rotate-target"
          : ""} ${this.snapHighlightId === c.id ? "snap" : ""}"
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
        ${selected && !this.rotateClipTool
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
    if (!projectId) {
      this.samples = [];
      return;
    }
    this.samples = await db.samples
      .where("projectId")
      .equals(projectId)
      .filter((s) => !s.deletedAt && s.class !== "voice")
      .reverse()
      .sortBy("createdAt");
  }

  async #audition(s: Sample): Promise<void> {
    if (getSampleAuditionPlaying() === s.id) {
      // Shared engine — also clears a stuck transport `playing` flag.
      this.#haltTransport();
      return;
    }
    // Audition shares the engine with transport — halt play chrome first.
    if (this.playing) this.#haltTransport();
    this.#engine ??= new TransportEngine();
    const data = await loadSampleAudio(s);
    if (!data) return;
    const buf = interleavedToAudioBuffer(
      this.#engine.ctx,
      data.pcm,
      data.sampleRate,
      data.channelCount,
    );
    const gen = ++this.#auditionGen;
    setSampleAuditionPlaying(s.id);
    this.#engine.audition(buf, 5, () => {
      if (gen === this.#auditionGen) clearSampleAudition();
    });
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
    if (!p) {
      this.project = null;
      this.tracks = [];
      this.clips = [];
      this.selectedId = null;
      return;
    }
    if (this.playing) {
      this.#engine?.stop();
      this.playing = false;
    }
    this.project = normalizeProject(p);
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
    this.#engine.master.gain.value = dbToGain(this.project.masterGainDb);
    this.#syncMasterFx();
    this.#syncTrackBuses();
  }

  #preampDb(): number {
    const v = this.project?.preampGainDb;
    return Number.isFinite(v) ? (v as number) : 0;
  }

  #masterFxPair(): [TrackFx, TrackFx] {
    const raw = this.project?.masterFx;
    return [
      normalizeMasterFx(raw?.[0] ?? DEFAULT_MASTER_FX[0]),
      normalizeMasterFx(raw?.[1] ?? DEFAULT_MASTER_FX[1]),
    ];
  }

  #syncMasterFx(): void {
    if (!this.#engine || !this.project) return;
    const [a, b] = this.#masterFxPair();
    this.#engine.setMasterFx(a, b, this.project.bpm);
  }

  #insertConfig(tr: Track): TrackInsertConfig {
    return trackToInsertConfig(
      tr,
      this.project?.bpm ?? 120,
      this.#preampDb(),
    );
  }

  #syncTrackBuses(): void {
    this.#engine?.syncTrackBuses(this.tracks.map((tr) => this.#insertConfig(tr)));
  }

  #renderMasterMix() {
    const p = this.project;
    if (!p) return nothing;
    const lines = this.#masterConfLines(p);
    return html`
      <div
        class="master-mix flex items-center gap-2 overflow-visible"
        role="group"
        aria-label=${t("seq.masterMix")}
      >
        <div
          class="master-mix-conf relative flex min-w-[5rem] flex-col justify-center overflow-visible py-0.5 pl-0.5 pr-7 text-neutral-500"
        >
          <div
            class="flex flex-col gap-px overflow-visible font-mono text-[0.6rem] leading-snug"
            title=${lines.join(" · ")}
          >
            ${lines.map(
              (line) =>
                html`<span class="block overflow-visible whitespace-nowrap"
                  >${line}</span
                >`,
            )}
          </div>
          ${tip(
            t("seq.masterSettingsHint"),
            html`
              <sonic-button
                shape="circle"
                variant="ghost"
                type="neutral"
                size="xs"
                icon
                class="shrink-0"
                data-aria-label=${t("seq.masterSettingsHint")}
                @click=${() => {
                  this.masterSettingsOpen = true;
                }}
              >
                ${glIcon("sliders", { size: "xs" })}
              </sonic-button>
            `,
            { class: "absolute right-0 top-0" },
          )}
        </div>
        <gl-vu-meter
          .analyser=${this.#engine?.analyser ?? null}
          ?active=${this.playing}
          .label=${t("seq.masterVu")}
        ></gl-vu-meter>
      </div>
    `;
  }

  #renderMasterSettingsModal() {
    const p = this.project;
    const [fx0, fx1] = p ? this.#masterFxPair() : [null, null];
    const m = GL_MODAL_PRESETS.panel;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.masterSettingsOpen && !!p}
        @hide=${() => {
          this.masterSettingsOpen = false;
        }}
      >
        <sonic-modal-title>${t("seq.masterSettings")}</sonic-modal-title>
        <sonic-modal-content>
          ${p && fx0 && fx1
            ? html`
                <gl-form-stack class="seq-settings-modal text-content">
                  <gl-form-section label=${t("seq.preamp")} tight>
                    <div class="flex flex-wrap items-center gap-2">
                      <gl-track-volume-rotary
                        large
                        .label=${t("seq.preamp")}
                        title=${t("seq.preampHint")}
                        .gainDb=${p.preampGainDb ?? 0}
                        @gl-gain=${(e: CustomEvent<{
                          gainDb: number;
                          commit: boolean;
                        }>) =>
                          void this.#onPreampGain(
                            e.detail.gainDb,
                            e.detail.commit,
                          )}
                      ></gl-track-volume-rotary>
                      <span class="font-mono text-xs text-neutral-500"
                        >${t("seq.preamp")}
                        ${this.#gainLinLabel(p.preampGainDb ?? 0)}</span
                      >
                    </div>
                  </gl-form-section>
                  <gl-track-fx-control
                    inline
                    wetOnly
                    .fxAriaLabel=${t("seq.masterFx1")}
                    .fx=${fx0}
                    @gl-fx=${(e: CustomEvent<{
                      fx: TrackFx;
                      commit: boolean;
                    }>) =>
                      void this.#onMasterFx(0, e.detail.fx, e.detail.commit)}
                  ></gl-track-fx-control>
                  <gl-track-fx-control
                    inline
                    wetOnly
                    .fxAriaLabel=${t("seq.masterFx2")}
                    .fx=${fx1}
                    @gl-fx=${(e: CustomEvent<{
                      fx: TrackFx;
                      commit: boolean;
                    }>) =>
                      void this.#onMasterFx(1, e.detail.fx, e.detail.commit)}
                  ></gl-track-fx-control>
                </gl-form-stack>
              `
            : nothing}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.ok")}
          </sonic-button>
        </sonic-modal-actions>
      </sonic-modal>
    `;
  }


  /** Active = audible; inactive mutes the track. */
  async #setTrackActive(tr: Track, active: boolean): Promise<void> {
    tr.mute = !active;
    await db.tracks.put(tr);
    this.tracks = [...this.tracks];
    if (this.playing) await this.#resyncSchedule();
  }

  #gainWriteBusy = false;
  #mixWriteBusy = false;

  async #persistProjectMix(commit: boolean): Promise<void> {
    if (!this.project) return;
    if (!commit) {
      if (this.playing && !this.#mixWriteBusy) {
        this.#mixWriteBusy = true;
        try {
          await db.projects.put(this.project);
        } finally {
          this.#mixWriteBusy = false;
        }
      }
      return;
    }
    this.project = {
      ...this.project,
      updatedAt: nowIso(),
      revision: this.project.revision + 1,
    };
    await db.projects.put(this.project);
  }

  async #onPreampGain(gainDb: number, commit: boolean): Promise<void> {
    if (!this.project) return;
    this.project = { ...this.project, preampGainDb: gainDb };
    this.#bounceCache = null;
    this.#syncTrackBuses();
    await this.#persistProjectMix(commit);
  }

  async #onMasterFx(
    slot: 0 | 1,
    fx: TrackFx,
    commit: boolean,
  ): Promise<void> {
    if (!this.project) return;
    const pair = this.#masterFxPair();
    pair[slot] = normalizeMasterFx(fx);
    this.project = { ...this.project, masterFx: pair };
    this.#bounceCache = null;
    this.#syncMasterFx();
    await this.#persistProjectMix(commit);
  }

  async #onTrackGain(
    tr: Track,
    gainDb: number,
    commit: boolean,
  ): Promise<void> {
    tr.gainDb = gainDb;
    if (!(this.playing && !commit)) this.tracks = [...this.tracks];
    this.#bounceCache = null;
    this.#engine?.setTrackInsert(this.#insertConfig(tr));
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
    if (!(this.playing && !commit)) this.tracks = [...this.tracks];
    this.#bounceCache = null;
    this.#engine?.setTrackInsert(this.#insertConfig(tr));
    if (commit) await db.tracks.put(tr);
  }

  async #ensureSamplePcm(
    sampleId: string,
  ): Promise<{
    pcm: Float32Array;
    sampleRate: number;
    channelCount: number;
  } | null> {
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
      channelCount: data.channelCount ?? 1,
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
    const cssH = Math.max(
      24,
      canvas.clientHeight || (track?.heightPx ?? 56) - 8,
    );
    const ch = entry.channelCount ?? 1;
    const wavePcm = toMonoPcm(
      clip.reverse ? reverseInterleaved(entry.pcm, ch) : entry.pcm,
      ch,
    );
    paintStretchedWave(
      canvas,
      wavePcm,
      clip.stretchMode,
      Math.max(1, clipSamples),
      offsetSamples,
      cssW,
      cssH,
    );
  }

  #bufferCacheKey(
    sampleId: string,
    clip?: Clip,
    opts?: { bakeCopy?: boolean },
  ): string {
    const bakeCopy = opts?.bakeCopy === true;
    if (!clip) return sampleId;
    return `${sampleId}:${clip.stretchMode}:${clip.lengthTick}:${clip.contentOffsetMs}:${clip.loopEnabled ? 1 : 0}:${clip.loopLengthMs ?? 0}:${clip.reverse ? 1 : 0}:${bakeCopy ? "bake" : "live"}`;
  }

  async #loadBufferForSample(
    sampleId: string,
    clip?: Clip,
    opts?: { bakeCopy?: boolean },
  ): Promise<AudioBuffer | null> {
    if (!this.#engine || !this.project) return null;
    const bakeCopy = opts?.bakeCopy === true;
    const cacheKey = this.#bufferCacheKey(sampleId, clip, opts);
    const cached = this.#bufferCache.get(cacheKey);
    if (cached) {
      this.#bufferCache.delete(cacheKey);
      this.#bufferCache.set(cacheKey, cached);
      return cached;
    }
    const data = await this.#ensureSamplePcm(sampleId);
    if (!data) return null;
    const ch = data.channelCount ?? 1;
    let pcm: Float32Array = new Float32Array(data.pcm);

    if (clip?.reverse) {
      pcm = new Float32Array(reverseInterleaved(pcm, ch));
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
        const frames = frameCount(pcm, ch);
        const start = Math.min(offset, frames);
        const end = Math.min(frames, offset + loopSamples);
        pcm = new Float32Array(
          mapInterleavedChannels(pcm, ch, (plane) => {
            const slice = plane.subarray(start, end);
            return new Float32Array(
              tileBuffer(
                slice.length > 0 ? slice : plane,
                Math.max(1, target),
                0,
              ),
            );
          }),
        );
      } else {
        pcm = new Float32Array(
          mapInterleavedChannels(pcm, ch, (plane) =>
            new Float32Array(tileBuffer(plane, Math.max(1, target), offset)),
          ),
        );
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
      const frames = frameCount(pcm, ch);
      const ratio = frames / Math.max(1, target);
      if (Math.abs(ratio - 1) > 0.01) {
        const mode =
          clip.stretchMode === "resample" ? "resample" : "preserve-pitch";
        pcm = new Float32Array(
          mapInterleavedChannels(pcm, ch, (plane) =>
            new Float32Array(stretchBuffer(plane, ratio, mode)),
          ),
        );
      }
    }

    const buf = interleavedToAudioBuffer(
      this.#engine.ctx,
      pcm,
      data.sampleRate,
      ch,
    );
    this.#bufferCache.set(cacheKey, buf);
    while (this.#bufferCache.size > BUFFER_CACHE_MAX) {
      const oldest = this.#bufferCache.keys().next().value;
      if (oldest == null) break;
      this.#bufferCache.delete(oldest);
    }
    // Let the audio scheduler run between expensive stretch/decode jobs.
    await new Promise<void>((r) => setTimeout(r, 0));
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
    const audible = audibleTrackIds(this.tracks);
    const trackFxById = new Map(
      this.tracks.map((tr) => [tr.id, tr.fx] as const),
    );
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
          trackFxById.get(clip.trackId),
        ),
      );
    }
    return out;
  }

  async #resyncSchedule(): Promise<void> {
    if (!this.#engine || !this.playing || !this.project) return;
    const ph = this.#transportPlayheadTick();
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
        const ph = this.#transportPlayheadTick();
        const preload = this.#playPreloadTicks();
        const refill = PLAY_REFILL_BEATS * PPQ;
        const loop = this.#transportLoopRange();
        const remain = this.#scheduledToTick - ph;
        const nearLoop = !!(loop && ph + refill >= loop.end);
        if (remain > refill && !nearLoop) {
          await new Promise<void>((r) => setTimeout(r, 80));
          continue;
        }
        let from = ph;
        let to = ph + preload;
        if (loop && ph + preload >= loop.end) {
          from = Math.min(from, loop.start);
          to = Math.max(to, loop.start + preload);
        }
        const scheduled = await this.#buildSchedule({
          windowTicks: { from, to },
        });
        if (!this.playing || gen !== this.#hydrateGen || !this.#engine) return;
        this.#engine.setClips(scheduled);
        this.#scheduledToTick = Math.max(to, this.#transportPlayheadTick() + preload);
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
    const m = GL_MODAL_PRESETS.wide;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${this.exportOpen}
        @hide=${this.onExportHide}
      >
        <sonic-modal-title>${t("export.title")}</sonic-modal-title>
        <sonic-modal-content>
          <div
            class="export-modal-body flex w-full flex-col gap-4"
            formDataProvider=${exportFormKey.path}
          >
            <sonic-input
              name="title"
              label=${t("export.trackTitle")}
              type="text"
            ></sonic-input>
            <sonic-form-actions>
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
            </sonic-form-actions>
            <p class="m-0 text-sm text-neutral-9">${t("export.octatrackHint")}</p>
            <sonic-form-actions>
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
            </sonic-form-actions>
            <p class="m-0 text-sm text-neutral-9">${t("export.toLibraryHint")}</p>
            <strong>${t("export.soundcloud")}</strong>
            ${sc?.connected
              ? html`<sonic-badge type="success" size="sm"
                    >${sc.displayName ?? "OK"}</sonic-badge
                  >`
              : sc?.available
                ? nothing
                : html`<span class="font-mono text-[0.7rem] text-neutral-500"
                    >${t("export.soundcloudUnavailable")}</span
                  >`}
            <sonic-form-actions>
              ${sc?.connected
                ? html`<sonic-button
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
                  : html`<sonic-button
                      variant="outline"
                      type="neutral"
                      size="sm"
                      @click=${() => exportPublish.openSoundCloudAssist()}
                    >
                      ${t("export.soundcloudAssist")}
                    </sonic-button>`}
            </sonic-form-actions>
            ${sc?.connected
              ? html`
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
                  <sonic-form-actions>
                    <sonic-button
                      type="primary"
                      ?disabled=${!!busy}
                      @click=${() => void this.#scUpload()}
                    >
                      ${t("export.soundcloudUpload")}
                    </sonic-button>
                  </sonic-form-actions>
                `
              : nothing}
            <strong>${t("export.bandcamp")}</strong>
            <sonic-form-actions>
              <sonic-button
                variant="outline"
                type="neutral"
                ?disabled=${!!busy}
                @click=${() => void this.#bandcampAssist()}
              >
                ${t("export.bandcampAssist")}
              </sonic-button>
            </sonic-form-actions>
            <div class="flex flex-col gap-2 border-t border-neutral-3 pt-3">
              <strong>${t("export.reel")}</strong>
              <div class="flex flex-col gap-1.5">
                <span class="form-label">${t("export.reelScenes")}</span>
                <p class="form-description m-0">${t("export.reelScenesHint")}</p>
                <div class="flex flex-wrap gap-x-4 gap-y-2">
                  ${reelExport.sceneIds.map(
                    (id) => html`
                      <sonic-checkbox name="reelScenes" value=${id} size="sm">
                        ${t(`export.reelScene.${id}` as MessageKey)}
                      </sonic-checkbox>
                    `,
                  )}
                </div>
              </div>
              <div class="flex flex-wrap items-end gap-3">
                <sonic-input
                  name="reelBg"
                  type="color"
                  size="sm"
                  label=${t("export.reelBg")}
                  class="w-28"
                ></sonic-input>
                <sonic-input
                  name="reelAccent"
                  type="color"
                  size="sm"
                  label=${t("export.reelAccent")}
                  class="w-28"
                ></sonic-input>
              </div>
              <sonic-form-actions>
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
              </sonic-form-actions>
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
                ? html`<p class="m-0 text-sm text-neutral-9">
                      ${t("export.listenNeedLogin")}
                    </p>
                    <sonic-form-actions>
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
                    </sonic-form-actions>`
                : html`
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
                    <sonic-form-actions>
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
                    </sonic-form-actions>
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
    const mForm = GL_MODAL_PRESETS.form;
    const mGen = GL_MODAL_PRESETS.generate;
    const mPanel = GL_MODAL_PRESETS.panel;
    return html`
      <sonic-modal
        align=${mForm.align}
        paddingX=${mForm.paddingX}
        paddingY=${mForm.paddingY}
        maxWidth=${mForm.maxWidth}
        maxHeight=${mForm.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${bpmOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.bpmTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-4 text-sm text-content">
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
        align=${mForm.align}
        paddingX=${mForm.paddingX}
        paddingY=${mForm.paddingY}
        maxWidth=${mForm.maxWidth}
        maxHeight=${mForm.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${barsOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.barsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-4 text-sm text-content">
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
        align=${mGen.align}
        paddingX=${mGen.paddingX}
        paddingY=${mGen.paddingY}
        maxWidth=${mGen.maxWidth}
        maxHeight=${mGen.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${genOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.generateTitle")}</sonic-modal-title>
        <sonic-modal-content>
          ${this.#renderGenerateForm(bars, seqDurMs)}
        </sonic-modal-content>
        <sonic-modal-actions>
          <sonic-button hideModal variant="outline" type="neutral">
            ${t("dialog.cancel")}
          </sonic-button>
          <sonic-button
            variant="outline"
            type="neutral"
            @click=${() => this.#openSynthSongKit()}
          >
            ${t("seq.synthKit")}
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
        align=${mPanel.align}
        paddingX=${mPanel.paddingX}
        paddingY=${mPanel.paddingY}
        maxWidth=${mPanel.maxWidth}
        maxHeight=${mPanel.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${docsOpen}
        @hide=${this.onSeqModalHide}
      >
        <sonic-modal-title>${t("seq.docsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-4 text-sm text-content">
            <ul
              class="m-0 flex list-disc flex-col gap-1.5 pl-[1.1rem] text-[0.85rem] text-neutral-500"
            >
              <li>Outils de piste : rappel condensé à droite → une modale (volume + effets + filtres)</li>
              <li>Sons : tiroir vertical à droite (glisser sur une piste)</li>
              <li>Lecture en boucle</li>
              <li>Fond : pincer = zoom · ↕ zoom · ↔ pan</li>
              <li>Règle = région de boucle · BPM / durée dans le gutter droit</li>
              <li>Poignées = in-out / tête de lecture</li>
              <li>Poignée timeline = déplacer la boucle</li>
              <li>Clip = temps / piste · Alt = sans aimant</li>
              <li>Double-tap clip = éditeur (retour via Arrangement)</li>
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

  /** Open synth Song kit with BPM / tonic from the generate dialog. */
  #openSynthSongKit(): void {
    const tonicPc =
      typeof this.draftGenKey === "number"
        ? ((this.draftGenKey % 12) + 12) % 12
        : 0;
    stashSynthHandoff({
      mode: "song",
      bpm: this.project?.bpm ?? 120,
      tonicPc,
      scaleMode:
        this.draftGenScale === "minor" || this.draftGenScale === "major"
          ? this.draftGenScale
          : "major",
      intention: "full",
    });
    this.seqModal = null;
    navigate({ name: "synth" });
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
    this.draftGenSampleVariety = "auto";
    this.draftGenBpmSync = "auto";
    this.draftGenLockTempoPow2 = "off";
    this.draftGenForbidPitchStretch = "off";
    this.draftGenStretchUp = "auto";
    this.draftGenStretchDown = "auto";
    this.draftGenReverse = "auto";
    this.draftGenStutter = "auto";
    this.draftGenCallResponse = "auto";
    this.draftGenEnsembleRelation = "auto";
    this.draftGenLockPitch = "off";
    this.draftGenPitchUp = "auto";
    this.draftGenPitchDown = "auto";
    this.draftGenSampleFilter = "all";
    this.draftGenTagFilter = [];
    this.draftGenAdvanced = true;
    this.draftGenSeed = (Math.random() * 0xffffffff) >>> 0;
    this.#persistGenUi();
  }

  get #genTagOptions(): { value: string; label: string }[] {
    const counts = new Map<string, number>();
    for (const s of this.samples) {
      if (s.deletedAt) continue;
      for (const tag of s.tags ?? []) {
        if (!tag || tag.startsWith("processing:")) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: `${value} (${count})` }))
      .sort((a, b) => a.value.localeCompare(b.value, "fr"));
  }

  #genPoolSamples(): Sample[] {
    let list = this.samples.filter((s) => !s.deletedAt);
    const f = this.draftGenSampleFilter;
    if (f === "favorite") list = list.filter((s) => s.favorite);
    else if (f !== "all") list = list.filter((s) => s.class === f);
    if (this.draftGenTagFilter.length > 0) {
      list = list.filter((s) =>
        this.draftGenTagFilter.some((tag) => (s.tags ?? []).includes(tag)),
      );
    }
    return list;
  }

  #renderStyleTempoBarsHint(bars: number) {
    const style = this.draftGenMusicStyle;
    if (style === "auto") return nothing;
    const bpm = this.project?.bpm ?? 120;
    const fit = styleTempoBarsFit(style, bpm, bars);
    const mismatch = !fit.bpmOk || !fit.barsOk;
    return html`
      <div class="form-item-container flex flex-col gap-1">
        <p class="form-description m-0">
          ${tf("seq.genStyleTempoHint", {
            bpm: String(fit.bpmHint.ideal),
            bars: String(fit.barsHint.ideal),
            bpmMin: String(fit.bpmHint.min),
            bpmMax: String(fit.bpmHint.max),
            barsMin: String(fit.barsHint.min),
            barsMax: String(fit.barsHint.max),
          })}
        </p>
        <p
          class="form-description m-0 ${mismatch
            ? "text-warning"
            : "text-neutral-500"}"
        >
          ${mismatch
            ? t("seq.genStyleTempoMismatch")
            : t("seq.genStyleTempoOk")}
        </p>
        ${mismatch
          ? html`
              <sonic-form-actions>
                <sonic-button
                  size="sm"
                  variant="outline"
                  type="neutral"
                  @click=${() => void this.#applyStyleTempoBarsSuggestions()}
                >
                  ${t("seq.genStyleTempoApply")}
                </sonic-button>
              </sonic-form-actions>
            `
          : nothing}
      </div>
    `;
  }

  async #applyStyleTempoBarsSuggestions(): Promise<void> {
    const style = this.draftGenMusicStyle;
    if (style === "auto") return;
    const { bpm, bars } = styleSuggestedTempoBars(style);
    await this.#setBpm(bpm);
    await this.#setBars(bars);
    this.draftBpm = this.project?.bpm ?? bpm;
    this.draftBars = this.project?.bars ?? bars;
  }

  /** When style ≠ Auto and project is outside the hint window, snap to ideals. */
  async #applyStyleTempoBarsIfNeeded(opts?: {
    toast?: boolean;
  }): Promise<boolean> {
    const style = this.draftGenMusicStyle;
    if (style === "auto" || !this.project) return false;
    const fit = styleTempoBarsFit(
      style,
      this.project.bpm,
      this.project.bars,
    );
    if (fit.bpmOk && fit.barsOk) return false;
    const { bpm, bars } = styleSuggestedTempoBars(style);
    await this.#applyStyleTempoBarsSuggestions();
    if (opts?.toast) {
      SonicToast.add({
        id: "glane-gen-tempo",
        title: t("seq.generate"),
        text: tf("seq.genStyleTempoApplied", {
          bpm: String(bpm),
          bars: String(bars),
        }),
        status: "info",
        preserve: false,
      });
    }
    return true;
  }

  #renderGenerateForm(bars: number, seqDurMs: number) {
    return html`
      <gl-form-stack
        class="seq-gen-modal seq-modal-body text-sm text-content"
      >
        <div class="flex flex-col gap-1">
          <p class="m-0">${t("seq.generateBody")}</p>
          <p class="form-description m-0 font-mono">
            ${this.project?.bpm ?? 120} ${t("seq.bpm")} · ${bars}
            ${t("seq.barsUnit")} · ${formatClock(seqDurMs)}
          </p>
        </div>

        <gl-form-section
          label=${t("seq.genSectionSetup")}
          description=${t("seq.genSectionSetupHint")}
        >
          <sonic-form-layout>
            <div class="form-item-container flex flex-col gap-1">
              <span class="form-label">${t("seq.genSeed")}</span>
              <sonic-input
                class="min-w-0 flex-1"
                type="number"
                size="sm"
                min="0"
                .value=${String(this.draftGenSeed)}
                @change=${(e: Event) => {
                  this.draftGenSeed =
                    Number((e.target as HTMLInputElement).value) >>> 0;
                  this.#persistGenUi();
                }}
              ></sonic-input>
              <span class="form-description m-0">${t("seq.genSeedHint")}</span>
            </div>
            <sonic-form-actions>
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
              <sonic-button
                size="sm"
                variant="outline"
                type="neutral"
                @click=${() => this.#setAllGenAuto()}
              >
                ${t("seq.genRandomizeAll")}
              </sonic-button>
            </sonic-form-actions>
          </sonic-form-layout>
        </gl-form-section>

        <gl-form-section
          label=${t("seq.genSectionPool")}
          description=${t("seq.genSectionPoolHint")}
        >
          <sonic-form-layout>
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
            <div class="form-item-container flex flex-col gap-1">
              <span class="form-label">${t("seq.genTagFilter")}</span>
              <gl-pop-select
                class="w-full max-w-full"
                size="sm"
                multiple
                .values=${this.draftGenTagFilter}
                .options=${[
                  { value: "", label: t("seq.allTags") },
                  ...this.#genTagOptions,
                ]}
                placeholder=${t("seq.allTags")}
                searchPlaceholder=${t("seq.popSearch")}
                ?active=${this.draftGenTagFilter.length > 0}
                @gl-change=${(e: CustomEvent<{ values: string[] }>) => {
                  this.draftGenTagFilter = e.detail.values.filter(Boolean);
                  this.#persistGenUi();
                }}
              ></gl-pop-select>
            </div>
            <p class="form-description m-0 font-mono">
              ${tf("seq.genSampleFilterCount", {
                n: this.#genPoolSamples().length,
              })}
            </p>
          </sonic-form-layout>
        </gl-form-section>

        <gl-form-section
          label=${t("seq.genSectionFeel")}
          description=${t("seq.genSectionFeelHint")}
        >
          <sonic-form-layout>
            ${this.#renderGenSlider({
              label: t("seq.genSampleVariety"),
              value: this.draftGenSampleVariety,
              min: 0,
              max: 100,
              fallback: 45,
              format: (n) => `${Math.round(n)}%`,
              onChange: (v) => {
                this.draftGenSampleVariety = v === "auto" ? "auto" : v / 100;
              },
            })}
            <p class="form-description m-0">${t("seq.genSampleVarietyHint")}</p>
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
          </sonic-form-layout>
        </gl-form-section>

        <gl-form-section
          label=${t("seq.genSectionStyle")}
          description=${t("seq.genSectionStyleHint")}
        >
          <sonic-form-layout>
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
                if (v !== "auto") {
                  void this.#applyStyleTempoBarsIfNeeded({ toast: true });
                }
              },
            })}
            ${this.#renderStyleTempoBarsHint(bars)}
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
            ${this.#renderGenChoice({
              label: t("seq.genEnsembleRelation"),
              value: this.draftGenEnsembleRelation,
              options: [
                ["auto", t("seq.genEnsembleAuto")],
                ["lock", t("seq.genEnsembleLock")],
                ["respond", t("seq.genEnsembleRespond")],
                ["kinship", t("seq.genEnsembleKinship")],
              ],
              onPick: (v) => {
                this.draftGenEnsembleRelation = v as GenEnsembleRelation;
              },
            })}
            <p class="form-description m-0">
              ${t("seq.genEnsembleRelationHint")}
            </p>
          </sonic-form-layout>
        </gl-form-section>

        <sonic-form-actions>
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
            ${glIcon("sliders", { slot: "prefix", size: "xs" })}
            ${t("seq.genAdvanced")}
          </sonic-button>
        </sonic-form-actions>

        ${this.draftGenAdvanced
          ? html`
              <gl-form-section label=${t("seq.genSectionPitch")}>
                <sonic-form-layout>
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
                  <p class="form-description m-0">${t("seq.genLockPitchHint")}</p>
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
                              (n) =>
                                [String(n), String(n)] as [string, string],
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
                              (n) =>
                                [String(n), String(n)] as [string, string],
                            ),
                          ],
                          onPick: (v) => {
                            this.draftGenPitchUp =
                              v === "auto" ? "auto" : Number(v);
                          },
                        })}
                        <p class="form-description m-0">
                          ${t("seq.genPitchRangeHint")}
                        </p>
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
                </sonic-form-layout>
              </gl-form-section>

              <gl-form-section label=${t("seq.genSectionForm")}>
                <sonic-form-layout>
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
                </sonic-form-layout>
              </gl-form-section>

              <gl-form-section label=${t("seq.genSectionTiming")}>
                <sonic-form-layout>
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
                  <p class="form-description m-0">${t("seq.genBpmSyncHint")}</p>
                  ${this.#renderGenChoice({
                    label: t("seq.genLockTempoPow2"),
                    value:
                      this.draftGenLockTempoPow2 === "on" ? "on" : "off",
                    options: [
                      ["off", t("seq.genOff")],
                      ["on", t("seq.genOn")],
                    ],
                    onPick: (v) => {
                      this.draftGenLockTempoPow2 = v === "on" ? "on" : "off";
                    },
                  })}
                  <p class="form-description m-0">
                    ${t("seq.genLockTempoPow2Hint")}
                  </p>
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
                  <p class="form-description m-0">
                    ${t("seq.genForbidPitchStretchHint")}
                  </p>
                  ${this.#renderGenChoice({
                    label: t("seq.genStretchUp"),
                    value:
                      this.draftGenStretchUp === "auto"
                        ? "auto"
                        : String(this.draftGenStretchUp),
                    options: [
                      ["auto", t("seq.genAuto")],
                      ...GEN_STRETCH_UP_RATIOS.map(
                        (n) =>
                          [String(n), genStretchRatioLabel(n)] as [
                            string,
                            string,
                          ],
                      ),
                    ],
                    onPick: (v) => {
                      this.draftGenStretchUp =
                        v === "auto" ? "auto" : Number(v);
                    },
                  })}
                  ${this.#renderGenChoice({
                    label: t("seq.genStretchDown"),
                    value:
                      this.draftGenStretchDown === "auto"
                        ? "auto"
                        : String(this.draftGenStretchDown),
                    options: [
                      ["auto", t("seq.genAuto")],
                      ...GEN_STRETCH_DOWN_RATIOS.map(
                        (n) =>
                          [String(n), genStretchRatioLabel(n)] as [
                            string,
                            string,
                          ],
                      ),
                    ],
                    onPick: (v) => {
                      this.draftGenStretchDown =
                        v === "auto" ? "auto" : Number(v);
                    },
                  })}
                  <p class="form-description m-0">
                    ${t("seq.genStretchRatioHint")}
                  </p>
                </sonic-form-layout>
              </gl-form-section>

              <gl-form-section label=${t("seq.genSectionArticulate")}>
                <sonic-form-layout>
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
                  <p class="form-description m-0">
                    ${t("seq.genCallResponseHint")}
                  </p>
                </sonic-form-layout>
              </gl-form-section>
            `
          : nothing}
      </gl-form-stack>
    `;
  }

  #renderGenChoice(opts: {
    label: string;
    value: string;
    options: Array<[string, string]>;
    onPick: (value: string) => void;
  }) {
    const defaultValue = opts.options[0]?.[0] ?? "auto";
    return html`
      <div class="form-item-container flex flex-col gap-1">
        <span class="form-label">${opts.label}</span>
        <gl-pop-select
          class="w-full max-w-full"
          size="sm"
          .value=${opts.value}
          .options=${opts.options.map(([value, label]) => ({
            value,
            label,
          }))}
          ?active=${opts.value !== defaultValue}
          @gl-change=${(e: CustomEvent<{ value: string }>) => {
            opts.onPick(e.detail.value);
            this.#persistGenUi();
          }}
        ></gl-pop-select>
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
      opts.value === "auto" ? opts.fallback : Math.round(opts.value * 100);
    const display =
      opts.value === "auto" ? t("seq.genAuto") : opts.format(sliderValue);
    const isAuto = opts.value === "auto";
    return html`
      <div class="form-item-container flex flex-col gap-1">
        <span class="form-label flex items-center justify-between gap-2 mb-0">
          <span>${opts.label}</span>
          <label
            class="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-neutral-500"
          >
            <input
              type="checkbox"
              class="accent-primary"
              .checked=${isAuto}
              @change=${() => {
                opts.onChange(isAuto ? opts.fallback : "auto");
                this.#persistGenUi();
              }}
            />
            ${t("seq.genAuto")}
          </label>
        </span>
        <input
          type="range"
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
          ? html`<span class="form-description m-0 font-mono">${display}</span>`
          : nothing}
        ${opts.footer ?? nothing}
      </div>
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
    this.#syncMasterFx();
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
      reelBg: this.reelBg || reelExport.defaults.bgColor,
      reelAccent: this.reelAccent || reelExport.defaults.accentColor,
      reelScenes:
        this.reelScenes?.length > 0
          ? this.reelScenes
          : [...reelExport.defaults.scenes],
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
          tracks: this.tracks.map((tr) => this.#insertConfig(tr)),
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
        trackInserts: this.tracks.map((tr) => this.#insertConfig(tr)),
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
      const scenes = (
        Array.isArray(this.reelScenes)
          ? this.reelScenes
          : this.reelScenes
            ? [this.reelScenes as unknown as string]
            : []
      ).filter((s): s is ReelSceneId =>
        (reelExport.sceneIds as readonly string[]).includes(s),
      );
      const result = await reelExport.encode({
        buffer: bounce.buffer,
        title: this.exportTitle || this.project?.title || "Glane",
        bgColor: this.reelBg || reelExport.defaults.bgColor,
        accentColor: this.reelAccent || reelExport.defaults.accentColor,
        scenes,
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
    this.#playGen++;
    this.#auditionGen++;
    clearSampleAudition();
    if (this.playing && this.#engine && this.project) {
      this.playheadTick = samplesToTicks(
        this.#engine.playheadSample(),
        this.project.bpm,
        this.#engine.sampleRate,
      );
    }
    this.#engine?.stop();
    this.playing = false;
    this.loadingPlay = false;
    cancelAnimationFrame(this.#raf);
    if (resetTick != null) this.playheadTick = resetTick;
    this.#syncViewWindow();
    this.#paintTransportPlayhead(this.playheadTick);
  }

  #handleTransport = async (action: TransportAction): Promise<void> => {
    if (!this.#engine || !this.project) return;
    if (action === "pause") {
      this.#haltTransport();
      return;
    }
    const gen = ++this.#playGen;
    this.#auditionGen++;
    clearSampleAudition();
    // Flip chrome immediately — buildSchedule can take hundreds of ms.
    this.playing = true;
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
      this.#syncMasterFx();
      this.#syncTrackBuses();
      const scheduled = await this.#buildSchedule({
        windowTicks: { from: fromTick, to: fromTick + preload },
      });
      if (gen !== this.#playGen || !this.#engine || !this.project) {
        if (gen === this.#playGen) this.playing = false;
        return;
      }

      this.#engine.master.gain.value = dbToGain(this.project.masterGainDb);
      this.#engine.setClips(scheduled);

      const from = ticksToSamples(
        asTick(fromTick),
        this.project.bpm,
        this.#engine.sampleRate,
      );

      this.#engine.play(from);
      if (gen !== this.#playGen) {
        this.#engine.stop();
        return;
      }
      this.#setFollowPlayhead(true);
      this.playheadTick = fromTick;
      this.#syncFollowScroll();
      this.#paintTransportPlayhead(fromTick);
      this.#armScheduleHydration(fromTick);
      this.#lastTransportFrame = 0;
      const tick = (now: number) => {
        if (!this.#engine || !this.playing || !this.project) return;
        const minMs = this.#transportFrameMs;
        if (minMs === 0 || now - this.#lastTransportFrame >= minMs) {
          this.#lastTransportFrame = now;
          if (!this.#scrubbing) {
            this.#paintTransportPlayhead(this.#transportPlayheadTick());
          }
          this.#syncFollowScroll();
        }
        this.#raf = requestAnimationFrame(tick);
      };
      this.#raf = requestAnimationFrame(tick);
    } catch (err) {
      if (gen === this.#playGen) {
        this.playing = false;
        this.#engine?.stop();
      }
      throw err;
    } finally {
      if (gen === this.#playGen) this.loadingPlay = false;
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
    const projectId = this.project?.id ?? this.projectId;
    if (projectId) {
      stashEditorHandoff({ from: "project", projectId });
    }
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
      if (clip.id === this.selectedId) {
        this.#clipRotateDown(e, clip);
        return;
      }
      this.#clearRotateClipTool();
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
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.#clearRotateClipTool();
    this.selectedId = null;
    this.#scrollInertia.cancel();
    const lane = e.currentTarget as HTMLElement;
    this.#lanePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* already captured elsewhere */
    }

    if (this.#lanePtrs.size === 1) {
      this.#fsm.reset();
      this.#fsm.push({
        type: "down",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        target: "background",
      });
      this.#laneKind = null;
      this.#laneLastX = e.clientX;
      this.#laneLastY = e.clientY;
      this.#lanePinchDist = 0;
      if (!this.#laneListening) {
        this.#laneListening = true;
        window.addEventListener("pointermove", this.#onLanePointerMove);
        window.addEventListener("pointerup", this.#onLanePointerUp);
        window.addEventListener("pointercancel", this.#onLanePointerUp);
      }
      return;
    }

    if (this.#lanePtrs.size >= 2) {
      this.#laneKind = "pinch";
      this.#viewBusy = true;
      this.#fsm.reset();
      const pts = [...this.#lanePtrs.values()];
      this.#lanePinchDist = lanePointerDistance(pts[0]!, pts[1]!);
    }
  };

  #onLanePointerMove = (ev: PointerEvent): void => {
    if (!this.#lanePtrs.has(ev.pointerId)) return;
    this.#lanePtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.#laneKind === "pinch-done") return;

    if (this.#lanePtrs.size >= 2) {
      this.#laneKind = "pinch";
      this.#viewBusy = true;
      const pts = [...this.#lanePtrs.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist1 = lanePointerDistance(a, b);
      const mid = lanePointerMidpoint(a, b);
      const dist0 = this.#lanePinchDist > 0 ? this.#lanePinchDist : dist1;
      this.#lanePinchDist = dist1;
      this.#pinchZoomAtClientX(dist0, dist1, mid.x);
      this.#setFollowPlayhead(false);
      return;
    }

    if (this.#laneKind === "pinch") {
      this.#laneKind = "pinch-done";
      return;
    }

    if (this.#laneKind == null) {
      const st = this.#fsm.push({
        type: "move",
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        t: ev.timeStamp,
        target: "background",
        pointerCount: this.#lanePtrs.size,
      });
      if (st.status === "resolved") {
        if (st.kind === "scroll" || st.kind === "zoom") this.#laneKind = st.kind;
        else return;
      } else {
        return;
      }
    }

    const dx = ev.clientX - this.#laneLastX;
    const dy = ev.clientY - this.#laneLastY;
    this.#laneLastX = ev.clientX;
    this.#laneLastY = ev.clientY;
    if (this.#laneKind === "scroll") {
      this.#viewBusy = true;
      const timeline = this.#timelineEl();
      if (timeline) timeline.scrollLeft -= dx;
      this.#scrollInertia.push(ev.clientX, ev.timeStamp);
    } else if (this.#laneKind === "zoom") {
      this.#viewBusy = true;
      this.#zoomAtClientX(dy, ev.clientX);
    }
  };

  #onLanePointerUp = (ev: PointerEvent): void => {
    if (!this.#lanePtrs.has(ev.pointerId)) return;
    this.#lanePtrs.delete(ev.pointerId);

    if (this.#lanePtrs.size >= 2) {
      const pts = [...this.#lanePtrs.values()];
      this.#lanePinchDist = lanePointerDistance(pts[0]!, pts[1]!);
      return;
    }

    if (this.#lanePtrs.size === 1) {
      if (this.#laneKind === "pinch") this.#laneKind = "pinch-done";
      this.#lanePinchDist = 0;
      return;
    }

    window.removeEventListener("pointermove", this.#onLanePointerMove);
    window.removeEventListener("pointerup", this.#onLanePointerUp);
    window.removeEventListener("pointercancel", this.#onLanePointerUp);
    this.#laneListening = false;
    this.#viewBusy = false;
    const kind = this.#laneKind;
    this.#laneKind = null;
    this.#lanePinchDist = 0;

    if (kind === "scroll") {
      this.#setFollowPlayhead(false);
      const timeline = this.#timelineEl();
      if (timeline) this.#scrollInertia.release(timeline);
    }

    if (kind == null) {
      const st = this.#fsm.push({
        type: "up",
        pointerId: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        t: ev.timeStamp,
        target: "background",
      });
      if (
        st.status === "resolved" &&
        (st.kind === "tap" || st.kind === "longpress")
      ) {
        this.selStartTick = null;
        this.selEndTick = null;
        this.#syncTransportLoop();
        if (this.playing) void this.#resyncSchedule();
      }
    }
    this.#fsm.reset();
  };

  #tickAtClamped = (clientX: number): number =>
    Math.max(
      0,
      Math.min(this.#projectLengthTick(), this.#tickAtClientX(clientX)),
    );

  /** Pan the timeline when the pointer is near a horizontal edge (selection drag). */
  #applySelEdgeScroll(clientX: number): boolean {
    const timeline = this.#timelineEl();
    if (!timeline) return false;
    const dx = edgeScrollAtClientX(timeline, clientX, {
      rightInsetPx: TRACK_GUTTER_PX,
    });
    if (dx === 0) return false;
    this.#setFollowPlayhead(false);
    return true;
  }

  #pumpSelEdgeScroll = (): void => {
    this.#selEdgeScrollRaf = 0;
    if (!this.#selEdgeScrollApply) return;
    if (!this.#applySelEdgeScroll(this.#selEdgeScrollX)) return;
    this.#selEdgeScrollApply();
    this.#selEdgeScrollRaf = requestAnimationFrame(this.#pumpSelEdgeScroll);
  };

  #onSelDragMove(clientX: number, apply: (clientX: number) => void): void {
    this.#selEdgeScrollX = clientX;
    this.#selEdgeScrollApply = () => apply(this.#selEdgeScrollX);
    apply(clientX);
    if (this.#applySelEdgeScroll(clientX)) {
      apply(this.#selEdgeScrollX);
      if (!this.#selEdgeScrollRaf) {
        this.#selEdgeScrollRaf = requestAnimationFrame(this.#pumpSelEdgeScroll);
      }
    }
  }

  #stopSelEdgeScroll(): void {
    this.#selEdgeScrollApply = null;
    if (this.#selEdgeScrollRaf) {
      cancelAnimationFrame(this.#selEdgeScrollRaf);
      this.#selEdgeScrollRaf = 0;
    }
  }

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
    const apply = (clientX: number) => {
      this.selEndTick = this.#tickAtClamped(clientX);
      this.#syncTransportLoop();
    };
    const move = (ev: PointerEvent) => {
      if (!this.#selDragging) return;
      this.#onSelDragMove(ev.clientX, apply);
    };
    const up = (ev: PointerEvent) => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      lane.removeEventListener("pointercancel", up);
      this.#stopSelEdgeScroll();
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
    const apply = (clientX: number) => {
      const t = this.#tickAtClamped(clientX);
      if (edge === "start") {
        this.selStartTick = Math.min(t, b0 - MIN_CLIP_TICKS / 4);
        this.selEndTick = b0;
      } else {
        this.selStartTick = a0;
        this.selEndTick = Math.max(t, a0 + MIN_CLIP_TICKS / 4);
      }
      this.#syncTransportLoop();
    };
    const move = (ev: PointerEvent) => {
      this.#onSelDragMove(ev.clientX, apply);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.#stopSelEdgeScroll();
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
    const apply = (clientX: number) => {
      const delta = this.#tickAtClamped(clientX) - originTick;
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
    const move = (ev: PointerEvent) => {
      this.#onSelDragMove(ev.clientX, apply);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.#stopSelEdgeScroll();
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
    if (this.playing && this.#engine && this.project && !this.#scrubbing) {
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
    this.#paintTransportPlayhead(next);
  }

  #tapeVoicesAtTick(tick: number): TapeScrubVoice[] {
    if (!this.#engine || !this.project) return [];
    const sr = this.#engine.sampleRate;
    const bpm = this.project.bpm;
    const ph = ticksToSamples(asTick(tick), bpm, sr);
    const audible = audibleTrackIds(this.tracks);
    const out: TapeScrubVoice[] = [];
    for (const clip of this.clips) {
      if (!audible.has(clip.trackId) || !clip.sampleId) continue;
      const clipEnd = clip.startTick + clip.lengthTick;
      if (tick < clip.startTick || tick >= clipEnd) continue;
      const cacheKey = this.#bufferCacheKey(clip.sampleId, clip);
      const buf = this.#bufferCache.get(cacheKey);
      if (!buf) {
        void this.#loadBufferForSample(clip.sampleId, clip);
        continue;
      }
      const startS = ticksToSamples(asTick(clip.startTick), bpm, sr);
      const intoClip = Math.max(0, ph - startS);
      const contentOffset = msToSamples(clip.contentOffsetMs, sr);
      let bufferOffset = contentOffset + intoClip;
      if (clip.loopEnabled) {
        const ls = Math.max(0, Math.floor(contentOffset));
        const loopLenMs = clip.loopLengthMs;
        const le =
          loopLenMs != null && loopLenMs > 0
            ? Math.min(
                buf.length,
                ls + Math.max(1, msToSamples(loopLenMs, sr)),
              )
            : buf.length;
        const loopLen = Math.max(1, le - ls);
        bufferOffset = ls + ((bufferOffset - ls) % loopLen);
        if (bufferOffset < ls) bufferOffset += loopLen;
      } else if (bufferOffset >= buf.length) {
        continue;
      }
      out.push({
        key: clip.id,
        buffer: buf,
        sample: bufferOffset,
        gain: dbToGain(clip.gainDb),
        trackId: clip.trackId,
        pitchRate: Math.pow(2, (clip.pitchSemitones ?? 0) / 12),
      });
    }
    return out;
  }

  #driveTapeAtTick(tick: number): void {
    if (!this.#engine || !this.project) return;
    this.#engine.tapeScrub(this.#tapeVoicesAtTick(tick));
  }

  #beginTapeScrub(_tick: number): void {
    this.#scrubbing = true;
    this.#setFollowPlayhead(true);
    if (this.playing) {
      this.#resumeAfterTape = true;
      this.#haltTransport();
    } else {
      this.#resumeAfterTape = false;
    }
    cancelAnimationFrame(this.#tapeRaf);
    const tick = () => {
      if (!this.#scrubbing) return;
      this.#driveTapeAtTick(this.playheadTick);
      this.#tapeRaf = requestAnimationFrame(tick);
    };
    this.#tapeRaf = requestAnimationFrame(tick);
  }

  async #endTapeScrub(): Promise<void> {
    this.#scrubbing = false;
    cancelAnimationFrame(this.#tapeRaf);
    this.#tapeRaf = 0;
    this.#engine?.endTapeScrub();
    if (this.#resumeAfterTape) {
      this.#resumeAfterTape = false;
      await this.#handleTransport("play");
    }
  }

  #playheadDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    this.#beginTapeScrub(this.playheadTick);
    // Delta scrub keeps the playhead centered like play-mode follow.
    let lastX = e.clientX;
    this.#syncFollowScroll(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      this.#seekPlayheadTick(this.playheadTick + dx / this.pxPerTick);
    };
    const up = () => {
      void this.#endTapeScrub();
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
    this.#beginTapeScrub(this.playheadTick);
  };

  #onSeekBar = (e: CustomEvent<{ value: number }>): void => {
    this.#seekPlayheadTick(e.detail.value);
  };

  #onSeekBarEnd = (): void => {
    void this.#endTapeScrub();
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
          <sonic-menu-item @click=${() => this.#armRotateFromCtx()}>
            ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
            ${t("seq.rotate")}
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
    const sample = clip?.sampleId
      ? this.samples.find((s) => s.id === clip.sampleId)
      : undefined;
    const offsetMax = Math.max(1, sample?.durationMs ?? 1);
    const offsetMs = clip
      ? Math.round(
          ((clip.contentOffsetMs % offsetMax) + offsetMax) % offsetMax,
        )
      : 0;
    const m = GL_MODAL_PRESETS.form;
    return html`
      <sonic-modal
        align=${m.align}
        paddingX=${m.paddingX}
        paddingY=${m.paddingY}
        maxWidth=${m.maxWidth}
        maxHeight=${m.maxHeight}
        .styleSheet=${GL_MODAL_SCROLL_LAYOUT}
        .visible=${open}
        @hide=${this.onClipOptsHide}
      >
        <sonic-modal-title>${t("seq.clipOptionsTitle")}</sonic-modal-title>
        <sonic-modal-content>
          <div class="seq-modal-body flex flex-col gap-4 text-sm text-content">
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
                  <div class="flex flex-col gap-1.5 text-xs text-neutral-500">
                    <span>${t("seq.stretch")}</span>
                    <gl-pop-select
                      class="w-full max-w-full"
                      size="sm"
                      .value=${clip.stretchMode}
                      .options=${STRETCH_ORDER.map((m) => ({
                        value: m,
                        label: STRETCH_LABEL[m],
                      }))}
                      ?active=${clip.stretchMode !== "off"}
                      @gl-change=${(e: CustomEvent<{ value: string }>) => {
                        void this.#setStretch(
                          clip.id,
                          e.detail.value as StretchMode,
                        );
                      }}
                    ></gl-pop-select>
                  </div>
                `
              : nothing}
          </div>
        </sonic-modal-content>
        <sonic-modal-actions>
          ${clip
            ? html`<sonic-button
                variant="outline"
                type="primary"
                size="sm"
                @click=${() => this.#armRotateFromOpts()}
              >
                ${glIcon("refresh-cw", { slot: "prefix", size: "xs" })}
                ${t("seq.rotate")}
              </sonic-button>`
            : nothing}
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

  #clearRotateClipTool(): void {
    if (this.rotateClipTool) this.rotateClipTool = false;
  }

  #armRotateClip(clipId: string): void {
    this.selectedId = clipId;
    this.rotateClipTool = true;
  }

  #armRotateFromCtx(): void {
    const ctx = this.clipCtx;
    if (!ctx) return;
    this.clipCtx = null;
    this.#armRotateClip(ctx.clipId);
  }

  #armRotateFromOpts(): void {
    const id = this.clipOptsId;
    if (!id) return;
    this.clipOptsId = null;
    this.#armRotateClip(id);
  }

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
      return Math.max(
        1,
        Math.round(
          (frameCount(entry.pcm, entry.channelCount ?? 1) / entry.sampleRate) *
            1000,
        ),
      );
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
      this.#clearRotateClipTool();
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

  async #setStretch(clipId: string, stretchMode: StretchMode): Promise<void> {
    const clip = this.clips.find((c) => c.id === clipId);
    if (!clip || clip.stretchMode === stretchMode) return;
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

    await this.#applyStyleTempoBarsIfNeeded({ toast: true });

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
      sampleVariety: this.draftGenSampleVariety,
      bpmSync: this.draftGenBpmSync,
      reverse: this.draftGenReverse,
      stutter: this.draftGenStutter,
      callResponse: this.draftGenCallResponse,
      ensembleRelation: this.draftGenEnsembleRelation,
      lockPitch: this.draftGenLockPitch,
      pitchUpSemitones: this.draftGenPitchUp,
      pitchDownSemitones: this.draftGenPitchDown,
      lockTempoPow2: this.draftGenLockTempoPow2,
      forbidPitchStretch: this.draftGenForbidPitchStretch,
      stretchUpRatio: this.draftGenStretchUp,
      stretchDownRatio: this.draftGenStretchDown,
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
          pitchHz: resolveSamplePitchHz(a),
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
    this.#toastEnsembleSummary(planned.ensemble);
  }

  #toastEnsembleSummary(
    ensemble:
      | {
          relations: VoiceRelation[];
          primaryLeadTrack: number | null;
        }
      | undefined,
  ): void {
    if (!ensemble?.relations.length) return;
    const parts = ensemble.relations
      .map((r, i) => {
        if (i === ensemble.primaryLeadTrack) {
          return t("seq.genEnsembleRel.independent");
        }
        if (r === "independent") return null;
        const key =
          r === "lock"
            ? "seq.genEnsembleRel.lock"
            : r === "respond"
              ? "seq.genEnsembleRel.respond"
              : r === "kinship"
                ? "seq.genEnsembleRel.kinship"
                : null;
        return key ? t(key) : null;
      })
      .filter((x): x is string => x != null);
    if (parts.length === 0) return;
    const unique = [...new Set(parts)];
    SonicToast.add({
      id: "glane-gen-ensemble",
      title: t("seq.generate"),
      text: tf("seq.genEnsembleDone", { summary: unique.join(" · ") }),
      status: "success",
      preserve: false,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-sequencer-page": GlSequencerPage;
  }
}
