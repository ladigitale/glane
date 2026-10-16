import { z } from "zod";
import { FxPatchSchema } from "./score.js";

/** Roles accepted by the synth page / audio-synth. */
export const SynthRoleSchema = z.enum([
  "pivot",
  "kick",
  "snare",
  "hat",
  "perc",
  "bass",
  "pad",
  "lead",
  "arp",
  "fx",
  "texture",
]);
export type SynthRole = z.infer<typeof SynthRoleSchema>;

export const SynthEngineSchema = z.enum([
  "subtractive",
  "fm",
  "granular",
  "additive",
  "physical",
  "noise",
  "voice",
]);
export type SynthEngine = z.infer<typeof SynthEngineSchema>;

export const SynthModeSchema = z.enum(["variations", "family", "song"]);
export type AgentSynthMode = z.infer<typeof SynthModeSchema>;

export const SongIntentionSchema = z.enum([
  "minimal",
  "full",
  "drums",
  "bassPad",
  "ambient",
]);
export type AgentSongIntention = z.infer<typeof SongIntentionSchema>;

export const CoherenceKindSchema = z.enum(["parametric", "musical"]);
export const ScaleModeSchema = z.enum(["major", "minor"]);

const norm01 = z.number().min(0).max(1);

/** One role card — quantity / knobs optional (defaults from audio-synth presets). */
export const SynthCardSchema = z
  .object({
    role: SynthRoleSchema,
    quantity: z.number().int().min(1).max(40).optional(),
    randomness: norm01.optional(),
    engines: z.array(SynthEngineSchema).min(1).max(7).optional(),
    /** Semantic machine knobs 0–1 (body, punch, brightness, …). */
    machine: z.record(z.string(), norm01).optional(),
    usePivot: z.boolean().optional(),
  })
  .strict();
export type SynthCard = z.infer<typeof SynthCardSchema>;

/**
 * One-shot synth config for the agent.
 * Omitting `cards`: song → proposeSongCards(intention), family → defaultFamilyCards,
 * variations → one pivot card (quantity 6).
 */
export const SynthConfigSchema = z
  .object({
    mode: SynthModeSchema.default("song"),
    intention: SongIntentionSchema.optional().describe("Song kit preset when mode=song"),
    coherence: CoherenceKindSchema.optional(),
    tonicPc: z.number().int().min(0).max(11).optional(),
    scaleMode: ScaleModeSchema.optional(),
    bpm: z.number().int().min(60).max(180).optional(),
    freeFmRatios: z.boolean().optional(),
    seed: z.number().int().optional(),
    cards: z.array(SynthCardSchema).min(1).max(20).optional(),
    open: z.boolean().optional().describe("Navigate to /synth after save (default false)"),
  })
  .strict();
export type SynthConfig = z.infer<typeof SynthConfigSchema>;

export const LibraryUpdateFieldsSchema = z
  .object({
    samples: z.array(z.string().min(6)).min(1).max(50),
    favorite: z.boolean().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    name: z.string().max(200).nullable().optional(),
    forceRole: z
      .enum([
        "kick",
        "snare",
        "hat",
        "perc",
        "bass",
        "chord",
        "lead",
        "arp",
        "texture",
        "loop",
        "fx",
      ])
      .nullable()
      .optional(),
    addTags: z.array(z.string().min(1).max(64)).max(20).optional(),
    removeTags: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .strict();

export const LibraryUpdateSchema = LibraryUpdateFieldsSchema.refine(
  (o) =>
    o.favorite !== undefined ||
    o.rating !== undefined ||
    o.name !== undefined ||
    o.forceRole !== undefined ||
    (o.addTags?.length ?? 0) > 0 ||
    (o.removeTags?.length ?? 0) > 0,
  { message: "Au moins un champ à modifier (favorite, rating, name, forceRole, tags)." },
);
export type LibraryUpdate = z.infer<typeof LibraryUpdateSchema>;

export const SampleListSchema = z
  .object({
    samples: z.array(z.string().min(6)).min(1).max(50),
  })
  .strict();
export type SampleList = z.infer<typeof SampleListSchema>;

export const BakeFxSchema = z
  .object({
    sample: z.string().min(6),
    fx: FxPatchSchema,
    bpm: z.number().min(20).max(300).optional(),
  })
  .strict();
export type BakeFxInput = z.infer<typeof BakeFxSchema>;
