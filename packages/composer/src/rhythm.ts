import { int, pick } from "./rng.js";
import type { Path, Rng, RhythmGene } from "./types.js";

/** Bjorklund / Euclidean rhythm: k onsets over n steps. */
export function euclid(k: number, n: number, rotation = 0): number[] {
  const pulses = Math.max(0, Math.min(k, n));
  const steps = Math.max(1, n);
  if (pulses === 0) return [];
  if (pulses === steps) {
    return Array.from({ length: steps }, (_, i) => i);
  }
  // Standard binary method
  const pattern: number[] = [];
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(1);
    } else {
      pattern.push(0);
    }
  }
  // Rotate so first onset lands near 0
  let first = pattern.indexOf(1);
  if (first < 0) first = 0;
  const rot = ((rotation % steps) + steps) % steps;
  const shifted = pattern
    .slice(first)
    .concat(pattern.slice(0, first));
  const rotated = shifted.slice(rot).concat(shifted.slice(0, rot));
  const onsets: number[] = [];
  for (let i = 0; i < rotated.length; i++) {
    if (rotated[i]) onsets.push(i);
  }
  return onsets;
}

export function geneFromOnsets(
  onsets: number[],
  steps = 16,
  accentEvery = 4,
): RhythmGene {
  const uniq = [...new Set(onsets.filter((o) => o >= 0 && o < steps))].sort(
    (a, b) => a - b,
  );
  return {
    steps,
    onsets: uniq,
    accents: uniq.map((o) => (o % accentEvery === 0 ? 1 : 0.45)),
  };
}

export function shiftOne(gene: RhythmGene, delta: number): RhythmGene {
  const n = gene.steps;
  const onsets = gene.onsets.map((o) => (((o + delta) % n) + n) % n).sort(
    (a, b) => a - b,
  );
  return geneFromOnsets(onsets, n);
}

export function addGhost(gene: RhythmGene, step: number): RhythmGene {
  const n = gene.steps;
  const s = ((step % n) + n) % n;
  if (gene.onsets.includes(s)) return gene;
  const onsets = [...gene.onsets, s].sort((a, b) => a - b);
  const accents = onsets.map((o) => {
    const i = gene.onsets.indexOf(o);
    if (i >= 0) return gene.accents[i] ?? 0.45;
    return 0.2;
  });
  return { steps: n, onsets, accents };
}

export function dropWeak(gene: RhythmGene): RhythmGene {
  if (gene.onsets.length <= 2) return gene;
  const kept: number[] = [];
  const accents: number[] = [];
  for (let i = 0; i < gene.onsets.length; i++) {
    const a = gene.accents[i] ?? 0.45;
    if (a >= 0.5 || kept.length < 2) {
      kept.push(gene.onsets[i]!);
      accents.push(a);
    }
  }
  return { steps: gene.steps, onsets: kept, accents };
}

export function syncopate(gene: RhythmGene): RhythmGene {
  // Move weak onsets +1 step (16th)
  const n = gene.steps;
  const onsets = gene.onsets.map((o, i) => {
    const a = gene.accents[i] ?? 0.45;
    if (a >= 0.75) return o;
    return (o + 1) % n;
  });
  return geneFromOnsets(onsets, n);
}

export type NamedMutation =
  | "shiftOne"
  | "addGhost"
  | "dropWeak"
  | "syncopate"
  | "none";

export function applyMutation(
  gene: RhythmGene,
  name: NamedMutation,
  r: Rng,
  path: Path,
): RhythmGene {
  switch (name) {
    case "shiftOne":
      return shiftOne(gene, int(r, `${path}/d`, -2, 2) || 1);
    case "addGhost":
      return addGhost(gene, int(r, `${path}/g`, 0, gene.steps - 1));
    case "dropWeak":
      return dropWeak(gene);
    case "syncopate":
      return syncopate(gene);
    case "none":
      return gene;
  }
}

/** 2–3 rhythm genes for DNA: euclid + one named mutation each. */
export function generateRhythmGenes(
  r: Rng,
  path: Path,
  density = 0.5,
): RhythmGene[] {
  const genes: RhythmGene[] = [];
  const count = density > 0.65 ? 3 : 2;
  const presets: Array<{ k: number; n: number }> = [
    { k: Math.max(2, Math.round(2 + density * 4)), n: 16 }, // kick-ish
    { k: Math.max(2, Math.round(2 + density * 2)), n: 16 }, // snare-ish
    { k: Math.max(4, Math.round(6 + density * 6)), n: 16 }, // hat-ish
  ];
  const mutations: NamedMutation[] = [
    "none",
    "shiftOne",
    "addGhost",
    "dropWeak",
    "syncopate",
  ];
  for (let i = 0; i < count; i++) {
    const p = presets[i]!;
    const rot = int(r, `${path}/g${i}/rot`, 0, p.n - 1);
    let gene = geneFromOnsets(euclid(p.k, p.n, rot), p.n);
    const mut = pick(r, `${path}/g${i}/mut`, mutations);
    gene = applyMutation(gene, mut, r, `${path}/g${i}/apply`);
    genes.push(gene);
  }
  return genes;
}

/** Convert 16th-grid gene to absolute ticks for one bar. */
export function geneToBarTicks(
  gene: RhythmGene,
  barStartTick: number,
  ppq: number,
): Array<{ tick: number; accent: boolean; vel: number }> {
  const t16 = ppq / 4;
  return gene.onsets.map((o, i) => {
    const a = gene.accents[i] ?? 0.45;
    return {
      tick: barStartTick + Math.round(o * t16),
      accent: a >= 0.75,
      vel: Math.min(1, Math.max(0.15, a)),
    };
  });
}
