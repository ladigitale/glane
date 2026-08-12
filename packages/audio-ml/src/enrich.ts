import { ML_TAG, stripMlTags } from "./tags.js";
import { pickClassHint, slugifyLabel, yamnetTag } from "./yamnet/map.js";
import type {
  AudioClassifierPort,
  AudioLabelScore,
  EnrichOptions,
  EnrichResult,
} from "./types.js";

export { yamnetTag, slugifyLabel };

/** Build enrich result from already-scored labels (pure / testable). */
export function enrichFromLabels(
  existingTags: readonly string[],
  labels: readonly AudioLabelScore[],
  opts?: EnrichOptions,
): EnrichResult {
  const minScore = opts?.minScore ?? 0.12;
  const maxLabels = opts?.maxLabels ?? 5;
  const ranked = [...labels]
    .filter((l) => l.score >= minScore && l.label.trim().length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLabels);

  const base = stripMlTags(existingTags);
  const labelTags = ranked.map((l) => yamnetTag(l.label));
  const tags = [
    ...base,
    ML_TAG.yamnet,
    ML_TAG.done,
    ...labelTags.filter((t) => !base.includes(t)),
  ];

  const top = ranked[0];
  const hint = pickClassHint(ranked, Math.max(minScore, 0.18));

  return {
    tags,
    subclass: top ? slugifyLabel(top.label) : undefined,
    classHint: hint?.class,
    classHintConfidence: hint?.confidence,
    labels: ranked,
  };
}

/**
 * Run classifier → merge tags. Caller owns PCM / sampleRate (raw or polished).
 */
export async function enrichWithClassifier(
  existingTags: readonly string[],
  pcm: Float32Array,
  sampleRate: number,
  classifier: AudioClassifierPort,
  opts?: EnrichOptions,
): Promise<EnrichResult> {
  const labels = await classifier.classify(pcm, sampleRate);
  return enrichFromLabels(existingTags, labels, opts);
}

export { ML_TAG, stripMlTags };
