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
  snapConfig: z.string().optional(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** One light insert per track (ADR-0016): None / EQ / Echo / Reverb. */
export const TrackFxTypeSchema = z.enum(["none", "eq", "echo", "reverb"]);
export type TrackFxType = z.infer<typeof TrackFxTypeSchema>;

export const TrackFxSchema = z.object({
  type: TrackFxTypeSchema.default("none"),
  /** Wet mix for echo / reverb (0–1). */
  mix: z.number().min(0).max(1).default(0.35),
  /** Echo delay (ms). */
  delayMs: z.number().min(20).max(1500).default(280),
  /** Echo feedback (0–0.9). */
  feedback: z.number().min(0).max(0.9).default(0.35),
  /** Reverb decay / room size (0–1). */
  decay: z.number().min(0).max(1).default(0.45),
  /** 3-band EQ linear gains (0–2). */
  low: z.number().min(0).max(2).default(1),
  mid: z.number().min(0).max(2).default(1),
  high: z.number().min(0).max(2).default(1),
});
export type TrackFx = z.infer<typeof TrackFxSchema>;

export const DEFAULT_TRACK_FX: TrackFx = {
  type: "none",
  mix: 0.35,
  delayMs: 280,
  feedback: 0.35,
  decay: 0.45,
  low: 1,
  mid: 1,
  high: 1,
};

/** Coerce IDB / partial rows into a full TrackFx. */
export function normalizeTrackFx(raw: unknown): TrackFx {
  const parsed = TrackFxSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_TRACK_FX };
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
