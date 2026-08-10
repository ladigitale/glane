import { processTextureClip, type SeamlessLoopResult } from "./seamless.js";

/**
 * Lazy texture polish — run once when auditioning / editing a deferred loop clip.
 * Returns null if clip is too short or already unsuitable.
 */
export function ensureSeamlessTexture(
  pcm: Float32Array,
  sampleRate: number,
  tags: readonly string[] = [],
): SeamlessLoopResult | null {
  if (tags.includes("seamless")) return null;
  return processTextureClip(pcm, sampleRate);
}
