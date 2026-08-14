/**
 * ML / enrichment cues for the sequence generator (ADR-0020).
 * Uses stored tags + SampleAnalysis features — no model download at generate time.
 * CLAP cohesion reuses Hugging Face embeddings already written by clap-queue.
 */

import {
  STEM_TAG_PREFIX,
  YAMNET_TAG_PREFIX,
  cosineSimilarity,
  slugifyLabel,
  type DemucsStemName,
  DEMUCS_STEMS,
} from "@glane/audio-ml";
import type { ExprRole } from "@glane/core-model";

const STEM_SET = new Set<string>(DEMUCS_STEMS);

export type YamnetLabelScore = { label: string; score: number };

/** Extra fields fed into `SequenceSampleIn` from Sample + analysis. */
export type SampleMlCues = {
  subclass?: string;
  confidence?: number;
  interestScore?: number;
  rating?: number;
  parentSampleId?: string;
  stem?: DemucsStemName;
  /** YAMNet slugs without `yamnet:` prefix. */
  yamnet?: string[];
  /** Optional stored CLAP vector — cohesion attached in `withClapCohesion`. */
  clapVector?: number[];
  /** Cosine vs seed embedding (0–1-ish); set by `withClapCohesion`. */
  clapCohesion?: number;
};

export function parseStemFromTags(
  tags: readonly string[] | undefined,
): DemucsStemName | undefined {
  if (!tags?.length) return undefined;
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t.startsWith(STEM_TAG_PREFIX)) continue;
    const name = t.slice(STEM_TAG_PREFIX.length);
    if (STEM_SET.has(name)) return name as DemucsStemName;
  }
  return undefined;
}

export function parseYamnetSlugs(
  tags: readonly string[] | undefined,
): string[] {
  if (!tags?.length) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t.startsWith(YAMNET_TAG_PREFIX)) continue;
    const slug = t.slice(YAMNET_TAG_PREFIX.length);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Prefer tag slugs; fall back to analysis `features.yamnet`. */
export function resolveYamnetSlugs(
  tags: readonly string[] | undefined,
  features: Record<string, unknown> | undefined,
): string[] {
  const fromTags = parseYamnetSlugs(tags);
  if (fromTags.length > 0) return fromTags;
  const raw = features?.yamnet;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const label = (row as YamnetLabelScore).label;
    if (typeof label !== "string" || !label) continue;
    const slug = slugifyLabel(label);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

function haystack(parts: readonly (string | undefined)[]): string {
  return ` ${parts.filter(Boolean).join(" ").toLowerCase().replace(/_/g, "-")} `;
}

/**
 * Strong role hint from Demucs stem (+ optional YAMNet refine for drums).
 */
export function roleHintFromStem(
  stem: DemucsStemName | undefined,
  yamnet: readonly string[] | undefined,
  subclass?: string,
): ExprRole | null {
  if (!stem) return null;
  const y = haystack([...(yamnet ?? []), subclass]);
  switch (stem) {
    case "drums":
      if (/\b(snare|rim)\b/.test(y)) return "snare";
      if (/\b(hi-hat|hihat|cymbal|ride|crash)\b/.test(y)) return "hat";
      if (/\b(kick|bass-drum|thump)\b/.test(y)) return "kick";
      return "kick";
    case "bass":
      return "bass";
    case "vocals":
      return "lead";
    case "other":
      if (/\b(piano|guitar|organ|synth|chord|pad)\b/.test(y)) return "chord";
      if (/\b(flute|violin|lead|solo)\b/.test(y)) return "lead";
      return "texture";
    default:
      return null;
  }
}

/**
 * Soft role hint from YAMNet slugs / subclass (AudioSet vocabulary).
 */
export function roleHintFromYamnet(
  yamnet: readonly string[] | undefined,
  subclass?: string,
): ExprRole | null {
  const y = haystack([...(yamnet ?? []), subclass]);
  if (y === "  ") return null;

  if (/\b(kick|bass-drum|thump)\b/.test(y)) return "kick";
  if (/\b(snare)\b/.test(y)) return "snare";
  if (/\b(hi-hat|hihat|cymbal|ride|crash)\b/.test(y)) return "hat";
  if (
    /\b(drum|percussion|tambourine|clap|knock|tap|slap|bang|gunshot|explosion)\b/.test(
      y,
    )
  ) {
    return "perc";
  }
  if (/\b(bass|double-bass|contrabass|bass-guitar)\b/.test(y)) return "bass";
  if (
    /\b(piano|organ|guitar|chord|pad|harp|accordion|synthesizer)\b/.test(y)
  ) {
    return "chord";
  }
  if (
    /\b(violin|cello|flute|trumpet|saxophone|clarinet|singing|choir|melody|lead)\b/.test(
      y,
    )
  ) {
    return "lead";
  }
  if (/\b(speech|conversation|narration|whisper|babbling|voice)\b/.test(y)) {
    return "lead";
  }
  if (
    /\b(rain|wind|thunder|stream|ocean|wave|bird|insect|cricket|frog|dog|cat|bark|meow|rustle|crackle|fireplace|ambient)\b/.test(
      y,
    )
  ) {
    return "texture";
  }
  if (/\b(music|techno|hip-hop|hiphop|orchestra|electronic-music|reggae|jazz|rock|disco|funk|blues|classical|ambient|house|drum-and-bass)\b/.test(y)) {
    return "loop";
  }
  if (
    /\b(noise|static|hiss|hum|buzz|engine|vehicle|traffic|siren|alarm|machinery)\b/.test(
      y,
    )
  ) {
    return "fx";
  }
  return null;
}

/** Lower score = better fit for role ranking. */
export function mlScoreAdjust(
  cues: SampleMlCues,
  role: ExprRole,
  inferred: ExprRole,
  popScale = 1,
): number {
  let delta = 0;
  const { stem, yamnet, subclass, interestScore, rating, confidence, clapCohesion } =
    cues;
  const pop = Math.min(1, Math.max(0, popScale));

  if (
    stem === "drums" &&
    (role === "kick" || role === "snare" || role === "hat" || role === "perc")
  ) {
    delta -= role === inferred ? 3.5 : 2.5;
  }
  if (stem === "bass" && role === "bass") delta -= 4;
  if (stem === "vocals" && (role === "lead" || role === "texture" || role === "fx")) {
    delta -= role === "lead" ? 3 : 1.5;
  }
  if (
    stem === "other" &&
    (role === "chord" || role === "lead" || role === "texture" || role === "loop")
  ) {
    delta -= 1.8;
  }

  const yHint = roleHintFromYamnet(yamnet, subclass);
  if (yHint === role) delta -= 2.2;
  else if (yHint && yHint === inferred) delta -= 0.8;

  if (interestScore != null && Number.isFinite(interestScore)) {
    delta -= interestScore * 2 * pop;
  }
  if (rating != null && Number.isFinite(rating)) {
    delta -= (rating - 3) * 0.55 * pop;
  }
  if (confidence != null && Number.isFinite(confidence) && inferred === role) {
    delta -= confidence * 0.6;
  }
  if (clapCohesion != null && Number.isFinite(clapCohesion)) {
    delta -= Math.max(0, clapCohesion) * 2.4 * pop;
  }

  // Prefer stem children over undifferentiated parents when ranking kit/bass
  if (
    !stem &&
    cues.parentSampleId == null &&
    (role === "kick" || role === "snare" || role === "hat" || role === "bass")
  ) {
    delta += 0.35;
  }

  return delta;
}

type WithClap = SampleMlCues & { id: string; favorite?: boolean };

/**
 * Attach `clapCohesion` from stored HF/CLAP vectors (no model load).
 * Seed = favorite with vector, else highest interest, else first vector.
 * Pass `rnd` to pick a different CLAP anchor per generation seed.
 */
export function withClapCohesion<T extends WithClap>(
  samples: T[],
  rnd?: () => number,
): T[] {
  const withVec = samples.filter(
    (s) => Array.isArray(s.clapVector) && s.clapVector!.length > 0,
  );
  if (withVec.length < 2) return samples;

  let seed: T | undefined;
  if (rnd) {
    seed = withVec[Math.floor(rnd() * withVec.length)];
  } else {
    seed = withVec.find((s) => s.favorite);
    if (!seed) {
      seed = [...withVec].sort(
        (a, b) => (b.interestScore ?? 0) - (a.interestScore ?? 0),
      )[0];
    }
  }
  if (!seed?.clapVector) return samples;

  const seedVec = seed.clapVector;
  return samples.map((s) => {
    if (!s.clapVector?.length) return s;
    if (s.id === seed!.id) return { ...s, clapCohesion: 1 };
    const sim = cosineSimilarity(seedVec, s.clapVector);
    return { ...s, clapCohesion: Math.max(0, sim) };
  });
}
