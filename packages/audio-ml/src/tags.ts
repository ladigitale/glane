/** Tag / status prefixes for T2 ML enrichment (ADR-0020). */
export const ML_TAG = {
  done: "ml:done",
  skipped: "ml:skipped",
  running: "ml:running",
  yamnet: "ml:yamnet",
  clap: "ml:clap",
  demucs: "ml:demucs",
  demucsRunning: "ml:demucs-running",
  /** Parent had vocals removed (instrumental child exists). */
  novocals: "ml:novocals",
  /** Parent has an RNNoise-denoised child. */
  denoise: "ml:denoise",
  denoiseRunning: "ml:denoise-running",
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
    tag === ML_TAG.demucsRunning ||
    tag === ML_TAG.novocals ||
    tag === ML_TAG.denoise ||
    tag === ML_TAG.denoiseRunning
  );
}

/** YAMNet / CLAP status only — keep Demucs markers when re-enriching. */
function isEnrichStatusTag(tag: string): boolean {
  return (
    tag === ML_TAG.done ||
    tag === ML_TAG.skipped ||
    tag === ML_TAG.running ||
    tag === ML_TAG.yamnet ||
    tag === ML_TAG.clap
  );
}

export function isYamnetLabelTag(tag: string): boolean {
  return tag.startsWith(YAMNET_TAG_PREFIX);
}

export function isStemTag(tag: string): boolean {
  return tag.startsWith(STEM_TAG_PREFIX);
}

/** Strip previous YAMNet / CLAP status + labels before re-enrich. */
export function stripMlTags(tags: readonly string[]): string[] {
  return tags.filter(
    (t) =>
      !isEnrichStatusTag(t) &&
      !isYamnetLabelTag(t) &&
      !t.startsWith(CLAP_TAG_PREFIX),
  );
}
