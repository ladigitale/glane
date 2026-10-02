import { PPQ } from "@glane/core-model";
import { MODE_SCALE } from "./harmony.js";
import { int, pick } from "./rng.js";
import type {
  ChordSlot,
  ModeId,
  Motif,
  NoteEvent,
  Path,
  Rng,
  Section,
  TrackPart,
} from "./types.js";

function chordAt(
  harmony: readonly ChordSlot[],
  bar: number,
  beat: number,
): ChordSlot | null {
  let best: ChordSlot | null = null;
  for (const c of harmony) {
    const start = c.bar * 4 + c.beat;
    const end = start + c.durBeats;
    const t = bar * 4 + beat;
    if (t >= start && t < end) best = c;
  }
  return best;
}

/** Absolute scale degree → MIDI (octave chosen per phrase). */
export function degreeToMidi(
  degree: number,
  mode: ModeId,
  keyPc: number,
  octave: number,
): number {
  const scale = MODE_SCALE[mode];
  const n = scale.length;
  const oct = Math.floor(degree / n) + octave;
  const idx = ((degree % n) + n) % n;
  return oct * 12 + keyPc + scale[idx]!;
}

export function generateMotifContour(
  r: Rng,
  path: Path,
  notes: number,
): number[] {
  // Intervals in scale degrees
  const shapes = [
    [0, 2, 0, -1],
    [0, 1, 2, 0],
    [0, 4, 2, 0],
    [2, 0, -1, 0],
    [0, 2, 4, 2],
  ];
  const base = pick(r, `${path}/shape`, shapes);
  const out: number[] = [];
  let d = int(r, `${path}/start`, 0, 4);
  for (let i = 0; i < notes; i++) {
    out.push(d);
    d += base[i % base.length]!;
    d = Math.min(8, Math.max(-2, d));
  }
  return out;
}

export function buildMotif(
  r: Rng,
  path: Path,
  rhythm: Motif["rhythm"],
  kind: "hook" | "verse",
): Motif {
  const n = Math.max(2, rhythm.onsets.length);
  let contour = generateMotifContour(r, `${path}/c`, n);
  if (kind === "verse") {
    contour = contour.map((d) => Math.round(d * 0.6));
  }
  return { rhythm, contour, lengthBeats: 4 };
}

type DegHit = { step16: number; degree: number; accent: boolean; tag?: NoteEvent["tag"] };

function motifHits(motif: Motif): DegHit[] {
  return motif.rhythm.onsets.map((step, i) => ({
    step16: step,
    degree: motif.contour[i] ?? motif.contour[motif.contour.length - 1] ?? 0,
    accent: (motif.rhythm.accents[i] ?? 0.5) >= 0.7,
  }));
}

function sequenceHits(hits: DegHit[], delta: number): DegHit[] {
  return hits.map((h) => ({ ...h, degree: h.degree + delta }));
}

function invertHits(hits: DegHit[]): DegHit[] {
  if (hits.length === 0) return hits;
  const pivot = hits[0]!.degree;
  return hits.map((h) => ({ ...h, degree: pivot - (h.degree - pivot) }));
}

function ornamentHits(hits: DegHit[]): DegHit[] {
  const out: DegHit[] = [];
  for (const h of hits) {
    out.push(h);
    if (!h.accent && h.step16 < 15) {
      out.push({
        step16: h.step16 + 1,
        degree: h.degree + 1,
        accent: false,
        tag: "variation",
      });
    }
  }
  return out;
}

/** Build one section phrase in absolute degrees (still pre-MIDI). */
export function phraseDegrees(
  section: Section,
  motif: Motif,
  cadenceTarget: number,
): DegHit[] {
  const base = motifHits(motif);
  const bars = section.bars;
  const out: DegHit[] = [];

  const place = (hits: DegHit[], barOffset: number) => {
    for (const h of hits) {
      out.push({
        ...h,
        step16: h.step16 + barOffset * 16,
      });
    }
  };

  if (section.phrase === "period" && bars >= 8) {
    // antecedent 4 bars → half cadence degree 4/1
    place(base, 0);
    place(sequenceHits(base, 0), 2);
    // consequent: same start, end on tonic
    place(base, 4);
    const cons = sequenceHits(base, 0);
    if (cons.length) {
      cons[cons.length - 1] = {
        ...cons[cons.length - 1]!,
        degree: cadenceTarget,
        tag: "cadence",
        accent: true,
      };
    }
    place(cons, 6);
  } else if (section.phrase === "sentence" && bars >= 8) {
    place(base, 0);
    place(sequenceHits(base, 2), 2); // a'
    const b = ornamentHits(sequenceHits(base, 1));
    if (b.length) {
      b[b.length - 1] = {
        ...b[b.length - 1]!,
        degree: cadenceTarget,
        tag: "cadence",
        accent: true,
      };
    }
    place(b, 4);
  } else {
    // loop: repeat motif each 4 bars with optional variation
    for (let b = 0; b < bars; b += 4) {
      const chunk =
        b > 0 && b % 8 === 4 ? sequenceHits(base, 1) : base;
      place(chunk, b);
    }
    if (out.length) {
      out[out.length - 1] = {
        ...out[out.length - 1]!,
        degree: cadenceTarget,
        tag: "cadence",
        accent: true,
      };
    }
  }

  // Clamp ambitus ~ 9 degrees
  return out.map((h) => ({
    ...h,
    degree: Math.min(8, Math.max(-1, h.degree)),
  }));
}

function snapToChordTone(
  degree: number,
  slot: ChordSlot | null,
  mode: ModeId,
  accent: boolean,
): number {
  if (!slot || !accent) return degree;
  const scale = MODE_SCALE[mode];
  const n = scale.length;
  // Chord tones as scale degrees relative to tonic: slot.degree, +2, +4
  const tones = [0, 2, 4].map((t) => (slot.degree + t) % n);
  let best = tones[0]!;
  let bestDist = Infinity;
  for (const t of tones) {
    // map degree into 0..n-1 class
    const d = ((degree % n) + n) % n;
    const dist = Math.min(
      Math.abs(d - t),
      Math.abs(d - t + n),
      Math.abs(d - t - n),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = t + Math.floor(degree / n) * n;
    }
  }
  return best;
}

function phraseOctave(section: Section, baseOctave: number): number {
  if (section.kind === "chorus" || section.kind === "drop") {
    return baseOctave + 1;
  }
  if (section.kind === "prechorus" || section.kind === "build") {
    return baseOctave;
  }
  if (section.kind === "bridge") return baseOctave;
  return baseOctave - (section.kind === "verse" ? 0 : 0);
}

/**
 * Lead (and optional chord pad hits) from hook / verse motifs.
 * MIDI uses absolute scale degrees; octave fixed per phrase.
 */
export function planMelody(opts: {
  sections: readonly Section[];
  harmony: readonly ChordSlot[];
  hook: Motif;
  verseMotif: Motif;
  mode: ModeId;
  keyPc: number;
  trackIndex: number;
  role?: "lead" | "chord";
  ppq?: number;
  path?: Path;
}): TrackPart {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const t16 = ppq / 4;
  const role = opts.role ?? "lead";
  const baseOct = role === "chord" ? 4 : 5;
  const events: NoteEvent[] = [];

  for (const section of opts.sections) {
    if (section.kind === "intro" && section.occurrence === 0 && role === "lead") {
      continue; // lead enters later via matrix usually
    }
    if (section.kind === "break") continue;

    const motif =
      section.kind === "chorus" ||
      section.kind === "drop" ||
      section.kind === "prechorus"
        ? opts.hook
        : section.kind === "bridge"
          ? {
              ...opts.hook,
              contour: invertHits(motifHits(opts.hook)).map((h) => h.degree),
            }
          : opts.verseMotif;

    const cadenceTarget =
      section.phrase === "period" ? 0 : section.kind === "chorus" ? 0 : 0;
    const hits = phraseDegrees(section, motif, cadenceTarget);
    const oct = phraseOctave(section, baseOct);
    const isHookSection =
      section.kind === "chorus" || section.kind === "drop";

    for (const h of hits) {
      const barIn = Math.floor(h.step16 / 16);
      if (barIn >= section.bars) continue;
      const step = h.step16 % 16;
      const bar = section.startBar + barIn;
      const beat = Math.floor(step / 4);
      const slot = chordAt(opts.harmony, bar, beat);
      let deg = h.degree;
      if (role === "lead") {
        deg = snapToChordTone(deg, slot, opts.mode, h.accent);
      } else if (slot) {
        deg = slot.degree; // chord pad = root
      }
      const midi = degreeToMidi(deg, opts.mode, opts.keyPc, oct);
      const tick = bar * tpb + step * t16;
      events.push({
        tick,
        durTick: role === "chord" ? Math.floor(ppq) : Math.floor(ppq / 2),
        midi,
        vel: h.accent ? 0.85 : 0.55,
        accent: h.accent,
        tag: h.tag ?? (isHookSection && barIn < 2 ? "hook" : undefined),
      });
    }
  }

  return {
    trackIndex: opts.trackIndex,
    role,
    layerTier: 2,
    events,
  };
}

export function invertMotif(motif: Motif): Motif {
  const hits = invertHits(motifHits(motif));
  return {
    ...motif,
    contour: hits.map((h) => h.degree),
  };
}
