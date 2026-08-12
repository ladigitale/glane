/** Tag / status prefixes for T2 ML enrichment (ADR-0020). */
export const ML_TAG = {
  done: "ml:done",
  skipped: "ml:skipped",
  running: "ml:running",
  yamnet: "ml:yamnet",
  clap: "ml:clap",
  demucs: "ml:demucs",
  demucsRunning: "ml:demucs-running",
} as const;

export const YAMNET_TAG_PREFIX = "yamnet:";
export const CLAP_TAG_PREFIX = "clap:";
export const STEM_TAG_PREFIX = "stem:";

export function isMlStatusTag(tag: string): boolean {
  return (
    tag === ML_TAG.done ||
    tag === ML_TAG.skipped ||
    tag === ML_TAG.running ||
    tag === ML_TAG.yamnet ||
    tag === ML_TAG.clap ||
    tag === ML_TAG.demucs ||
    tag === ML_TAG.demucsRunning
  );
}

export function isYamnetLabelTag(tag: string): boolean {
  return tag.startsWith(YAMNET_TAG_PREFIX);
}

export function isStemTag(tag: string): boolean {
  return tag.startsWith(STEM_TAG_PREFIX);
}

/** Strip previous ML status / yamnet labels before re-enrich. */
export function stripMlTags(tags: readonly string[]): string[] {
  return tags.filter(
    (t) =>
      !isMlStatusTag(t) &&
      !isYamnetLabelTag(t) &&
      !t.startsWith(CLAP_TAG_PREFIX),
  );
}
