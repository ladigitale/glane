import { cosineSimilarity } from "./similarity.js";

export type RankedId = { id: string; score: number };

/** Rank items by cosine similarity to a query vector (desc). */
export function rankByVector(
  query: ArrayLike<number>,
  items: ReadonlyArray<{ id: string; vector: ArrayLike<number> }>,
  opts?: { minScore?: number; limit?: number },
): RankedId[] {
  const minScore = opts?.minScore ?? -1;
  const scored: RankedId[] = [];
  for (const item of items) {
    const score = cosineSimilarity(query, item.vector);
    if (score >= minScore) scored.push({ id: item.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (opts?.limit != null) return scored.slice(0, opts.limit);
  return scored;
}
