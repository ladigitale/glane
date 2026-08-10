import { STORAGE_PREFIX, type SampleClass } from "@glane/core-model";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK } from "./timeline/timeline.js";

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
