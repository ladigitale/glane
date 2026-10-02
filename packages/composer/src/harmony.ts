import { pick } from "./rng.js";
import type { Rng } from "./types.js";
import type {
  ChordSlot,
  ModeId,
  Path,
  Progression,
  Section,
  SectionKind,
} from "./types.js";

/** Semitone offsets from tonic for each mode. */
export const MODE_SCALE: Record<ModeId, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
  pentaMaj: [0, 2, 4, 7, 9],
  pentaMin: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

type Func = "T" | "SD" | "D";

const DEGREE_FUNC: Record<number, Func> = {
  0: "T",
  1: "SD",
  2: "T",
  3: "SD",
  4: "D",
  5: "T",
  6: "D",
};

function qualityFor(degree: number, mode: ModeId): string {
  const scale = MODE_SCALE[mode];
  if (scale.length < 5) return "5";
  const root = scale[degree % scale.length]!;
  const third = scale[(degree + 2) % scale.length]!;
  const thirdInt = (third - root + 12) % 12;
  if (thirdInt === 4) return "maj";
  if (thirdInt === 3) return "min";
  return "5";
}

function tonesPc(
  degree: number,
  mode: ModeId,
  keyPc: number,
  region: number,
): number[] {
  const scale = MODE_SCALE[mode];
  const n = scale.length;
  const out: number[] = [];
  for (const step of [0, 2, 4]) {
    const idx = (degree + step) % n;
    out.push((scale[idx]! + keyPc + region + 120) % 12);
  }
  return out;
}

/** Close-position triad near center; minimise Σ|Δ| vs previous voicing. */
function voiceLead(
  prev: number[] | null,
  tones: number[],
  centerMidi: number,
): number[] {
  const candidates: number[][] = [];
  for (const octShift of [-12, 0, 12]) {
    for (let inv = 0; inv < tones.length; inv++) {
      const ordered = [...tones.slice(inv), ...tones.slice(0, inv)];
      const stacked: number[] = [];
      let floor = centerMidi - 8 + octShift;
      for (const pc of ordered) {
        let m = Math.floor(floor / 12) * 12 + pc;
        while (m < floor) m += 12;
        stacked.push(m);
        floor = m + 1;
      }
      candidates.push(stacked);
    }
  }
  if (!prev) {
    return (
      candidates.sort(
        (a, b) =>
          Math.abs(a.reduce((s, x) => s + x, 0) / a.length - centerMidi) -
          Math.abs(b.reduce((s, x) => s + x, 0) / b.length - centerMidi),
      )[0] ?? tones.map((pc) => 60 + pc)
    );
  }
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = c.reduce(
      (s, m, i) => s + Math.abs(m - (prev[i] ?? prev[prev.length - 1]!)),
      0,
    );
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Generate a functional progression of exact duration in beats. */
export function generateProgression(
  r: Rng,
  path: Path,
  totalBeats: number,
  kind: "home" | "lift" | "away",
  mode: ModeId,
): Progression {
  const slots: Progression["slots"] = [];
  const unit = totalBeats % 8 === 0 && totalBeats >= 16 ? 4 : 2;
  let remaining = totalBeats;
  const funcCycle: Func[] =
    kind === "away"
      ? ["SD", "T", "SD", "D"]
      : kind === "lift"
        ? ["T", "SD", "D", "T"]
        : ["T", "SD", "D", "T"];
  const degPool: Record<Func, number[]> = {
    T: [0, 2, 5],
    SD: [1, 3, 5],
    D: [4, 6],
  };

  let i = 0;
  while (remaining > 0) {
    const dur = Math.min(unit, remaining);
    const fn = funcCycle[i % funcCycle.length]!;
    let degree = pick(r, `${path}/deg/${i}`, degPool[fn]);
    if (fn === "SD" && r(`${path}/sub/${i}`) < 0.25) degree = 1;
    if (kind === "away" && i === 0) {
      degree = pick(r, `${path}/away`, [5, 3, 2]);
    }
    slots.push({
      degree,
      quality: qualityFor(degree, mode),
      durBeats: dur,
    });
    remaining -= dur;
    i += 1;
  }
  if (slots.length > 0 && kind === "home") {
    const last = slots[slots.length - 1]!;
    last.degree = 0;
    last.quality = qualityFor(0, mode);
  }
  return { id: `${kind}:${path}`, slots };
}

function applyCadences(
  slots: ChordSlot[],
  section: Section,
  mode: ModeId,
  keyPc: number,
): void {
  if (slots.length === 0) return;
  const phrase = section.phrase;
  const bars = section.bars;

  if ((phrase === "period" || phrase === "sentence") && bars >= 8) {
    const halfBar = section.startBar + 3;
    const half =
      slots.find((s) => s.bar === halfBar) ??
      slots[Math.floor(slots.length / 2) - 1];
    if (half) {
      half.degree = 4;
      half.function = "D";
      half.cadence = "half";
      half.quality = qualityFor(4, mode);
      half.tonesPc = tonesPc(4, mode, keyPc, section.region);
    }
  }

  const last = slots[slots.length - 1]!;
  last.degree = 0;
  last.function = "T";
  last.cadence = "authentic";
  last.quality = qualityFor(0, mode);
  last.tonesPc = tonesPc(0, mode, keyPc, section.region);

  if (slots.length >= 2) {
    const prev = slots[slots.length - 2]!;
    prev.degree = 4;
    prev.function = "D";
    prev.quality = qualityFor(4, mode);
    prev.tonesPc = tonesPc(4, mode, keyPc, section.region);
  }
}

function slotsFromProgression(
  prog: Progression,
  section: Section,
  mode: ModeId,
  keyPc: number,
  centerMidi: number,
  prevVoicing: number[] | null,
): { slots: ChordSlot[]; voicing: number[] | null } {
  const totalBeats = section.bars * 4;
  const raw = prog.slots;
  const scaled: Array<{ degree: number; quality: string; durBeats: number }> =
    [];
  const rawBeats = raw.reduce((s, x) => s + x.durBeats, 0) || 1;
  let acc = 0;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    let dur =
      i === raw.length - 1
        ? totalBeats - acc
        : Math.max(1, Math.round((s.durBeats / rawBeats) * totalBeats));
    if (acc + dur > totalBeats) dur = totalBeats - acc;
    if (dur <= 0) continue;
    scaled.push({ degree: s.degree, quality: s.quality, durBeats: dur });
    acc += dur;
  }
  if (acc < totalBeats && scaled.length > 0) {
    scaled[scaled.length - 1]!.durBeats += totalBeats - acc;
  }

  const slots: ChordSlot[] = [];
  let beatCursor = 0;
  let voicing = prevVoicing;
  for (const s of scaled) {
    const bar = section.startBar + Math.floor(beatCursor / 4);
    const beat = beatCursor % 4;
    const pcs = tonesPc(s.degree, mode, keyPc, section.region);
    voicing = voiceLead(voicing, pcs, centerMidi);
    slots.push({
      bar,
      beat,
      durBeats: s.durBeats,
      degree: s.degree,
      quality: s.quality,
      tonesPc: pcs,
      voicingMidi: voicing,
      function: DEGREE_FUNC[s.degree] ?? "T",
    });
    beatCursor += s.durBeats;
  }
  applyCadences(slots, section, mode, keyPc);
  for (const slot of slots) {
    slot.tonesPc = tonesPc(slot.degree, mode, keyPc, section.region);
    voicing = voiceLead(voicing, slot.tonesPc, centerMidi);
    slot.voicingMidi = voicing;
  }
  return { slots, voicing };
}

/**
 * Chord timeline: one grid per section phrase, exact length.
 * Same kind reuses the same progression (cadence may vary on returns).
 */
export function planHarmony(opts: {
  sections: readonly Section[];
  progressions: { home: Progression; lift: Progression; away: Progression };
  mode: ModeId;
  keyPc: number;
  rng: Rng;
  path?: Path;
}): ChordSlot[] {
  const path = opts.path ?? "harmony";
  const byKind = new Map<SectionKind, Progression>();
  const out: ChordSlot[] = [];
  let prevVoicing: number[] | null = null;
  const centerMidi = 60 + opts.keyPc;

  for (const section of opts.sections) {
    let prog = byKind.get(section.kind);
    if (!prog) {
      const which =
        section.kind === "bridge" || section.kind === "break"
          ? "away"
          : section.kind === "prechorus" ||
              section.kind === "build" ||
              section.kind === "chorus" ||
              section.kind === "drop"
            ? "lift"
            : "home";
      const base = opts.progressions[which];
      const needBeats = section.bars * 4;
      const baseBeats = base.slots.reduce((s, x) => s + x.durBeats, 0);
      prog =
        baseBeats === needBeats
          ? base
          : generateProgression(
              opts.rng,
              `${path}/${section.kind}`,
              needBeats,
              which,
              opts.mode,
            );
      byKind.set(section.kind, prog);
    }

    const { slots, voicing } = slotsFromProgression(
      prog,
      section,
      opts.mode,
      opts.keyPc,
      centerMidi,
      prevVoicing,
    );

    const chorusLike =
      section.kind === "chorus" || section.kind === "drop";
    if (
      chorusLike &&
      section.occurrence === 0 &&
      slots.length >= 1 &&
      opts.rng(`${path}/${section.id}/deceptive`) < 0.35
    ) {
      const last = slots[slots.length - 1]!;
      last.degree = 5;
      last.function = "T";
      last.cadence = "deceptive";
      last.quality = qualityFor(5, opts.mode);
      last.tonesPc = tonesPc(5, opts.mode, opts.keyPc, section.region);
      prevVoicing = voiceLead(voicing, last.tonesPc, centerMidi);
      last.voicingMidi = prevVoicing;
    } else {
      prevVoicing = voicing;
    }
    out.push(...slots);
  }
  return out;
}

/** Default DNA progressions (8 bars / 32 beats each). */
export function defaultProgressions(
  r: Rng,
  path: Path,
  mode: ModeId,
): { home: Progression; lift: Progression; away: Progression } {
  return {
    home: generateProgression(r, `${path}/home`, 32, "home", mode),
    lift: generateProgression(r, `${path}/lift`, 32, "lift", mode),
    away: generateProgression(r, `${path}/away`, 32, "away", mode),
  };
}

/** Last chord of a cadencing section = tonic (or deceptive VI). */
export function cadenceOk(
  sections: readonly Section[],
  harmony: readonly ChordSlot[],
): boolean {
  for (const sec of sections) {
    if (sec.kind === "intro" || sec.kind === "break") continue;
    const inSec = harmony.filter(
      (h) => h.bar >= sec.startBar && h.bar < sec.startBar + sec.bars,
    );
    if (inSec.length === 0) continue;
    const last = inSec[inSec.length - 1]!;
    if (last.cadence === "deceptive") {
      if (last.degree !== 5 && last.degree !== 2) return false;
      continue;
    }
    if (last.degree !== 0) return false;
  }
  return true;
}

/** Half cadence on bar 4 of period sections (≥8 bars). */
export function halfCadenceOk(
  sections: readonly Section[],
  harmony: readonly ChordSlot[],
): boolean {
  for (const sec of sections) {
    if (sec.phrase !== "period" || sec.bars < 8) continue;
    const at = harmony.find(
      (h) => h.bar === sec.startBar + 3 && h.cadence === "half",
    );
    if (!at || at.function !== "D") return false;
  }
  return true;
}

/** Exact phrase coverage: sum of durBeats per section = bars×4. */
export function phraseCoverageOk(
  sections: readonly Section[],
  harmony: readonly ChordSlot[],
): boolean {
  for (const sec of sections) {
    const beats = harmony
      .filter(
        (h) => h.bar >= sec.startBar && h.bar < sec.startBar + sec.bars,
      )
      .reduce((s, h) => s + h.durBeats, 0);
    if (beats !== sec.bars * 4) return false;
  }
  return true;
}
