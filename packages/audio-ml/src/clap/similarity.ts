/** Cosine similarity for CLAP / embedding vectors (ADR-0009 client path). */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export type ClapEmbeddingFeatures = {
  /** Model id, e.g. Xenova/clap-htsat-unfused */
  model: string;
  dims: number;
  /** Float embedding; stored in SampleAnalysis.features.clap */
  vector: number[];
};

export const CLAP_FEATURES_KEY = "clap" as const;
