/**
 * Reference banks for generative arrangement — chords, melodies, form flavours.
 * Degrees are scale indices (0 = tonic …) unless noted as chord tones within the degree.
 */

export type ChordTone = 0 | 2 | 4 | 6; // root / 3rd / 5th / 7th relative to chord degree

export type ChordEvent = {
  /** Scale degree of the chord root (0=I …). */
  degree: number;
  /** Optional voicing stack as chord-tone offsets. */
  tones?: readonly ChordTone[];
  /** Hold length in bars (default 1). */
  bars?: number;
};

export type MelodyEvent = {
  /** Scale degree (+ optional octave via ±7). */
  degree: number;
  /** Duration in 16ths of a beat (1 = 16th, 4 = beat). */
  sixteenths: number;
  accent?: boolean;
};

/** Pop / rock staples. */
export const POP_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0 }, { degree: 4 }, { degree: 5 }, { degree: 3 }],
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 3 }, { degree: 4 }, { degree: 3 }],
  [{ degree: 5 }, { degree: 3 }, { degree: 0 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 4 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 2 }, { degree: 3 }, { degree: 4 }],
];

export const MINOR_POP_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0 }, { degree: 6 }, { degree: 5 }, { degree: 6 }],
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 3 }, { degree: 5 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 4 }, { degree: 5 }, { degree: 3 }],
];

/** Modal / folk colour. */
export const MODAL_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0, bars: 2 }, { degree: 5, bars: 2 }], // drone I–VI
  [{ degree: 0 }, { degree: 1 }, { degree: 0 }, { degree: 4 }], // Mixolyd-ish
  [{ degree: 0, bars: 2 }, { degree: 3, bars: 1 }, { degree: 4, bars: 1 }],
  [{ degree: 0 }, { degree: 6 }, { degree: 0 }, { degree: 5 }],
  [
    { degree: 0, tones: [0, 2, 4] },
    { degree: 4, tones: [0, 2, 4] },
    { degree: 3, tones: [0, 2, 4] },
    { degree: 0, tones: [0, 2, 4, 6] },
  ],
];

/** Jazz-ish turnarounds (degree indices into major/minor scale). */
export const JAZZ_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [
    { degree: 1, tones: [0, 2, 4, 6] },
    { degree: 4, tones: [0, 2, 4, 6] },
    { degree: 0, tones: [0, 2, 4] },
    { degree: 0, tones: [0, 2, 4, 6] },
  ],
  [
    { degree: 0, tones: [0, 2, 4] },
    { degree: 5, tones: [0, 2, 4, 6] },
    { degree: 1, tones: [0, 2, 4, 6] },
    { degree: 4, tones: [0, 2, 4, 6] },
  ],
  [
    { degree: 2, tones: [0, 2, 4] },
    { degree: 5, tones: [0, 2, 4, 6] },
    { degree: 0, tones: [0, 2, 4] },
    { degree: 0, bars: 1 },
  ],
];

/** Ambient / field — slow harmonic rhythm, sparse colour. */
export const AMBIENT_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0, bars: 4, tones: [0, 4] }],
  [
    { degree: 0, bars: 2, tones: [0, 2, 4] },
    { degree: 3, bars: 2, tones: [0, 4] },
  ],
  [
    { degree: 0, bars: 3, tones: [0, 4] },
    { degree: 5, bars: 1, tones: [0, 2] },
  ],
  [
    { degree: 5, bars: 2, tones: [0, 4] },
    { degree: 0, bars: 2, tones: [0, 2, 4] },
  ],
  [
    { degree: 0, bars: 2 },
    { degree: 4, bars: 2 },
    { degree: 3, bars: 4 },
  ],
];

/** Short melodic cells (scale degrees, duration in 16ths). */
export const MELODY_CELLS: readonly (readonly MelodyEvent[])[] = [
  // Rising arpeggio
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 7, sixteenths: 4 },
  ],
  // Neighbour ornament
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 1, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Call fragment
  [
    { degree: 4, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 8 },
  ],
  // Response fragment
  [
    { degree: 5, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 3, sixteenths: 4 },
    { degree: 0, sixteenths: 4, accent: true },
  ],
  // Syncopated leaps
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 4 },
    { degree: 5, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
  ],
  // Sparse ambient
  [
    { degree: 0, sixteenths: 8, accent: true },
    { degree: 4, sixteenths: 8 },
  ],
  // Descending sigh
  [
    { degree: 7, sixteenths: 4, accent: true },
    { degree: 5, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
  ],
  // Pentatonic skip (degrees 0,1,2,4,5 feel)
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 8 },
  ],
];

export type HarmonicPalette =
  | "pop"
  | "modal"
  | "jazz"
  | "ambient"
  | "mixed";

export function pickProgressionBank(
  palette: HarmonicPalette,
  minor: boolean,
  rnd: () => number,
): readonly ChordEvent[] {
  const roll = rnd();
  let bank: readonly (readonly ChordEvent[])[];
  switch (palette) {
    case "ambient":
      bank = AMBIENT_PROGRESSIONS;
      break;
    case "jazz":
      bank = JAZZ_PROGRESSIONS;
      break;
    case "modal":
      bank = MODAL_PROGRESSIONS;
      break;
    case "mixed":
      if (roll < 0.35) bank = AMBIENT_PROGRESSIONS;
      else if (roll < 0.55) bank = MODAL_PROGRESSIONS;
      else if (roll < 0.7) bank = JAZZ_PROGRESSIONS;
      else
        bank = minor ? MINOR_POP_PROGRESSIONS : POP_PROGRESSIONS;
      break;
    case "pop":
    default:
      bank = minor ? MINOR_POP_PROGRESSIONS : POP_PROGRESSIONS;
      break;
  }
  return bank[Math.floor(rnd() * bank.length)] ?? bank[0]!;
}

/** Expand chord events into a per-bar degree (+ optional tones) timeline. */
export function expandChordTimeline(
  progression: readonly ChordEvent[],
  bars: number,
): Array<{ degree: number; tones: readonly ChordTone[] }> {
  const cycle: Array<{ degree: number; tones: readonly ChordTone[] }> = [];
  for (const ev of progression) {
    const n = Math.max(1, ev.bars ?? 1);
    const tones = ev.tones ?? ([0, 2, 4] as const);
    for (let i = 0; i < n; i++) {
      cycle.push({ degree: ev.degree, tones });
    }
  }
  if (cycle.length === 0) {
    return Array.from({ length: bars }, () => ({
      degree: 0,
      tones: [0, 2, 4] as const,
    }));
  }
  const out: Array<{ degree: number; tones: readonly ChordTone[] }> = [];
  for (let b = 0; b < bars; b++) {
    out.push(cycle[b % cycle.length]!);
  }
  return out;
}

export function pickMelodyCell(
  rnd: () => number,
  sparse: boolean,
): readonly MelodyEvent[] {
  const pool = sparse
    ? MELODY_CELLS.filter((c) => c.reduce((s, e) => s + e.sixteenths, 0) >= 12)
    : MELODY_CELLS;
  const src = pool.length > 0 ? pool : MELODY_CELLS;
  return src[Math.floor(rnd() * src.length)] ?? src[0]!;
}
