import { z } from "zod";

export const SampleClassSchema = z.enum([
  "percussive",
  "tonal",
  "texture",
  "noise",
  "rhythmic",
  "voice",
  "unclassified",
]);
export type SampleClass = z.infer<typeof SampleClassSchema>;

/** Generator / arrangement role (manual override or inferred). */
export const ExprRoleSchema = z.enum([
  "kick",
  "snare",
  "hat",
  "perc",
  "bass",
  "chord",
  "lead",
  "texture",
  "loop",
  "fx",
]);
export type ExprRole = z.infer<typeof ExprRoleSchema>;

/** Tag prefix for manual role override without dedicated UI: `role:kick`. */
export const EXPR_ROLE_TAG_PREFIX = "role:";

export function parseExprRoleTag(tags: readonly string[] | undefined): ExprRole | null {
  if (!tags?.length) return null;
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t.startsWith(EXPR_ROLE_TAG_PREFIX)) continue;
    const role = t.slice(EXPR_ROLE_TAG_PREFIX.length);
    const parsed = ExprRoleSchema.safeParse(role);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export const SessionStatusSchema = z.enum([
  "recording",
  "processing",
  "ready",
  "failed",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const GapMarkerSchema = z.object({
  atMs: z.number().int().nonnegative(),
  reason: z.enum(["audio_context_suspended", "device_change", "unknown"]),
  durationMs: z.number().int().nonnegative().optional(),
});
export type GapMarker = z.infer<typeof GapMarkerSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  /** Workspace that owns this hunt (library scope). */
  projectId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative(),
  deviceInfo: z.string().optional(),
  sampleRate: z.number().int().positive(),
  channelCount: z.number().int().positive(),
  geoTag: z
    .object({ lat: z.number(), lon: z.number() })
    .nullable()
    .optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  status: SessionStatusSchema,
  dominantBpm: z.number().positive().nullable().optional(),
  dominantKey: z.string().nullable().optional(),
  noiseFloorDbfs: z.number().optional(),
  gapMarkers: z.array(GapMarkerSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

export const ClassScoresSchema = z.record(z.string(), z.number());
export type ClassScores = Partial<Record<SampleClass, number>> &
  Record<string, number>;

export const SampleSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  /** Workspace that owns this sample (denormalized from session). */
  projectId: z.string().uuid(),
  /** Capture hunt display name (denormalized for library filter). */
  captureName: z.string().optional(),
  sourceOffsetMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  class: SampleClassSchema,
  subclass: z.string().optional(),
  /** Characterization tags from live detection (not an event journal). */
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  classScores: ClassScoresSchema.optional(),
  name: z.string(),
  userName: z.string().optional(),
  favorite: z.boolean().default(false),
  /** Manual generator role; wins over tags `role:*` and inference. */
  forceRole: ExprRoleSchema.optional(),
  rating: z.number().int().min(1).max(5).optional(),
  color: z.string().optional(),
  loopStartMs: z.number().nonnegative().optional(),
  loopEndMs: z.number().nonnegative().optional(),
  loopXfadeMs: z.number().nonnegative().optional(),
  loopScore: z.number().min(0).max(1).optional(),
  /** True when seamless loop processing was auto-applied. */
  loopProposed: z.boolean().optional(),
  /** 0–1 keep-worthiness after polish (auto-cull when library is dense). */
  interestScore: z.number().min(0).max(1).optional(),
  originVersion: z.string(),
  parentSampleId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Sample = z.infer<typeof SampleSchema>;

export const SampleAnalysisSchema = z.object({
  sampleId: z.string().uuid(),
  lufs: z.number().optional(),
  peakDbtp: z.number().optional(),
  centroidHz: z.number().optional(),
  bpm: z.number().optional(),
  pitchHz: z.number().optional(),
  noteName: z.string().optional(),
  harmonicity: z.number().optional(),
  loopScore: z.number().min(0).max(1).optional(),
  transientDensity: z.number().optional(),
  features: z.record(z.unknown()).optional(),
});
export type SampleAnalysis = z.infer<typeof SampleAnalysisSchema>;

export const StretchModeSchema = z.enum([
  "off",
  "copy",
  "preserve-pitch",
  "resample",
]);
export type StretchMode = z.infer<typeof StretchModeSchema>;

export const FadeCurveSchema = z.enum([
  "linear",
  "equal-power",
  "exponential",
  "s-curve",
]);
export type FadeCurve = z.infer<typeof FadeCurveSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  bpm: z.number().positive(),
  timeSignature: z.tuple([z.number().int(), z.number().int()]),
  bars: z.number().int().positive(),
  masterGainDb: z.number(),
  /** Global preamp (dB) multiplied with each track's local gain, before FX. */
  preampGainDb: z.number().optional(),
  snapConfig: z.string().optional(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Fill missing mix fields (legacy IDB rows without `preampGainDb`). */
export function normalizeProject(raw: Project): Project {
  return {
    ...raw,
    masterGainDb: Number.isFinite(raw.masterGainDb) ? raw.masterGainDb : 0,
    preampGainDb: Number.isFinite(raw.preampGainDb) ? raw.preampGainDb : 0,
  };
}

/**
 * One light wet insert per track (ADR-0016), plus optional HP/LP and ADSR.
 * Wet: None / EQ / Echo / Reverb / Chorus / Tremolo / Vibrato.
 */
export const TrackFxTypeSchema = z.enum([
  "none",
  "eq",
  "echo",
  "reverb",
  "chorus",
  "tremolo",
  "vibrato",
]);
export type TrackFxType = z.infer<typeof TrackFxTypeSchema>;

/** Echo delay as beat fractions (¼ note = 1). Clamped at apply time by BPM. */
export const ECHO_DELAY_BEATS_MIN = 0.125;
export const ECHO_DELAY_BEATS_MAX = 4;
/** Web Audio DelayNode max for tempo-synced echo. */
export const ECHO_DELAY_MAX_SEC = 4;

/** High-pass (Hz). Floor = bypass. */
export const TRACK_HP_HZ_MIN = 20;
export const TRACK_HP_HZ_MAX = 2_000;
export const TRACK_HP_HZ_OPEN = TRACK_HP_HZ_MIN;
/** Default cutoff when the high-pass filter is switched on. */
export const TRACK_HP_HZ_ON = 120;
/** Low-pass (Hz). Ceiling = bypass. */
export const TRACK_LP_HZ_MIN = 200;
export const TRACK_LP_HZ_MAX = 20_000;
export const TRACK_LP_HZ_OPEN = TRACK_LP_HZ_MAX;
/** Default cutoff when the low-pass filter is switched on. */
export const TRACK_LP_HZ_ON = 8_000;
/** Track one-shot ADSR (ms / sustain 0–1) — raises clip fades via Math.max. */
export const TRACK_ATTACK_MS_MAX = 500;
export const TRACK_DECAY_MS_MAX = 2_000;
export const TRACK_RELEASE_MS_MAX = 2_000;

export type TrackAdsr = {
  attackMs: number;
  decayMs: number;
  sustain: number;
  releaseMs: number;
};

export const DEFAULT_TRACK_ADSR: TrackAdsr = {
  attackMs: 0,
  decayMs: 0,
  sustain: 1,
  releaseMs: 0,
};

/** Modest one-shot shape used when the ADSR filter is switched on. */
export const TRACK_ADSR_ON: TrackAdsr = {
  attackMs: 8,
  decayMs: 80,
  sustain: 0.7,
  releaseMs: 120,
};

export const TrackFxSchema = z.object({
  type: TrackFxTypeSchema.default("none"),
  /** Wet mix for echo / reverb / chorus (0–1). */
  mix: z.number().min(0).max(1).default(0.35),
  /** Echo delay in beats (1 = quarter note). */
  delayBeats: z
    .number()
    .min(ECHO_DELAY_BEATS_MIN)
    .max(ECHO_DELAY_BEATS_MAX)
    .default(0.5),
  /** Echo feedback (0–0.9). */
  feedback: z.number().min(0).max(0.9).default(0.35),
  /** Reverb decay / room size (0–1). */
  decay: z.number().min(0).max(1).default(0.45),
  /** HF damping for echo / reverb (0 = bright, 1 = dark). */
  damping: z.number().min(0).max(1).default(0.35),
  /** LFO rate for chorus / tremolo / vibrato (Hz). */
  rateHz: z.number().min(0.1).max(12).default(4),
  /** Modulation depth for chorus / tremolo / vibrato (0–1). */
  depth: z.number().min(0).max(1).default(0.5),
  /** 3-band EQ linear gains (0–2). */
  low: z.number().min(0).max(2).default(1),
  mid: z.number().min(0).max(2).default(1),
  high: z.number().min(0).max(2).default(1),
  /** High-pass cutoff Hz (TRACK_HP_HZ_OPEN = bypass). */
  hpHz: z.number().min(TRACK_HP_HZ_MIN).max(TRACK_HP_HZ_MAX).default(TRACK_HP_HZ_OPEN),
  /** Low-pass cutoff Hz (TRACK_LP_HZ_OPEN = bypass). */
  lpHz: z.number().min(TRACK_LP_HZ_MIN).max(TRACK_LP_HZ_MAX).default(TRACK_LP_HZ_OPEN),
  /** ADSR attack (ms). */
  attackMs: z.number().min(0).max(TRACK_ATTACK_MS_MAX).default(0),
  /** ADSR decay (ms) — peak → sustain. */
  decayMs: z.number().min(0).max(TRACK_DECAY_MS_MAX).default(0),
  /** ADSR sustain level (0–1). */
  sustain: z.number().min(0).max(1).default(1),
  /** ADSR release (ms). */
  releaseMs: z.number().min(0).max(TRACK_RELEASE_MS_MAX).default(0),
});
export type TrackFx = z.infer<typeof TrackFxSchema>;

export const DEFAULT_TRACK_FX: TrackFx = {
  type: "none",
  mix: 0.35,
  delayBeats: 0.5,
  feedback: 0.35,
  decay: 0.45,
  damping: 0.35,
  rateHz: 4,
  depth: 0.5,
  low: 1,
  mid: 1,
  high: 1,
  hpHz: TRACK_HP_HZ_OPEN,
  lpHz: TRACK_LP_HZ_OPEN,
  ...DEFAULT_TRACK_ADSR,
};

function clampFx(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve tempo-synced echo delay to seconds (clamped for DelayNode).
 */
export function echoDelaySec(delayBeats: number, bpm: number): number {
  const beats = clampFx(
    delayBeats,
    ECHO_DELAY_BEATS_MIN,
    ECHO_DELAY_BEATS_MAX,
  );
  const sec = (beats * 60) / Math.max(1, bpm);
  return clampFx(sec, 0.02, ECHO_DELAY_MAX_SEC);
}

/** Coerce IDB / partial rows into a full TrackFx (migrates legacy delayMs @ 120 BPM). */
export function normalizeTrackFx(raw: unknown): TrackFx {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (
    (base.delayBeats === undefined || base.delayBeats === null) &&
    typeof base.delayMs === "number" &&
    Number.isFinite(base.delayMs)
  ) {
    base.delayBeats = clampFx(
      base.delayMs / (60_000 / 120),
      ECHO_DELAY_BEATS_MIN,
      ECHO_DELAY_BEATS_MAX,
    );
  }
  delete base.delayMs;
  const parsed = TrackFxSchema.safeParse(base);
  return parsed.success ? parsed.data : { ...DEFAULT_TRACK_FX };
}

/** Wet insert selected (not none). */
export function trackFxHasWet(fx: TrackFx): boolean {
  return normalizeTrackFx(fx).type !== "none";
}

/** High-pass not at bypass. */
export function trackFxHasHp(fx: TrackFx): boolean {
  return normalizeTrackFx(fx).hpHz > TRACK_HP_HZ_OPEN + 0.5;
}

/** Low-pass not at bypass. */
export function trackFxHasLp(fx: TrackFx): boolean {
  return normalizeTrackFx(fx).lpHz < TRACK_LP_HZ_OPEN - 0.5;
}

/** HP and/or LP engaged. */
export function trackFxHasTone(fx: TrackFx): boolean {
  return trackFxHasHp(fx) || trackFxHasLp(fx);
}

/** Non-default track ADSR. */
export function trackFxHasEnvelope(fx: TrackFx): boolean {
  const n = normalizeTrackFx(fx);
  return (
    n.attackMs > 0 ||
    n.decayMs > 0 ||
    n.sustain < 0.999 ||
    n.releaseMs > 0
  );
}

export function trackFxAdsr(fx: TrackFx): TrackAdsr {
  const n = normalizeTrackFx(fx);
  return {
    attackMs: n.attackMs,
    decayMs: n.decayMs,
    sustain: n.sustain,
    releaseMs: n.releaseMs,
  };
}

export function trackFxToggleHp(fx: TrackFx): TrackFx {
  const n = normalizeTrackFx(fx);
  return {
    ...n,
    hpHz: trackFxHasHp(n) ? TRACK_HP_HZ_OPEN : TRACK_HP_HZ_ON,
  };
}

export function trackFxToggleLp(fx: TrackFx): TrackFx {
  const n = normalizeTrackFx(fx);
  return {
    ...n,
    lpHz: trackFxHasLp(n) ? TRACK_LP_HZ_OPEN : TRACK_LP_HZ_ON,
  };
}

export function trackFxToggleAdsr(fx: TrackFx): TrackFx {
  const n = normalizeTrackFx(fx);
  return {
    ...n,
    ...(trackFxHasEnvelope(n) ? DEFAULT_TRACK_ADSR : TRACK_ADSR_ON),
  };
}

/**
 * Shrink A/D/R so they fit in `durMs` (attack, then release, leftover → decay).
 */
export function fitTrackAdsr(
  attackMs: number,
  decayMs: number,
  releaseMs: number,
  durMs: number,
): Pick<TrackAdsr, "attackMs" | "decayMs" | "releaseMs"> {
  const dur = Math.max(0, durMs);
  const a = Math.min(Math.max(0, attackMs), dur);
  const r = Math.min(Math.max(0, releaseMs), dur - a);
  const d = Math.min(Math.max(0, decayMs), Math.max(0, dur - a - r));
  return { attackMs: a, decayMs: d, releaseMs: r };
}

/** Linear ADSR gain at `tMs` into a clip of `durMs` (0–1). */
export function adsrGain01(tMs: number, durMs: number, adsr: TrackAdsr): number {
  const dur = Math.max(0.001, durMs);
  const { attackMs: a, decayMs: d, releaseMs: r } = fitTrackAdsr(
    adsr.attackMs,
    adsr.decayMs,
    adsr.releaseMs,
    dur,
  );
  const s = Math.min(1, Math.max(0, adsr.sustain));
  const attackPeak = d > 0 ? 1 : s;
  const decayEnd = a + d;
  const releaseStart = Math.max(decayEnd, dur - r);

  if (tMs <= 0) return a > 0 ? 0 : attackPeak;
  if (tMs >= dur) return r > 0 ? 0 : s;

  if (a > 0 && tMs < a) return (tMs / a) * attackPeak;
  if (d > 0 && tMs < decayEnd) {
    const u = (tMs - a) / d;
    return attackPeak + (s - attackPeak) * u;
  }
  if (r > 0 && tMs >= releaseStart) {
    const span = dur - releaseStart;
    if (span <= 0) return 0;
    return s * (1 - (tMs - releaseStart) / span);
  }
  return s;
}

/** Needs a live track bus (wet and/or tone filters). */
export function trackFxNeedsBus(fx: TrackFx): boolean {
  return trackFxHasWet(fx) || trackFxHasTone(fx);
}

/** Anything to bake / show as active (wet, tone, or envelope). */
export function trackFxIsActive(fx: TrackFx): boolean {
  return trackFxNeedsBus(fx) || trackFxHasEnvelope(fx);
}

export const TrackSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  name: z.string(),
  gainDb: z.number(),
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
  solo: z.boolean(),
  color: z.string().optional(),
  heightPx: z.number().int().positive(),
  fx: TrackFxSchema.default(DEFAULT_TRACK_FX),
});
export type Track = z.infer<typeof TrackSchema>;

/** Fill missing track fields (legacy IDB rows without `fx`). */
export function normalizeTrack(raw: Track): Track {
  return {
    ...raw,
    pan: Number.isFinite(raw.pan) ? raw.pan : 0,
    fx: normalizeTrackFx(raw.fx),
  };
}

export const ClipSchema = z.object({
  id: z.string().uuid(),
  trackId: z.string().uuid(),
  sampleVersionId: z.string().uuid(),
  sampleId: z.string().uuid().optional(),
  startTick: z.number().int(),
  lengthTick: z.number().int().positive(),
  contentOffsetMs: z.number(),
  loopEnabled: z.boolean(),
  loopLengthMs: z.number().optional(),
  gainDb: z.number(),
  fadeInMs: z.number().nonnegative(),
  fadeOutMs: z.number().nonnegative(),
  fadeCurve: FadeCurveSchema,
  pitchSemitones: z.number(),
  stretchMode: StretchModeSchema,
  reverse: z.boolean(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const EditOperationSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string(),
  op: z.string(),
  payload: z.record(z.unknown()),
  clientSeq: z.number().int().nonnegative(),
  clientId: z.string(),
  createdAt: z.string().datetime(),
  /** Set when the op was accepted by the sync endpoint. */
  syncedAt: z.string().datetime().optional(),
});
export type EditOperation = z.infer<typeof EditOperationSchema>;

export const VoicePolicySchema = z.enum([
  "exclude",
  "mark_keep_local",
  "keep",
]);
export type VoicePolicy = z.infer<typeof VoicePolicySchema>;

export const SyncPolicySchema = z.enum([
  "local_only",
  "metadata_only",
  "full",
]);
export type SyncPolicy = z.infer<typeof SyncPolicySchema>;
