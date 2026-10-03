import type { Path } from "./types.js";

/** UI / settings lock groups → RNG path prefixes used in compose. */
export type LockLayerId =
  | "form"
  | "harmony"
  | "drums"
  | "melody"
  | "expression";

export const LOCK_LAYER_IDS: readonly LockLayerId[] = [
  "form",
  "harmony",
  "drums",
  "melody",
  "expression",
] as const;

export const LOCK_LAYER_PREFIXES: Record<
  LockLayerId,
  readonly Path[]
> = {
  form: ["form"],
  harmony: ["harmony", "dna/prog"],
  drums: ["drums", "dna/rhythm", "dna/sampleGenes"],
  melody: ["melody", "dna/hook", "dna/verse"],
  expression: ["mod", "gesture"],
};

export type ComposeLock = { path: Path; salt: string };

/** Expand locked layers (+ per-layer freeze salt) → compose locks. */
export function locksFromLayers(
  layers: Readonly<Partial<Record<LockLayerId, string>>>,
): ComposeLock[] {
  const out: ComposeLock[] = [];
  for (const id of LOCK_LAYER_IDS) {
    const salt = layers[id];
    if (salt == null) continue;
    for (const path of LOCK_LAYER_PREFIXES[id]) {
      out.push({ path, salt });
    }
  }
  return out;
}

export function isLockLayerId(v: string): v is LockLayerId {
  return (LOCK_LAYER_IDS as readonly string[]).includes(v);
}
