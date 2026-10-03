import { geneFromOnsets } from "./rhythm.js";
import type { GrooveFromSamples, Path, Rng, RhythmGene } from "./types.js";

/** True if sample BPM is ≈ project tempo at ×½ / ×1 / ×2. */
export function bpmCompatible(
  sampleBpm: number,
  projectBpm: number,
  tol = 0.08,
): boolean {
  if (!(sampleBpm > 0) || !(projectBpm > 0)) return false;
  for (const r of [0.5, 1, 2]) {
    const err = Math.abs(sampleBpm * r - projectBpm) / projectBpm;
    if (err <= tol) return true;
  }
  return false;
}

/**
 * Quantize onset times (sec) onto a 16th grid for one bar at `bpm`.
 * Accents = strongest onsets (relative density in a small window).
 */
export function geneFromOnsetSeconds(opts: {
  onsetSec: readonly number[];
  bpm: number;
  steps?: number;
}): RhythmGene | null {
  const steps = opts.steps ?? 16;
  const bpm = opts.bpm;
  if (!(bpm > 0) || opts.onsetSec.length < 2) return null;
  const barSec = (60 / bpm) * 4;
  const stepSec = barSec / steps;
  if (!(stepSec > 0)) return null;

  const strength = new Map<number, number>();
  for (const t of opts.onsetSec) {
    if (!(t >= 0)) continue;
    const inBar = t % barSec;
    const step = Math.round(inBar / stepSec) % steps;
    strength.set(step, (strength.get(step) ?? 0) + 1);
  }
  if (strength.size < 2) return null;

  const onsets = [...strength.keys()].sort((a, b) => a - b);
  const max = Math.max(...strength.values());
  const accents = onsets.map((o) => {
    const s = strength.get(o) ?? 1;
    return s >= max * 0.85 ? 1 : 0.35 + (s / max) * 0.4;
  });
  return { steps, onsets, accents };
}

/** Prefer denser / more syncopated sample genes under auto. */
export function sampleGeneScore(gene: RhythmGene): number {
  const dens = gene.onsets.length / gene.steps;
  let sync = 0;
  for (const o of gene.onsets) {
    if (o % 2 === 1) sync += 1;
  }
  const syncRate = gene.onsets.length ? sync / gene.onsets.length : 0;
  return dens * 0.55 + syncRate * 0.45;
}

/**
 * Merge library-derived genes into DNA rhythm set.
 * `on` / good `auto` → sample gene becomes primary (index 0).
 */
export function chooseRhythmGenes(opts: {
  generated: RhythmGene[];
  sampleGenes: readonly RhythmGene[];
  mode: GrooveFromSamples;
  rng: Rng;
  path: Path;
}): { genes: RhythmGene[]; usedSample: boolean; warning?: string } {
  const generated =
    opts.generated.length > 0
      ? opts.generated
      : [geneFromOnsets([0, 4, 8, 12], 16)];
  if (opts.mode === "off" || opts.sampleGenes.length === 0) {
    return { genes: generated, usedSample: false };
  }

  const ranked = [...opts.sampleGenes].sort(
    (a, b) => sampleGeneScore(b) - sampleGeneScore(a),
  );
  const best = ranked[0]!;
  const score = sampleGeneScore(best);

  if (opts.mode === "auto" && score < 0.35) {
    return { genes: generated, usedSample: false };
  }

  const pickIdx =
    ranked.length === 1
      ? 0
      : Math.min(
          ranked.length - 1,
          Math.floor(opts.rng(`${opts.path}/pick`) * ranked.length),
        );
  const chosen = ranked[pickIdx]!;
  const rest = generated.slice(0, Math.max(1, generated.length - 1));
  return {
    genes: [chosen, ...rest],
    usedSample: true,
    warning: "dna: groove from captured loop onsets",
  };
}
