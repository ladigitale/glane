import type { ExprRole } from "@glane/core-model";
import { PPQ } from "@glane/core-model";
import {
  addGhost,
  dropWeak,
  geneFromOnsets,
  geneToBarTicks,
  shiftOne,
  syncopate,
} from "./rhythm.js";
import type {
  NoteEvent,
  Path,
  RhythmGene,
  Section,
  TrackPart,
} from "./types.js";

export type DrumLevel = "base" | "variant" | "fill";

const KIT: ExprRole[] = ["kick", "snare", "hat", "perc"];

/** Density tier 0..2 from section energy + density slider. */
export function drumTier(energy: number, density: number): number {
  const v = energy * 0.65 + density * 0.35;
  if (v < 0.4) return 0;
  if (v < 0.7) return 1;
  return 2;
}

function roleGene(
  genes: readonly RhythmGene[],
  role: ExprRole,
  tier: number,
): RhythmGene {
  const g0 = genes[0] ?? geneFromOnsets([0, 8], 16);
  const g1 = genes[1] ?? geneFromOnsets([4, 12], 16);
  const g2 = genes[2] ?? geneFromOnsets([0, 4, 8, 12], 16);

  switch (role) {
    case "kick": {
      // tiers: 1&3 → 4-on-floor → +ghosts
      if (tier === 0) return geneFromOnsets([0, 8], 16);
      if (tier === 1) return geneFromOnsets(g0.onsets.length ? g0.onsets : [0, 4, 8, 12], 16);
      return addGhost(geneFromOnsets([0, 4, 8, 12], 16), 6);
    }
    case "snare": {
      if (tier === 0) return geneFromOnsets([4, 12], 16);
      if (tier === 1) return g1.onsets.length ? g1 : geneFromOnsets([4, 12], 16);
      return addGhost(geneFromOnsets([4, 12], 16), 10);
    }
    case "hat": {
      if (tier === 0) return geneFromOnsets([0, 4, 8, 12], 16); // 8ths as 16ths grid
      if (tier === 1) {
        return geneFromOnsets(
          [0, 2, 4, 6, 8, 10, 12, 14],
          16,
        );
      }
      return g2.onsets.length >= 8
        ? g2
        : geneFromOnsets(
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            16,
          );
    }
    case "perc": {
      if (tier === 0) return dropWeak(shiftOne(g0, 2));
      if (tier === 1) return syncopate(g1);
      return addGhost(syncopate(g2), 3);
    }
    default:
      return g0;
  }
}

function variantOf(base: RhythmGene, role: ExprRole): RhythmGene {
  if (role === "hat") return addGhost(base, 7);
  if (role === "snare") return addGhost(base, 14);
  if (role === "kick") return addGhost(base, 10);
  return syncopate(base);
}

function fillOf(base: RhythmGene, role: ExprRole): RhythmGene {
  if (role === "hat") {
    return geneFromOnsets(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      16,
    );
  }
  if (role === "snare") {
    return geneFromOnsets([4, 6, 8, 10, 12, 13, 14, 15], 16);
  }
  if (role === "kick") {
    return geneFromOnsets([0, 4, 6, 8, 10, 12, 14], 16);
  }
  return addGhost(addGhost(base, 5), 11);
}

/**
 * Pattern level for a bar inside a section — fixed positions, no rnd drop.
 * barInSection 0-based.
 */
export function levelForBar(
  section: Section,
  barInSection: number,
  nextKind: Section["kind"] | null,
): DrumLevel {
  const bars = section.bars;
  // Fill on last bar when next differs or energy rising into drop/chorus
  if (barInSection === bars - 1) {
    if (
      nextKind != null &&
      nextKind !== section.kind &&
      (nextKind === "chorus" ||
        nextKind === "drop" ||
        section.transitionIn === "fill" ||
        section.energy >= 0.55)
    ) {
      return "fill";
    }
    if (section.transitionIn === "drop-cut") return "base";
  }
  // Variant on bar 4 of an 8-bar phrase (index 3)
  if (bars >= 8 && barInSection === 3) return "variant";
  if (bars >= 8 && barInSection === 7 && nextKind === section.kind) {
    return "variant";
  }
  return "base";
}

function geneForLevel(
  base: RhythmGene,
  role: ExprRole,
  level: DrumLevel,
): RhythmGene {
  if (level === "base") return base;
  if (level === "variant") return variantOf(base, role);
  return fillOf(base, role);
}

function hitDur(role: ExprRole, ppq: number): number {
  if (role === "hat") return Math.floor(ppq / 4);
  if (role === "perc") return Math.floor(ppq / 3);
  if (role === "snare") return Math.floor(ppq / 2);
  return Math.floor(ppq / 2);
}

/**
 * Build kit TrackParts. Stable base pattern per section; variant/fill only at
 * fixed phrase positions. Never randomly drops hits.
 */
export function planDrums(opts: {
  sections: readonly Section[];
  rhythmGenes: readonly RhythmGene[];
  density: number;
  ppq?: number;
  trackIndexByRole: Partial<Record<ExprRole, number>>;
  path?: Path;
}): TrackPart[] {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const parts: TrackPart[] = [];

  for (const role of KIT) {
    const trackIndex = opts.trackIndexByRole[role];
    if (trackIndex == null) continue;
    const events: NoteEvent[] = [];

    for (let si = 0; si < opts.sections.length; si++) {
      const section = opts.sections[si]!;
      const next = opts.sections[si + 1]?.kind ?? null;
      const tier = drumTier(section.energy, opts.density);
      const base = roleGene(opts.rhythmGenes, role, tier);

      // drop-cut: silence kit on last beat of section before drop
      const dropCut =
        section.transitionIn === "drop-cut" ||
        (next === "drop" && section.kind === "build");

      for (let b = 0; b < section.bars; b++) {
        const level = levelForBar(section, b, next);
        let gene = geneForLevel(base, role, level);
        if (dropCut && b === section.bars - 1) {
          // Keep only onsets before last beat (steps 0..11)
          gene = geneFromOnsets(
            gene.onsets.filter((o) => o < 12),
            16,
          );
        }
        const barStart = (section.startBar + b) * tpb;
        const hits = geneToBarTicks(gene, barStart, ppq);
        for (const h of hits) {
          events.push({
            tick: h.tick,
            durTick: hitDur(role, ppq),
            midi: null,
            vel: h.vel,
            accent: h.accent,
            tag: level === "fill" ? "fill" : h.accent ? undefined : "ghost",
          });
        }
      }
    }

    parts.push({
      trackIndex,
      role,
      layerTier: 0,
      events,
    });
  }
  return parts;
}

/** Jaccard similarity of onset step sets (0..15) between two event lists in a window. */
export function onsetJaccard(
  a: readonly NoteEvent[],
  b: readonly NoteEvent[],
  startTick: number,
  endTick: number,
  ppq: number,
): number {
  const t16 = ppq / 4;
  const steps = (evs: readonly NoteEvent[]) => {
    const s = new Set<number>();
    for (const e of evs) {
      if (e.tick < startTick || e.tick >= endTick) continue;
      s.add(Math.round((e.tick - startTick) / t16) % 16);
    }
    return s;
  };
  const A = steps(a);
  const B = steps(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}
