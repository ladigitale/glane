import { STORAGE_PREFIX } from "@glane/core-model";
import {
  audioSynth,
  type AdditiveKey,
  type CoherenceKind,
  type FmKey,
  type GranularKey,
  type MachineParams,
  type NoiseKey,
  type ParamRange,
  type PhysicalKey,
  type ScaleMode,
  type SongIntention,
  type SubtractiveKey,
  type SynthEngineId,
  type SynthMode,
  type SynthRoleCard,
  type SynthRoleId,
  type VoiceKey,
} from "@glane/audio-synth";

/** Editable synth page snapshot (no drafts / playback). */
export type SynthUiSnapshot = {
  mode: SynthMode;
  globalQty: number;
  cards: SynthRoleCard[];
  openCardId: string;
  addRole: SynthRoleId;
  intention: SongIntention;
  coherence: CoherenceKind;
  tonicPc: number;
  scaleMode: ScaleMode;
  bpm: number;
  freeFmRatios: boolean;
};

/** Per-project synth prefs (blank kit). */
export type SynthUiState = {
  blank?: SynthUiSnapshot;
};

const KEY_PREFIX = `${STORAGE_PREFIX}.synthUi.`;

const MODES = new Set<string>(["variations", "family", "song"]);
const ROLES = new Set<string>([
  "pivot",
  ...audioSynth.familyRoles,
]);
const ENGINE_SET = new Set<string>(audioSynth.engines);
const LIVE = new Set<string>(audioSynth.liveEngines);
const INTENTIONS = new Set<string>(audioSynth.songIntentions);
const COHERENCE = new Set<string>(["parametric", "musical"]);
const SCALES = new Set<string>(["major", "minor"]);

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(v: unknown, allowed: Set<string>, fallback: T): T {
  return typeof v === "string" && allowed.has(v) ? (v as T) : fallback;
}

function parseRange(raw: unknown, fallback: ParamRange): ParamRange {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = o.mode === "mul" ? "mul" : "add";
  let min = clamp01(o.min, fallback.min);
  let max = clamp01(o.max, fallback.max);
  if (max < min) [min, max] = [max, min];
  return { min, max, mode };
}

function parseNormRecord<K extends string>(
  raw: unknown,
  keys: readonly K[],
  defaults: Record<K, number>,
): Record<K, number> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...defaults };
  for (const k of keys) {
    out[k] = clamp01(o[k], defaults[k]);
  }
  return out;
}

function parseRangesRecord<K extends string>(
  raw: unknown,
  keys: readonly K[],
  defaults: Record<K, ParamRange>,
): Record<K, ParamRange> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...defaults };
  for (const k of keys) {
    out[k] = parseRange(o[k], defaults[k]);
  }
  return out;
}

function parseMachine(raw: unknown): MachineParams {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: MachineParams = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k as keyof MachineParams] = clamp01(v, 0.5);
    }
  }
  return out;
}

function parseEngines(raw: unknown, fallback: SynthEngineId[]): SynthEngineId[] {
  const list = Array.isArray(raw) ? raw : fallback;
  const next = list.filter(
    (e): e is SynthEngineId =>
      typeof e === "string" && ENGINE_SET.has(e) && LIVE.has(e),
  );
  return next.length > 0 ? next : fallback.filter((e) => LIVE.has(e));
}

function parseCard(raw: unknown): SynthRoleCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const role = oneOf(o.role, ROLES, "pivot" as SynthRoleId);
  const base = audioSynth.roles.createRoleCard(role, {
    quantity: clampInt(o.quantity, 1, 40, 4),
  });
  const engines = parseEngines(o.engines, base.engines);
  if (engines.length === 0) return null;

  const pivot = parseNormRecord(
    o.pivot,
    audioSynth.keys as readonly SubtractiveKey[],
    base.pivot,
  );
  const pivotFm = parseNormRecord(
    o.pivotFm,
    audioSynth.keysFm as readonly FmKey[],
    base.pivotFm,
  );
  const pivotNoise = parseNormRecord(
    o.pivotNoise,
    audioSynth.keysNoise as readonly NoiseKey[],
    base.pivotNoise,
  );
  const pivotGranular = parseNormRecord(
    o.pivotGranular,
    audioSynth.keysGranular as readonly GranularKey[],
    base.pivotGranular,
  );
  const pivotAdditive = parseNormRecord(
    o.pivotAdditive,
    audioSynth.keysAdditive as readonly AdditiveKey[],
    base.pivotAdditive,
  );
  const pivotPhysical = parseNormRecord(
    o.pivotPhysical,
    audioSynth.keysPhysical as readonly PhysicalKey[],
    base.pivotPhysical,
  );
  const pivotVoice = parseNormRecord(
    o.pivotVoice,
    audioSynth.keysVoice as readonly VoiceKey[],
    base.pivotVoice,
  );

  return {
    ...base,
    id: typeof o.id === "string" && o.id ? o.id : base.id,
    role,
    engines,
    quantity: clampInt(o.quantity, 1, 40, base.quantity),
    randomness: clamp01(o.randomness, base.randomness),
    usePivot: o.usePivot !== false,
    machine: parseMachine(o.machine),
    engineUi: !!o.engineUi,
    pivot,
    pivotFm,
    pivotNoise,
    pivotGranular,
    pivotAdditive,
    pivotPhysical,
    pivotVoice,
    ranges: parseRangesRecord(
      o.ranges,
      audioSynth.keys as readonly SubtractiveKey[],
      base.ranges,
    ),
    rangesFm: parseRangesRecord(
      o.rangesFm,
      audioSynth.keysFm as readonly FmKey[],
      base.rangesFm,
    ),
    rangesNoise: parseRangesRecord(
      o.rangesNoise,
      audioSynth.keysNoise as readonly NoiseKey[],
      base.rangesNoise,
    ),
    rangesGranular: parseRangesRecord(
      o.rangesGranular,
      audioSynth.keysGranular as readonly GranularKey[],
      base.rangesGranular,
    ),
    rangesAdditive: parseRangesRecord(
      o.rangesAdditive,
      audioSynth.keysAdditive as readonly AdditiveKey[],
      base.rangesAdditive,
    ),
    rangesPhysical: parseRangesRecord(
      o.rangesPhysical,
      audioSynth.keysPhysical as readonly PhysicalKey[],
      base.rangesPhysical,
    ),
    rangesVoice: parseRangesRecord(
      o.rangesVoice,
      audioSynth.keysVoice as readonly VoiceKey[],
      base.rangesVoice,
    ),
  };
}

function parseSnapshot(raw: unknown): SynthUiSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cardsRaw = Array.isArray(o.cards) ? o.cards : [];
  const cards = cardsRaw
    .map(parseCard)
    .filter((c): c is SynthRoleCard => c != null);
  if (cards.length === 0) return null;

  const mode = oneOf(o.mode, MODES, "variations" as SynthMode);
  const addRole = oneOf(
    o.addRole,
    new Set(audioSynth.familyRoles),
    "bass" as SynthRoleId,
  );
  const openCardId =
    typeof o.openCardId === "string" && cards.some((c) => c.id === o.openCardId)
      ? o.openCardId
      : (cards[0]?.id ?? "");

  return {
    mode,
    globalQty: clampInt(o.globalQty, 1, 40, cards[0]?.quantity ?? 6),
    cards,
    openCardId,
    addRole,
    intention: oneOf(o.intention, INTENTIONS, "full" as SongIntention),
    coherence: oneOf(o.coherence, COHERENCE, "musical" as CoherenceKind),
    tonicPc: clampInt(o.tonicPc, 0, 11, 0),
    scaleMode: oneOf(o.scaleMode, SCALES, "major" as ScaleMode),
    bpm: clampInt(o.bpm, 60, 180, 120),
    freeFmRatios: !!o.freeFmRatios,
  };
}

function parse(raw: string): SynthUiState | null {
  try {
    const o = JSON.parse(raw) as Partial<SynthUiState> & Partial<SynthUiSnapshot>;
    if (!o || typeof o !== "object") return null;

    // Legacy flat snapshot (pre blank split).
    if (Array.isArray(o.cards) && !o.blank) {
      const snap = parseSnapshot(o);
      return snap ? { blank: snap } : null;
    }

    const blank = o.blank ? parseSnapshot(o.blank) : undefined;
    if (!blank) return null;
    return { blank };
  } catch {
    return null;
  }
}

export const synthUiState = {
  load(projectId: string): SynthUiState | null {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (!raw) return null;
      return parse(raw);
    } catch {
      return null;
    }
  },

  save(projectId: string, state: SynthUiState): void {
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
