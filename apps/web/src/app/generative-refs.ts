/**
 * Reference banks for generative arrangement — chords, melodies, form flavours.
 * Degrees are scale indices (0 = tonic …) unless noted as chord tones within the degree.
 *
 * These are public-domain harmonic skeletons (hit-song / folk / jazz clichés),
 * not copyrighted MIDI. The arranger tiles them to the sequence length and
 * reuses the same skeleton when a section kind returns (verse↔verse).
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
  /** Scale degree (+ optional octave via ±7), relative to the *current chord root*
   * after the arranger adds `chord.degree` (see generative pickPitch). */
  degree: number;
  /** Duration in 16ths of a beat (1 = 16th, 4 = beat). */
  sixteenths: number;
  accent?: boolean;
};

export type HarmonyBar = {
  degree: number;
  tones: readonly ChordTone[];
};

export type HarmonySectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro";

export type HarmonySectionIn = {
  kind: HarmonySectionKind;
  startBar: number;
  bars: number;
};

/** Pop / rock staples (4-bar cycles unless noted). */
export const POP_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  // Axis of Awesome / countless hits
  [{ degree: 0 }, { degree: 4 }, { degree: 5 }, { degree: 3 }],
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 3 }, { degree: 4 }, { degree: 0 }],
  [{ degree: 5 }, { degree: 3 }, { degree: 0 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 4 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 2 }, { degree: 3 }, { degree: 4 }],
  // 8-bar pop stretch
  [
    { degree: 0, bars: 2 },
    { degree: 4, bars: 2 },
    { degree: 5, bars: 2 },
    { degree: 3, bars: 2 },
  ],
  [
    { degree: 0 },
    { degree: 0 },
    { degree: 4 },
    { degree: 4 },
    { degree: 5 },
    { degree: 3 },
    { degree: 4 },
    { degree: 0 },
  ],
  // Doo-wop / 50s
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
  // Sensitive songwriter
  [{ degree: 0 }, { degree: 3 }, { degree: 5 }, { degree: 4 }],
  [{ degree: 5 }, { degree: 4 }, { degree: 0 }, { degree: 0 }],
  // Cadential close
  [
    { degree: 0, bars: 2 },
    { degree: 4, bars: 1 },
    { degree: 0, bars: 1 },
  ],
];

export const MINOR_POP_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0 }, { degree: 6 }, { degree: 5 }, { degree: 6 }],
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 3 }, { degree: 5 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 4 }, { degree: 5 }, { degree: 3 }],
  [{ degree: 0 }, { degree: 6 }, { degree: 3 }, { degree: 4 }],
  [
    { degree: 0, bars: 2 },
    { degree: 5, bars: 1 },
    { degree: 4, bars: 1 },
  ],
  [
    { degree: 0 },
    { degree: 0 },
    { degree: 6 },
    { degree: 6 },
    { degree: 5 },
    { degree: 5 },
    { degree: 4 },
    { degree: 4 },
  ],
  [{ degree: 0 }, { degree: 3 }, { degree: 4 }, { degree: 0 }],
];

/** Modal / folk colour. */
export const MODAL_PROGRESSIONS: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0, bars: 2 }, { degree: 5, bars: 2 }],
  [{ degree: 0 }, { degree: 1 }, { degree: 0 }, { degree: 4 }],
  [{ degree: 0, bars: 2 }, { degree: 3, bars: 1 }, { degree: 4, bars: 1 }],
  [{ degree: 0 }, { degree: 6 }, { degree: 0 }, { degree: 5 }],
  [
    { degree: 0, tones: [0, 2, 4] },
    { degree: 4, tones: [0, 2, 4] },
    { degree: 3, tones: [0, 2, 4] },
    { degree: 0, tones: [0, 2, 4, 6] },
  ],
  [{ degree: 0, bars: 3 }, { degree: 4, bars: 1 }],
  [{ degree: 0 }, { degree: 4 }, { degree: 0 }, { degree: 5 }],
  [
    { degree: 0, bars: 2 },
    { degree: 2, bars: 1 },
    { degree: 4, bars: 1 },
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
  [
    { degree: 0, tones: [0, 2, 4, 6] },
    { degree: 3, tones: [0, 2, 4, 6] },
    { degree: 1, tones: [0, 2, 4, 6] },
    { degree: 4, tones: [0, 2, 4, 6] },
  ],
  [
    { degree: 5, tones: [0, 2, 4, 6], bars: 2 },
    { degree: 4, tones: [0, 2, 4, 6], bars: 2 },
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
  [{ degree: 0, bars: 8, tones: [0, 4] }],
  [
    { degree: 0, bars: 4, tones: [0, 2] },
    { degree: 5, bars: 4, tones: [0, 4] },
  ],
];

/** Stronger / more open cycles for choruses. */
const CHORUS_POP: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0 }, { degree: 4 }, { degree: 5 }, { degree: 3 }],
  [{ degree: 5 }, { degree: 3 }, { degree: 0 }, { degree: 4 }],
  [
    { degree: 0, bars: 2 },
    { degree: 4, bars: 2 },
    { degree: 5, bars: 2 },
    { degree: 3, bars: 2 },
  ],
  [{ degree: 0 }, { degree: 5 }, { degree: 3 }, { degree: 4 }],
];

const CHORUS_MINOR: readonly (readonly ChordEvent[])[] = [
  [{ degree: 0 }, { degree: 6 }, { degree: 5 }, { degree: 4 }],
  [{ degree: 0 }, { degree: 3 }, { degree: 5 }, { degree: 4 }],
  [
    { degree: 0, bars: 2 },
    { degree: 5, bars: 2 },
    { degree: 3, bars: 2 },
    { degree: 4, bars: 2 },
  ],
];

const BRIDGE_POP: readonly (readonly ChordEvent[])[] = [
  [{ degree: 3 }, { degree: 4 }, { degree: 0 }, { degree: 0 }],
  [{ degree: 5 }, { degree: 4 }, { degree: 3 }, { degree: 4 }],
  [{ degree: 2 }, { degree: 4 }, { degree: 0 }, { degree: 4 }],
  [
    { degree: 3, bars: 2 },
    { degree: 4, bars: 2 },
  ],
];

const BRIDGE_MINOR: readonly (readonly ChordEvent[])[] = [
  [{ degree: 5 }, { degree: 4 }, { degree: 0 }, { degree: 0 }],
  [{ degree: 3 }, { degree: 4 }, { degree: 5 }, { degree: 4 }],
  [{ degree: 6 }, { degree: 5 }, { degree: 4 }, { degree: 0 }],
];

/** Short melodic cells — degrees relative to chord root once transposed. */
export const MELODY_CELLS: readonly (readonly MelodyEvent[])[] = [
  // Rising arpeggio (1–3–5–8)
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 7, sixteenths: 4 },
  ],
  // Neighbour ornament around root
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 1, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Call fragment (5–3–1)
  [
    { degree: 4, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 8 },
  ],
  // Response fragment (6–5–4–1)
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
  // Pentatonic skip
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 8 },
  ],
  // Hooky 1–5–6–5
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 5, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
  ],
  // Stepwise climb to 5
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 1, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 3, sixteenths: 2 },
    { degree: 4, sixteenths: 8, accent: true },
  ],
  // Broken triad + 7
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 6, sixteenths: 8 },
  ],
  // Long tones (pad-like lead)
  [
    { degree: 0, sixteenths: 8, accent: true },
    { degree: 2, sixteenths: 8 },
  ],
  // Anticipation into downbeat
  [
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 6, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Call–echo
  [
    { degree: 4, sixteenths: 4, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Sparse verse: held tonic → fifth
  [
    { degree: 0, sixteenths: 10, accent: true },
    { degree: 4, sixteenths: 6 },
  ],
  // Sparse verse: root–third breathe
  [
    { degree: 0, sixteenths: 6, accent: true },
    { degree: 2, sixteenths: 10 },
  ],
  // Sparse: octave drop answer prep
  [
    { degree: 7, sixteenths: 8, accent: true },
    { degree: 0, sixteenths: 8 },
  ],
  // Dense chorus hook 1–5–1–6
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
  ],
  // Dense chorus: syncopated climb
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 1 },
    { degree: 4, sixteenths: 1 },
    { degree: 5, sixteenths: 2 },
    { degree: 7, sixteenths: 2, accent: true },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 4 },
  ],
  // Dense: repeated motif + leap
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 4, sixteenths: 4 },
  ],
  // Dense: gallop turnaround
  [
    { degree: 4, sixteenths: 2, accent: true },
    { degree: 5, sixteenths: 1 },
    { degree: 4, sixteenths: 1 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 4, accent: true },
  ],
  // Mid: question rise
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 5, sixteenths: 4 },
  ],
  // Mid: resolve fall
  [
    { degree: 5, sixteenths: 4, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Pickup into downbeat (transition-friendly)
  [
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 8, accent: true },
    { degree: 4, sixteenths: 4 },
  ],
  // Pedal + neighbour
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 1, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
  ],
];

export type HarmonicPalette =
  | "pop"
  | "modal"
  | "jazz"
  | "ambient"
  | "mixed";

function bankForPalette(
  palette: HarmonicPalette,
  minor: boolean,
  roll: number,
): readonly (readonly ChordEvent[])[] {
  switch (palette) {
    case "ambient":
      return AMBIENT_PROGRESSIONS;
    case "jazz":
      return JAZZ_PROGRESSIONS;
    case "modal":
      return MODAL_PROGRESSIONS;
    case "mixed":
      if (roll < 0.35) return AMBIENT_PROGRESSIONS;
      if (roll < 0.55) return MODAL_PROGRESSIONS;
      if (roll < 0.7) return JAZZ_PROGRESSIONS;
      return minor ? MINOR_POP_PROGRESSIONS : POP_PROGRESSIONS;
    case "pop":
    default:
      return minor ? MINOR_POP_PROGRESSIONS : POP_PROGRESSIONS;
  }
}

export function pickProgressionBank(
  palette: HarmonicPalette,
  minor: boolean,
  rnd: () => number,
): readonly ChordEvent[] {
  const bank = bankForPalette(palette, minor, rnd());
  return bank[Math.floor(rnd() * bank.length)] ?? bank[0]!;
}

function pickFrom(
  bank: readonly (readonly ChordEvent[])[],
  rnd: () => number,
): readonly ChordEvent[] {
  return bank[Math.floor(rnd() * bank.length)] ?? bank[0]!;
}

function withDefaultVoicing(
  prog: readonly ChordEvent[],
): ChordEvent[] {
  return prog.map((ev) => ({
    ...ev,
    tones: ev.tones ?? ([0, 2, 4] as const),
  }));
}

/** Slow harmonic rhythm on short 4-chord loops (verse / intro). */
function lengthenShortCycle(
  prog: readonly ChordEvent[],
): ChordEvent[] {
  if (prog.length === 0 || prog.length > 4) return [...prog];
  if (prog.some((e) => (e.bars ?? 1) > 1)) return [...prog];
  return prog.map((ev) => ({ ...ev, bars: 2 }));
}

/** Prefer a V→I (or v→i) close when the section should cadence. */
function ensureCadentialClose(
  prog: readonly ChordEvent[],
  minor: boolean,
): ChordEvent[] {
  if (prog.length === 0) return [...prog];
  const last = prog[prog.length - 1]!;
  if (last.degree === 0) return withDefaultVoicing(prog);
  const dominant = minor ? 4 : 4;
  return withDefaultVoicing([
    ...prog.slice(0, -1),
    { degree: dominant, bars: last.bars ?? 1, tones: [0, 2, 4] },
    { degree: 0, bars: 1, tones: [0, 2, 4] },
  ]);
}

/** Pick a progression tailored to section role (chorus lift, bridge contrast). */
export function pickSectionProgression(
  kind: HarmonySectionKind,
  palette: HarmonicPalette,
  minor: boolean,
  rnd: () => number,
): readonly ChordEvent[] {
  if (palette === "ambient") {
    return withDefaultVoicing(pickProgressionBank("ambient", minor, rnd));
  }
  if (kind === "chorus" || kind === "prechorus") {
    const raw =
      palette === "jazz"
        ? pickProgressionBank("jazz", minor, rnd)
        : pickFrom(minor ? CHORUS_MINOR : CHORUS_POP, rnd);
    return ensureCadentialClose(raw, minor);
  }
  if (kind === "bridge") {
    const raw =
      palette === "jazz"
        ? pickProgressionBank("jazz", minor, rnd)
        : palette === "modal"
          ? pickProgressionBank("modal", minor, rnd)
          : pickFrom(minor ? BRIDGE_MINOR : BRIDGE_POP, rnd);
    return withDefaultVoicing(raw);
  }
  if (kind === "outro") {
    const settle: readonly ChordEvent[] =
      rnd() < 0.5
        ? [
            { degree: 3, bars: 1, tones: [0, 2, 4] },
            { degree: 0, bars: Math.max(1, 3), tones: [0, 2, 4] },
          ]
        : [
            { degree: 4, bars: 1, tones: [0, 2, 4] },
            { degree: 0, bars: Math.max(1, 3), tones: [0, 2, 4] },
          ];
    return settle;
  }
  if (kind === "intro") {
    const home = pickProgressionBank(palette, minor, rnd);
    const first = home[0];
    if (!first) return withDefaultVoicing(home);
    return lengthenShortCycle(
      withDefaultVoicing([
        { ...first, bars: Math.max(2, first.bars ?? 1) },
        ...home.slice(1),
      ]),
    );
  }
  // verse / default
  return lengthenShortCycle(
    withDefaultVoicing(pickProgressionBank(palette, minor, rnd)),
  );
}

/** Expand chord events into a per-bar degree (+ optional tones) timeline. */
export function expandChordTimeline(
  progression: readonly ChordEvent[],
  bars: number,
): HarmonyBar[] {
  const cycle: HarmonyBar[] = [];
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
  const out: HarmonyBar[] = [];
  for (let b = 0; b < bars; b++) {
    out.push(cycle[b % cycle.length]!);
  }
  return out;
}

/**
 * Build a full-song chord timeline from song sections.
 * Reuses the same progression when a section kind returns (ear-hook recall).
 * Falls back to a single tiled bank when no sections are provided.
 */
export function buildSectionHarmonyTimeline(
  bars: number,
  sections: readonly HarmonySectionIn[],
  palette: HarmonicPalette,
  minor: boolean,
  rnd: () => number,
): HarmonyBar[] {
  if (bars <= 0) return [];
  if (sections.length === 0) {
    return expandChordTimeline(
      pickProgressionBank(palette, minor, rnd),
      bars,
    );
  }

  const out: HarmonyBar[] = Array.from({ length: bars }, () => ({
    degree: 0,
    tones: [0, 2, 4] as const,
  }));
  const progByKind = new Map<HarmonySectionKind, readonly ChordEvent[]>();

  for (const sec of sections) {
    let prog = progByKind.get(sec.kind);
    if (!prog) {
      prog = pickSectionProgression(sec.kind, palette, minor, rnd);
      progByKind.set(sec.kind, prog);
    }
    const expanded = expandChordTimeline(prog, sec.bars);
    for (let i = 0; i < sec.bars; i++) {
      const bar = sec.startBar + i;
      if (bar >= 0 && bar < bars) out[bar] = expanded[i]!;
    }
  }
  return out;
}

export function pickMelodyCell(
  rnd: () => number,
  sparseOrMode: boolean | "sparse" | "dense" | "any" = false,
): readonly MelodyEvent[] {
  const mode =
    sparseOrMode === true || sparseOrMode === "sparse"
      ? "sparse"
      : sparseOrMode === "dense"
        ? "dense"
        : "any";
  const scored = MELODY_CELLS.map((c) => {
    const n = c.length;
    const avg =
      c.reduce((s, e) => s + e.sixteenths, 0) / Math.max(1, n);
    // Sparse = fewer events / longer notes; dense = busier cells
    let w = 1;
    if (mode === "sparse") w = n <= 3 ? 3 : n <= 4 ? 2 : 0.35;
    else if (mode === "dense") w = n >= 6 ? 3 : n >= 5 ? 2 : 0.4;
    if (mode === "sparse" && avg >= 6) w *= 1.4;
    if (mode === "dense" && avg <= 3) w *= 1.3;
    return { c, w };
  });
  const pool =
    mode === "any"
      ? MELODY_CELLS
      : scored.filter((x) => x.w >= 1).map((x) => x.c);
  const src = pool.length > 0 ? pool : MELODY_CELLS;
  if (mode === "any") {
    return src[Math.floor(rnd() * src.length)] ?? src[0]!;
  }
  const weights = scored.filter((x) => src.includes(x.c));
  let sum = 0;
  for (const x of weights) sum += x.w;
  let r = rnd() * sum;
  for (const x of weights) {
    r -= x.w;
    if (r <= 0) return x.c;
  }
  return src[0]!;
}

/** Call / response melody pairs for antiphonal arrangement. */
export type CallResponsePair = {
  call: readonly MelodyEvent[];
  response: readonly MelodyEvent[];
};

export const CALL_RESPONSE_PAIRS: readonly CallResponsePair[] = [
  // Call fragment (5–3–1) ↔ Response fragment (6–5–4–1)
  {
    call: [
      { degree: 4, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
      { degree: 0, sixteenths: 8 },
    ],
    response: [
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 3, sixteenths: 4 },
      { degree: 0, sixteenths: 4, accent: true },
    ],
  },
  // Call–echo ↔ rising answer
  {
    call: [
      { degree: 4, sixteenths: 4, accent: true },
      { degree: 4, sixteenths: 4 },
      { degree: 2, sixteenths: 4 },
      { degree: 0, sixteenths: 4 },
    ],
    response: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 7, sixteenths: 4 },
    ],
  },
  // Sparse sigh call ↔ neighbour answer
  {
    call: [
      { degree: 7, sixteenths: 4, accent: true },
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 8 },
    ],
    response: [
      { degree: 0, sixteenths: 2, accent: true },
      { degree: 1, sixteenths: 2 },
      { degree: 0, sixteenths: 4 },
      { degree: 2, sixteenths: 4 },
      { degree: 0, sixteenths: 4 },
    ],
  },
  // Short call ↔ dense chorus answer
  {
    call: [
      { degree: 0, sixteenths: 8, accent: true },
      { degree: 4, sixteenths: 8 },
    ],
    response: [
      { degree: 0, sixteenths: 2, accent: true },
      { degree: 2, sixteenths: 2 },
      { degree: 4, sixteenths: 2 },
      { degree: 5, sixteenths: 2 },
      { degree: 4, sixteenths: 4 },
      { degree: 2, sixteenths: 4 },
    ],
  },
  // Rising question ↔ falling resolve
  {
    call: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 2, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 5, sixteenths: 4 },
    ],
    response: [
      { degree: 5, sixteenths: 4, accent: true },
      { degree: 4, sixteenths: 4 },
      { degree: 2, sixteenths: 4 },
      { degree: 0, sixteenths: 4 },
    ],
  },
  // Leap call ↔ stepwise fill
  {
    call: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 7, sixteenths: 4 },
      { degree: 4, sixteenths: 8 },
    ],
    response: [
      { degree: 4, sixteenths: 2 },
      { degree: 3, sixteenths: 2 },
      { degree: 2, sixteenths: 2 },
      { degree: 1, sixteenths: 2 },
      { degree: 0, sixteenths: 8, accent: true },
    ],
  },
  // Syncopated call ↔ on-beat answer
  {
    call: [
      { degree: 0, sixteenths: 2, accent: true },
      { degree: 4, sixteenths: 2 },
      { degree: 7, sixteenths: 4 },
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
    ],
    response: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 4, sixteenths: 4 },
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
    ],
  },
  // Octave call ↔ triad response
  {
    call: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 7, sixteenths: 4 },
      { degree: 0, sixteenths: 8 },
    ],
    response: [
      { degree: 0, sixteenths: 2, accent: true },
      { degree: 2, sixteenths: 2 },
      { degree: 4, sixteenths: 4 },
      { degree: 2, sixteenths: 4 },
      { degree: 0, sixteenths: 4 },
    ],
  },
  // Minor-colour call ↔ plagal-ish answer
  {
    call: [
      { degree: 0, sixteenths: 4, accent: true },
      { degree: 5, sixteenths: 4 },
      { degree: 3, sixteenths: 4 },
      { degree: 0, sixteenths: 4 },
    ],
    response: [
      { degree: 3, sixteenths: 4 },
      { degree: 5, sixteenths: 4 },
      { degree: 4, sixteenths: 4 },
      { degree: 0, sixteenths: 4, accent: true },
    ],
  },
];

export function pickCallResponsePair(rnd: () => number): CallResponsePair {
  return (
    CALL_RESPONSE_PAIRS[Math.floor(rnd() * CALL_RESPONSE_PAIRS.length)] ??
    CALL_RESPONSE_PAIRS[0]!
  );
}

/**
 * Arpeggio cells — degrees relative to *current chord root*
 * (0=root, 2=3rd, 4=5th, 6=7th, 7=octave). `degree: null` = rest.
 * Sequence generator places tonal library oneshots on these steps.
 */
export type ArpEvent = {
  degree: number | null;
  sixteenths: number;
  accent?: boolean;
};

export const ARP_CELLS: readonly (readonly ArpEvent[])[] = [
  // Classic up 1–3–5–8
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 7, sixteenths: 4 },
  ],
  // Down 8–5–3–1
  [
    { degree: 7, sixteenths: 4, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
  ],
  // Up-down
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
  ],
  // Alberti-ish 1–5–3–5
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
  ],
  // Sixteenths broken triad
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
  ],
  // Sparse root–fifth
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 0, sixteenths: 4 },
    { degree: 7, sixteenths: 4 },
  ],
  // With 7th (1–3–5–7)
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 6, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
  ],
  // Syncopated with rest
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: null, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 2, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
  ],
  // Gallop
  [
    { degree: 0, sixteenths: 3, accent: true },
    { degree: 2, sixteenths: 1 },
    { degree: 4, sixteenths: 3 },
    { degree: 2, sixteenths: 1 },
    { degree: 0, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 4 },
  ],
  // Wide open
  [
    { degree: 0, sixteenths: 8, accent: true },
    { degree: 4, sixteenths: 4 },
    { degree: 7, sixteenths: 4 },
  ],
];

export function pickArpCell(
  rnd: () => number,
  sparseOrMode: boolean | "sparse" | "dense" | "any" = false,
): readonly ArpEvent[] {
  const mode =
    sparseOrMode === true || sparseOrMode === "sparse"
      ? "sparse"
      : sparseOrMode === "dense"
        ? "dense"
        : "any";
  const scored = ARP_CELLS.map((c) => {
    const sounding = c.filter((e) => e.degree != null).length;
    let w = 1;
    if (mode === "sparse") w = sounding <= 4 ? 3 : 0.4;
    else if (mode === "dense") w = sounding >= 6 ? 3 : sounding >= 5 ? 2 : 0.4;
    return { c, w };
  });
  const pool =
    mode === "any"
      ? ARP_CELLS
      : scored.filter((x) => x.w >= 1).map((x) => x.c);
  const src = pool.length > 0 ? pool : ARP_CELLS;
  if (mode === "any") {
    return src[Math.floor(rnd() * src.length)] ?? src[0]!;
  }
  const weights = scored.filter((x) => src.includes(x.c));
  let sum = 0;
  for (const x of weights) sum += x.w;
  let r = rnd() * sum;
  for (const x of weights) {
    r -= x.w;
    if (r <= 0) return x.c;
  }
  return src[0]!;
}
