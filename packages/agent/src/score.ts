import { z } from "zod";
import {
  AutomationTargetSchema,
  DEFAULT_TRACK_COUNT,
  FadeCurveSchema,
  FormSectionKindSchema,
  StretchModeSchema,
  TrackFxSchema,
  type TrackFx,
} from "@glane/core-model";

/**
 * Agent score — the declarative arrangement an agent (Claude via MCP) writes.
 *
 * Musical positions are 1-based `bar` + 1-based `beat` (beat = quarter note,
 * like the sequencer grid). Track order = engine track index (0-based in
 * automation targets). Everything not given falls back to sequencer defaults;
 * a write fully replaces the current arrangement.
 */

export const AGENT_MAX_TRACKS = DEFAULT_TRACK_COUNT;
export const AGENT_MAX_BARS = 512;

/** TrackFx with every field optional and no defaults (patch semantics). */
const fxShape = TrackFxSchema.shape;
type FxShape = typeof fxShape;
const fxPatchShape = Object.fromEntries(
  Object.entries(fxShape).map(([k, v]) => [
    k,
    (v as z.ZodDefault<z.ZodTypeAny>).removeDefault().optional(),
  ]),
) as { [K in keyof FxShape]: z.ZodOptional<z.ZodTypeAny> };

export const FxPatchSchema = z
  .object(fxPatchShape)
  .strict() as unknown as z.ZodType<Partial<TrackFx>>;
export type FxPatch = Partial<TrackFx>;

const sampleRef = z
  .string()
  .min(6, "sample: id complet ou préfixe d'au moins 6 caractères");

/** Per-instance (clip) parameters shared by clips and patterns. */
const instanceShape = {
  offsetMs: z.number().min(0).optional(),
  gainDb: z.number().min(-60).max(12).optional(),
  fadeInMs: z.number().min(0).max(30_000).optional(),
  fadeOutMs: z.number().min(0).max(30_000).optional(),
  fadeCurve: FadeCurveSchema.optional(),
  stretch: StretchModeSchema.optional(),
  reverse: z.boolean().optional(),
};

export const ScoreClipSchema = z
  .object({
    sample: sampleRef,
    bar: z.number().int().min(1),
    beat: z.number().min(1).optional(),
    /** Length in beats (quarter notes). */
    beats: z.number().positive().optional(),
    /** Length in ms (converted at the score tempo). Ignored if `beats` set. */
    ms: z.number().positive().optional(),
    loop: z.boolean().optional(),
    /** Loop window length (ms) from offset. Default: sample loop region or rest of sample. */
    loopMs: z.number().positive().optional(),
    pitch: z.number().min(-24).max(24).optional(),
    ...instanceShape,
  })
  .strict();
export type ScoreClip = z.infer<typeof ScoreClipSchema>;

/** Characters allowed in a step string; `|` and spaces are visual only. */
export const STEP_CHARS = /^[Xx.\-| ]+$/;

export const ScorePatternSchema = z
  .object({
    /** One sample, or several cycled per hit (round-robin). */
    sample: z.union([sampleRef, z.array(sampleRef).min(1)]),
    fromBar: z.number().int().min(1),
    /** Inclusive. Default = fromBar. */
    toBar: z.number().int().min(1).optional(),
    /** `X` hit, `x` ghost hit, `.`/`-` rest. Repeats until toBar ends. */
    steps: z.string().regex(STEP_CHARS, "steps: seulement X x . - | et espaces"),
    /** Step size in beats. Default 0.25 (16th note in 4/4). */
    stepBeats: z.number().positive().max(16).optional(),
    /** Hit length in beats. Default: until next hit, capped by sample length. */
    hitBeats: z.number().positive().optional(),
    /** Gain offset of `x` ghost hits vs `X`. Default -6 dB. */
    ghostDb: z.number().min(-48).max(0).optional(),
    /** Semitones; an array cycles per hit. */
    pitch: z.union([z.number(), z.array(z.number()).min(1)]).optional(),
    /** Bars (absolute, 1-based) to leave silent inside the range. */
    skipBars: z.array(z.number().int().min(1)).optional(),
    ...instanceShape,
  })
  .strict();
export type ScorePattern = z.infer<typeof ScorePatternSchema>;

export const ScoreTrackSchema = z
  .object({
    name: z.string().max(40).optional(),
    gainDb: z.number().min(-60).max(12).optional(),
    pan: z.number().min(-1).max(1).optional(),
    mute: z.boolean().optional(),
    fx: FxPatchSchema.optional(),
    sendA: z.number().min(0).max(1).optional(),
    sendB: z.number().min(0).max(1).optional(),
    clips: z.array(ScoreClipSchema).optional(),
    patterns: z.array(ScorePatternSchema).optional(),
  })
  .strict();
export type ScoreTrack = z.infer<typeof ScoreTrackSchema>;

export const ScoreAutoPointSchema = z
  .object({
    bar: z.number().int().min(1),
    beat: z.number().min(1).optional(),
    value: z.number(),
    curve: z.enum(["step", "lin", "exp", "s"]).optional(),
  })
  .strict();

export const ScoreAutomationSchema = z
  .object({
    target: AutomationTargetSchema,
    points: z.array(ScoreAutoPointSchema).min(1),
  })
  .strict();
export type ScoreAutomation = z.infer<typeof ScoreAutomationSchema>;

export const ScoreSectionSchema = z
  .object({
    kind: FormSectionKindSchema,
    bar: z.number().int().min(1),
    bars: z.number().int().positive(),
    energy: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ScoreSchema = z
  .object({
    title: z.string().max(80).optional(),
    bpm: z.number().min(20).max(300),
    timeSignature: z
      .tuple([z.number().int().min(1).max(16), z.number().int().min(1).max(16)])
      .optional(),
    bars: z.number().int().min(1).max(AGENT_MAX_BARS),
    master: z
      .object({
        gainDb: z.number().min(-60).max(12).optional(),
        preampGainDb: z.number().min(-24).max(24).optional(),
        /** Up to two serial wet inserts (tone / ADSR ignored on master). */
        fx: z.array(FxPatchSchema).max(2).optional(),
      })
      .strict()
      .optional(),
    /** Shared send-return spaces, fed by track sendA / sendB. */
    spaces: z
      .object({ A: FxPatchSchema.optional(), B: FxPatchSchema.optional() })
      .strict()
      .optional(),
    sections: z.array(ScoreSectionSchema).optional(),
    automation: z.array(ScoreAutomationSchema).optional(),
    tracks: z.array(ScoreTrackSchema).min(1).max(AGENT_MAX_TRACKS),
  })
  .strict();
export type Score = z.infer<typeof ScoreSchema>;
