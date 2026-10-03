import { int, pick } from "./rng.js";
import type { Rng } from "./types.js";
import type {
  EnergyShape,
  FormFamily,
  Path,
  Section,
  SectionKind,
} from "./types.js";

export type FormPlan = {
  sections: Section[];
  totalBars: number;
  family: FormFamily;
  warnings: string[];
};

type KindSpec = { kind: SectionKind; phrase?: Section["phrase"] };

/** Skeleton templates (kinds only — lengths filled by fitForm). */
const GRAMMARS: Record<FormFamily, KindSpec[]> = {
  "verse-chorus": [
    { kind: "intro", phrase: "loop" },
    { kind: "verse", phrase: "period" },
    { kind: "prechorus", phrase: "sentence" },
    { kind: "chorus", phrase: "sentence" },
    { kind: "verse", phrase: "period" },
    { kind: "prechorus", phrase: "sentence" },
    { kind: "chorus", phrase: "sentence" },
    { kind: "bridge", phrase: "period" },
    { kind: "chorus", phrase: "sentence" },
    { kind: "outro", phrase: "loop" },
  ],
  aaba: [
    { kind: "intro", phrase: "loop" },
    { kind: "verse", phrase: "period" },
    { kind: "verse", phrase: "period" },
    { kind: "bridge", phrase: "sentence" },
    { kind: "verse", phrase: "period" },
    { kind: "outro", phrase: "loop" },
  ],
  "build-drop": [
    { kind: "intro", phrase: "loop" },
    { kind: "build", phrase: "sentence" },
    { kind: "drop", phrase: "loop" },
    { kind: "break", phrase: "loop" },
    { kind: "build", phrase: "sentence" },
    { kind: "drop", phrase: "loop" },
    { kind: "outro", phrase: "loop" },
  ],
  arch: [
    { kind: "intro", phrase: "loop" },
    { kind: "verse", phrase: "period" },
    { kind: "bridge", phrase: "sentence" },
    { kind: "chorus", phrase: "sentence" },
    { kind: "bridge", phrase: "sentence" },
    { kind: "verse", phrase: "period" },
    { kind: "outro", phrase: "loop" },
  ],
  rondo: [
    { kind: "verse", phrase: "period" },
    { kind: "chorus", phrase: "sentence" },
    { kind: "verse", phrase: "period" },
    { kind: "bridge", phrase: "sentence" },
    { kind: "verse", phrase: "period" },
  ],
  "loop-evolve": [
    { kind: "intro", phrase: "loop" },
    { kind: "verse", phrase: "loop" },
    { kind: "verse", phrase: "loop" },
    { kind: "verse", phrase: "loop" },
    { kind: "verse", phrase: "loop" },
    { kind: "outro", phrase: "loop" },
  ],
};

const ALLOWED: ReadonlyArray<2 | 4 | 8 | 16> = [2, 4, 8, 16];

function defaultPhrase(kind: SectionKind): Section["phrase"] {
  if (kind === "verse" || kind === "bridge") return "period";
  if (kind === "chorus" || kind === "prechorus" || kind === "build") {
    return "sentence";
  }
  return "loop";
}

function regionForKind(kind: SectionKind, occurrence: number): number {
  if (kind === "bridge" || kind === "break") return 5; // relative / away lean
  if (kind === "chorus" && occurrence >= 2) return 0;
  return 0;
}

function transitionIn(
  kind: SectionKind,
  prev: SectionKind | null,
): Section["transitionIn"] {
  if (!prev) return "none";
  if (kind === "drop" || kind === "chorus") {
    if (prev === "build" || prev === "prechorus") return "drop-cut";
    return "fill";
  }
  if (kind === "build" || kind === "prechorus") return "riser";
  return "none";
}

/** Energy 0..1 for section index along a shape. */
export function energyAt(
  shape: EnergyShape,
  index: number,
  count: number,
  kind: SectionKind,
): number {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  let base: number;
  switch (shape) {
    case "rise":
      base = 0.25 + t * 0.7;
      break;
    case "arch":
      base = 0.3 + Math.sin(t * Math.PI) * 0.55;
      break;
    case "waves":
      base = 0.4 + Math.sin(t * Math.PI * 2) * 0.25 + t * 0.15;
      break;
    case "plateau":
      base = 0.55;
      break;
  }
  if (kind === "chorus" || kind === "drop") base = Math.max(base, 0.72);
  if (kind === "build" || kind === "prechorus") base = Math.max(base, 0.6);
  // Intro/outro quieter than chorus, but high enough that beds + light kit pass enterAt
  if (kind === "intro") base = Math.min(Math.max(base, 0.28), 0.42);
  if (kind === "outro") base = Math.min(Math.max(base, 0.3), 0.45);
  if (kind === "break") base = Math.min(base, 0.4);
  if (kind === "bridge") base = Math.min(Math.max(base, 0.35), 0.55);
  return Math.min(1, Math.max(0, base));
}

/** Boost last chorus/drop above earlier peaks (except arch/plateau). */
function applyPeakChorus(
  sections: Section[],
  shape: EnergyShape,
): void {
  if (shape === "arch" || shape === "plateau") return;
  let peak = 0;
  for (const s of sections) {
    if (s.kind === "chorus" || s.kind === "drop") {
      peak = Math.max(peak, s.energy);
    }
  }
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    if (s.kind === "chorus" || s.kind === "drop") {
      s.energy = Math.min(1, Math.max(s.energy, peak + 0.05, 0.85));
      break;
    }
  }
}

function pickLength(
  r: Rng,
  path: Path,
  kind: SectionKind,
  allow2: boolean,
): 2 | 4 | 8 | 16 {
  if (allow2 && (kind === "intro" || kind === "outro" || kind === "break")) {
    if (r(`${path}/len2`) < 0.35) return 2;
  }
  if (kind === "intro" || kind === "outro" || kind === "break") {
    return r(`${path}/len`) < 0.55 ? 4 : 8;
  }
  if (kind === "chorus" || kind === "drop" || kind === "bridge") return 8;
  if (kind === "build" || kind === "prechorus") {
    return r(`${path}/len`) < 0.4 ? 4 : 8;
  }
  // verse
  return r(`${path}/len`) < 0.3 ? 4 : 8;
}

function trimGrammar(
  family: FormFamily,
  targetBars: number,
  r: Rng,
): KindSpec[] {
  let specs = GRAMMARS[family].slice();
  // Short forms: drop optional middle pieces
  if (targetBars <= 16) {
    specs = specs.filter(
      (s) =>
        s.kind !== "bridge" &&
        s.kind !== "prechorus" &&
        s.kind !== "break",
    );
    // Keep at most one verse + one chorus (+ intro/outro if present)
    const seen = new Set<SectionKind>();
    specs = specs.filter((s) => {
      if (s.kind === "intro" || s.kind === "outro") return targetBars >= 12;
      if (seen.has(s.kind) && (s.kind === "verse" || s.kind === "chorus")) {
        return false;
      }
      seen.add(s.kind);
      return true;
    });
  } else if (targetBars <= 32) {
    // Drop second prechorus; keep one bridge max
    let pre = 0;
    let bridge = 0;
    specs = specs.filter((s) => {
      if (s.kind === "prechorus") {
        pre += 1;
        return pre <= 1;
      }
      if (s.kind === "bridge") {
        bridge += 1;
        return bridge <= 1;
      }
      return true;
    });
  }
  if (specs.length === 0) {
    return [{ kind: "verse", phrase: "loop" }];
  }
  // Deterministic shuffle salt unused — keep order; optional drop one chorus repeat
  if (targetBars <= 24 && specs.filter((s) => s.kind === "chorus").length > 2) {
    let c = 0;
    specs = specs.filter((s) => {
      if (s.kind !== "chorus") return true;
      c += 1;
      return c <= 2;
    });
  }
  void r;
  return specs;
}

/**
 * Assign 4/8/16 (or 2 if total≤8) so sum ≈ targetBars; round to nearest
 * carrure and warn when adjusted.
 */
export function fitForm(opts: {
  targetBars: number;
  family: FormFamily;
  energyShape: EnergyShape;
  energyBias: number;
  rng: Rng;
  path?: Path;
}): FormPlan {
  const path = opts.path ?? "form";
  const warnings: string[] = [];
  const target = Math.max(4, Math.round(opts.targetBars));
  const allow2 = target <= 8;
  const specs = trimGrammar(opts.family, target, opts.rng);

  // Initial lengths
  let lengths: Array<2 | 4 | 8 | 16> = specs.map((s, i) =>
    pickLength(opts.rng, `${path}/sec:${i}/${s.kind}`, s.kind, allow2),
  );

  const sum = () => lengths.reduce((a, b) => a + b, 0);
  let total = sum();

  // Grow / shrink by flipping section lengths toward target
  let guard = 0;
  while (total < target - 3 && guard++ < 40) {
    const i = int(opts.rng, `${path}/grow/${guard}`, 0, lengths.length - 1);
    const cur = lengths[i]!;
    const next =
      cur === 2 ? 4 : cur === 4 ? 8 : cur === 8 ? 16 : 16;
    if (next !== cur) {
      lengths[i] = next as 2 | 4 | 8 | 16;
      total = sum();
    } else break;
  }
  guard = 0;
  while (total > target + 3 && guard++ < 40) {
    // Prefer shrinking longest non-chorus first
    let best = -1;
    let bestBars = -1;
    for (let i = 0; i < lengths.length; i++) {
      const k = specs[i]!.kind;
      const b = lengths[i]!;
      if (b <= (allow2 ? 2 : 4)) continue;
      if (k === "chorus" || k === "drop") continue;
      if (b > bestBars) {
        bestBars = b;
        best = i;
      }
    }
    if (best < 0) {
      for (let i = 0; i < lengths.length; i++) {
        if (lengths[i]! > (allow2 ? 2 : 4) && lengths[i]! > bestBars) {
          bestBars = lengths[i]!;
          best = i;
        }
      }
    }
    if (best < 0) break;
    const cur = lengths[best]!;
    lengths[best] = (cur === 16 ? 8 : cur === 8 ? 4 : 2) as 2 | 4 | 8 | 16;
    total = sum();
  }

  if (!allow2) {
    lengths = lengths.map((b) => (b === 2 ? 4 : b));
    total = sum();
  }

  if (Math.abs(total - target) > 0) {
    warnings.push(
      `form: adjusted length ${target} → ${total} bars (carrure)`,
    );
  }

  const occ = new Map<SectionKind, number>();
  const sections: Section[] = [];
  let startBar = 0;
  let prev: SectionKind | null = null;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const occurrence = occ.get(spec.kind) ?? 0;
    occ.set(spec.kind, occurrence + 1);
    const bars = lengths[i]!;
    let energy = energyAt(opts.energyShape, i, specs.length, spec.kind);
    energy = Math.min(1, Math.max(0, energy + (opts.energyBias - 0.5) * 0.35));
    sections.push({
      id: `${spec.kind}#${occurrence}`,
      kind: spec.kind,
      startBar,
      bars,
      phrase: spec.phrase ?? defaultPhrase(spec.kind),
      energy,
      occurrence,
      region: regionForKind(spec.kind, occurrence),
      transitionIn: transitionIn(spec.kind, prev),
    });
    startBar += bars;
    prev = spec.kind;
  }
  applyPeakChorus(sections, opts.energyShape);

  return {
    sections,
    totalBars: startBar,
    family: opts.family,
    warnings,
  };
}

export function pickFormFamily(
  r: Rng,
  path: Path,
  styleHint?: FormFamily | "auto",
): FormFamily {
  if (styleHint && styleHint !== "auto") return styleHint;
  return pick(r, path, [
    "verse-chorus",
    "aaba",
    "build-drop",
    "arch",
    "rondo",
    "loop-evolve",
  ] as const);
}

export function pickEnergyShape(
  r: Rng,
  path: Path,
  forced?: EnergyShape | "auto",
): EnergyShape {
  if (forced && forced !== "auto") return forced;
  return pick(r, path, ["rise", "arch", "waves", "plateau"] as const);
}

/** Carrure invariant: bars ∈ {4,8,16} or 2 only if total ≤ 8. */
export function assertCarrure(sections: readonly Section[]): boolean {
  const total = sections.reduce((s, x) => s + x.bars, 0);
  for (const s of sections) {
    if (s.bars === 2) {
      if (total > 8) return false;
      continue;
    }
    if (!(ALLOWED as readonly number[]).includes(s.bars)) return false;
  }
  return true;
}
