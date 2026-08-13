import { STORAGE_PREFIX, type SampleClass } from "@glane/core-model";
import { MUSIC_STYLE_IDS } from "./generative-styles.js";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK } from "./timeline/timeline.js";

const SAMPLE_FILTERS = new Set<string>([
  "all",
  "favorite",
  "percussive",
  "tonal",
  "texture",
  "noise",
  "rhythmic",
  "voice",
  "unclassified",
]);

const GROOVES = new Set(["auto", "straight", "shuffle", "half-time"]);
const SCALES = new Set(["auto", "major", "minor"]);
const PALETTES = new Set([
  "auto",
  "pop",
  "modal",
  "jazz",
  "ambient",
  "mixed",
]);
const FORMS = new Set(["auto", "song", "ambient"]);
const TRI = new Set(["auto", "on", "off"]);
const STYLE_SET = new Set<string>(["auto", ...MUSIC_STYLE_IDS]);

/** Generator dialog drafts — restored with the arrangement chrome. */
export type SeqGenUiState = {
  seed: number;
  density: number | "auto";
  energy: number | "auto";
  drumsVsTexture: number | "auto";
  musicStyle: string;
  groove: string;
  keyRootPc: number | "auto";
  scaleMode: string;
  palette: string;
  formStyle: string;
  humanize: number | "auto";
  variation: number | "auto";
  bpmSync: string;
  lockTempoPow2: string;
  forbidPitchStretch: string;
  reverse: string;
  stutter: string;
  callResponse: string;
  lockPitch: string;
  pitchUpSemitones: number | "auto";
  pitchDownSemitones: number | "auto";
  sampleFilter: SampleClass | "all" | "favorite";
  advanced: boolean;
};

/** Ephemeral sequencer chrome — one snapshot per arrangement (project). */
export type SeqUiState = {
  pxPerTick: number;
  playheadTick: number;
  selStartTick: number | null;
  selEndTick: number | null;
  selectedId: string | null;
  scrollLeft: number;
  viewMode: "global" | "vue";
  drawerOpen: boolean;
  drawerFilter: SampleClass | "all" | "favorite";
  magnetOff: boolean;
  followPlayhead: boolean;
  gen?: SeqGenUiState;
};

export const DEFAULT_SEQ_GEN_UI: SeqGenUiState = {
  seed: 1,
  density: 1,
  energy: 0.55,
  drumsVsTexture: 0.55,
  musicStyle: "auto",
  groove: "auto",
  keyRootPc: "auto",
  scaleMode: "auto",
  palette: "auto",
  formStyle: "auto",
  humanize: "auto",
  variation: "auto",
  bpmSync: "auto",
  lockTempoPow2: "off",
  forbidPitchStretch: "off",
  reverse: "auto",
  stutter: "auto",
  callResponse: "auto",
  lockPitch: "off",
  pitchUpSemitones: "auto",
  pitchDownSemitones: "auto",
  sampleFilter: "all",
  advanced: false,
};

const KEY_PREFIX = `${STORAGE_PREFIX}.seqUi.`;

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

function finiteOr(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function nullableTick(n: unknown): number | null {
  if (n == null) return null;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : null;
}

function autoOrNumber(
  v: unknown,
  lo: number,
  hi: number,
  fallback: number | "auto",
): number | "auto" {
  if (v === "auto") return "auto";
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(hi, Math.max(lo, v));
  }
  return fallback;
}

function oneOf(v: unknown, allowed: Set<string>, fallback: string): string {
  return typeof v === "string" && allowed.has(v) ? v : fallback;
}

function parseGen(raw: unknown): SeqGenUiState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<SeqGenUiState>;
  const filter = o.sampleFilter;
  const sampleFilter: SeqGenUiState["sampleFilter"] =
    typeof filter === "string" && SAMPLE_FILTERS.has(filter)
      ? (filter as SeqGenUiState["sampleFilter"])
      : DEFAULT_SEQ_GEN_UI.sampleFilter;
  const key =
    o.keyRootPc === "auto"
      ? "auto"
      : typeof o.keyRootPc === "number" && Number.isFinite(o.keyRootPc)
        ? ((Math.round(o.keyRootPc) % 12) + 12) % 12
        : DEFAULT_SEQ_GEN_UI.keyRootPc;
  return {
    seed: Math.max(0, finiteOr(o.seed, DEFAULT_SEQ_GEN_UI.seed)) >>> 0,
    density: autoOrNumber(o.density, 0.35, 1.5, DEFAULT_SEQ_GEN_UI.density),
    energy: autoOrNumber(o.energy, 0, 1, DEFAULT_SEQ_GEN_UI.energy),
    drumsVsTexture: autoOrNumber(
      o.drumsVsTexture,
      0,
      1,
      DEFAULT_SEQ_GEN_UI.drumsVsTexture,
    ),
    musicStyle: oneOf(o.musicStyle, STYLE_SET, DEFAULT_SEQ_GEN_UI.musicStyle),
    groove: oneOf(o.groove, GROOVES, DEFAULT_SEQ_GEN_UI.groove),
    keyRootPc: key,
    scaleMode: oneOf(o.scaleMode, SCALES, DEFAULT_SEQ_GEN_UI.scaleMode),
    palette: oneOf(o.palette, PALETTES, DEFAULT_SEQ_GEN_UI.palette),
    formStyle: oneOf(o.formStyle, FORMS, DEFAULT_SEQ_GEN_UI.formStyle),
    humanize: autoOrNumber(o.humanize, 0, 1, DEFAULT_SEQ_GEN_UI.humanize),
    variation: autoOrNumber(o.variation, 0, 1, DEFAULT_SEQ_GEN_UI.variation),
    bpmSync: oneOf(o.bpmSync, TRI, DEFAULT_SEQ_GEN_UI.bpmSync),
    lockTempoPow2: oneOf(
      o.lockTempoPow2,
      new Set(["on", "off"]),
      DEFAULT_SEQ_GEN_UI.lockTempoPow2,
    ),
    forbidPitchStretch: oneOf(
      o.forbidPitchStretch,
      new Set(["on", "off"]),
      DEFAULT_SEQ_GEN_UI.forbidPitchStretch,
    ),
    reverse: oneOf(o.reverse, TRI, DEFAULT_SEQ_GEN_UI.reverse),
    stutter: oneOf(o.stutter, TRI, DEFAULT_SEQ_GEN_UI.stutter),
    callResponse: oneOf(o.callResponse, TRI, DEFAULT_SEQ_GEN_UI.callResponse),
    lockPitch: oneOf(
      o.lockPitch,
      new Set(["on", "off"]),
      DEFAULT_SEQ_GEN_UI.lockPitch,
    ),
    pitchUpSemitones: autoOrNumber(
      o.pitchUpSemitones,
      0,
      24,
      DEFAULT_SEQ_GEN_UI.pitchUpSemitones,
    ),
    pitchDownSemitones: autoOrNumber(
      o.pitchDownSemitones,
      0,
      24,
      DEFAULT_SEQ_GEN_UI.pitchDownSemitones,
    ),
    sampleFilter,
    advanced: !!o.advanced,
  };
}

function parse(raw: string): SeqUiState | null {
  try {
    const o = JSON.parse(raw) as Partial<SeqUiState>;
    if (!o || typeof o !== "object") return null;
    const viewMode = o.viewMode === "vue" ? "vue" : "global";
    const filter = o.drawerFilter;
    const drawerFilter: SeqUiState["drawerFilter"] =
      filter === "all" ||
      filter === "favorite" ||
      filter === "percussive" ||
      filter === "tonal" ||
      filter === "texture" ||
      filter === "noise" ||
      filter === "rhythmic" ||
      filter === "voice" ||
      filter === "unclassified"
        ? filter
        : "all";
    return {
      pxPerTick: Math.min(
        MAX_PX_PER_TICK,
        Math.max(MIN_PX_PER_TICK, finiteOr(o.pxPerTick, 0.05)),
      ),
      playheadTick: Math.max(0, finiteOr(o.playheadTick, 0)),
      selStartTick: nullableTick(o.selStartTick),
      selEndTick: nullableTick(o.selEndTick),
      selectedId: typeof o.selectedId === "string" ? o.selectedId : null,
      scrollLeft: Math.max(0, finiteOr(o.scrollLeft, 0)),
      viewMode,
      drawerOpen: o.drawerOpen !== false,
      drawerFilter,
      magnetOff: !!o.magnetOff,
      followPlayhead: o.followPlayhead !== false,
      gen: parseGen(o.gen),
    };
  } catch {
    return null;
  }
}

export const seqUiState = {
  load(projectId: string): SeqUiState | null {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (!raw) return null;
      return parse(raw);
    } catch {
      return null;
    }
  },

  save(projectId: string, state: SeqUiState): void {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(state));
    } catch {
      /* quota / private mode */
    }
  },

  clear(projectId: string): void {
    try {
      localStorage.removeItem(storageKey(projectId));
    } catch {
      /* ignore */
    }
  },
} as const;
