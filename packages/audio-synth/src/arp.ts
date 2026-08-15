/**
 * Arpeggio phrase planner — sequenced scale motifs over 2–8 bars,
 * shaped by a multi-LFO rack (cutoff / gate / velocity / octave).
 * Generative places the baked clip as a phrase (no note-level MELODY_CELLS).
 */

import type { ScaleMode } from "./coherence.js";
import { MAJOR_SCALE, MINOR_SCALE, midiToHz } from "./coherence.js";

/** Phrase length in bars (4/4). */
export type ArpBars = 2 | 4 | 8;

/** How motifs tile across the phrase. */
export type ArpFormId = "AAAA" | "ABAB" | "AABA" | "ABAC" | "AABB" | "ABCD";

export const ARP_FORM_IDS: readonly ArpFormId[] = [
  "AAAA",
  "ABAB",
  "AABA",
  "ABAC",
  "AABB",
  "ABCD",
] as const;

export type ArpLfoTarget = "cutoff" | "gate" | "velocity" | "octave";
export type ArpLfoShape = "sine" | "triangle" | "square" | "saw";

/** One LFO in the rack (rate in phrase cycles: 1 = one full phrase). */
export type ArpLfo = {
  target: ArpLfoTarget;
  shape: ArpLfoShape;
  /** Cycles per phrase (0.25 = 1 cycle / 4 phrases equivalent stretch). */
  rate: number;
  depth: number;
  /** 0–1 phase offset. */
  phase: number;
};

export type ArpStep = {
  /** Scale degree relative to root (… −7..14). null = rest. */
  degree: number | null;
  /** Length in 16th notes. */
  sixteenths: number;
  accent?: boolean;
};

/** Legacy pattern ids kept for meta/read compatibility. */
export type ArpPatternId =
  | "up"
  | "down"
  | "upDown"
  | "sequence";

export const ARP_PATTERN_IDS: readonly ArpPatternId[] = [
  "sequence",
  "up",
  "down",
  "upDown",
] as const;

/** Chord tones as semitone offsets from root (R–3–5–8). */
export function arpChordSemis(scaleMode: ScaleMode = "major"): number[] {
  const scale = scaleMode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
  return [0, scale[2] ?? 3, scale[4] ?? 7, 12];
}

/** Scale intervals from tonic. */
export function arpScale(scaleMode: ScaleMode = "major"): readonly number[] {
  return scaleMode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
}

/** Degree → semitones above root (supports negative / multi-octave). */
export function degreeToSemis(
  degree: number,
  scale: readonly number[],
): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return (scale[idx] ?? 0) + oct * 12;
}

/** Motif banks — lengths sum to 16 sixteenths (= 1 bar) unless noted. */
export const ARP_MOTIFS: readonly (readonly ArpStep[])[] = [
  // Rising broken triad + octave
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
  ],
  // Syncopated leap (rest on 2)
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: null, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 4 },
  ],
  // Neighbour ornament
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 1, sixteenths: 1 },
    { degree: 0, sixteenths: 1 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
  ],
  // Call (5–3–1) then hold
  [
    { degree: 4, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
    { degree: null, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 2, sixteenths: 4 },
  ],
  // Descending sigh with skip
  [
    { degree: 7, sixteenths: 2, accent: true },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 6 },
  ],
  // Pentatonic skip groove
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 1 },
    { degree: 4, sixteenths: 1 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: null, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
  ],
  // Hooky 1–5–6–5 ×2
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
  ],
  // Gallop / dotted feel
  [
    { degree: 0, sixteenths: 3, accent: true },
    { degree: 2, sixteenths: 1 },
    { degree: 4, sixteenths: 3 },
    { degree: 2, sixteenths: 1 },
    { degree: 0, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 4 },
  ],
  // Sparse ambient (half notes-ish)
  [
    { degree: 0, sixteenths: 4, accent: true },
    { degree: null, sixteenths: 4 },
    { degree: 4, sixteenths: 4 },
    { degree: 2, sixteenths: 4 },
  ],
  // Octave bounce
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 7, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 9, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
  ],
  // Anticipation into downbeat
  [
    { degree: null, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 0, sixteenths: 4, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 4 },
  ],
  // Chromatic neighbour (scale degrees stay in-key via planner)
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 1, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 1, sixteenths: 2 },
    { degree: 0, sixteenths: 2 },
    { degree: null, sixteenths: 2 },
    { degree: 4, sixteenths: 4 },
  ],
  // Broken 7th (1–3–5–7)
  [
    { degree: 0, sixteenths: 2, accent: true },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 6, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 6, sixteenths: 2 },
    { degree: 7, sixteenths: 4 },
  ],
  // Stutter root then climb
  [
    { degree: 0, sixteenths: 1, accent: true },
    { degree: 0, sixteenths: 1 },
    { degree: 0, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 5, sixteenths: 2 },
    { degree: 7, sixteenths: 2 },
    { degree: 4, sixteenths: 4 },
  ],
  // Response fragment
  [
    { degree: 5, sixteenths: 2 },
    { degree: 4, sixteenths: 2 },
    { degree: 3, sixteenths: 2 },
    { degree: 0, sixteenths: 2, accent: true },
    { degree: null, sixteenths: 2 },
    { degree: 2, sixteenths: 2 },
    { degree: 0, sixteenths: 4 },
  ],
];

/** Legacy expand — simple sweeps (no chord stacks). */
export function expandArpSteps(
  pattern: ArpPatternId,
  toneCount: number,
  stepCount: number,
): number[] {
  const n = Math.max(1, toneCount);
  const steps: number[] = [];
  if (pattern === "sequence") {
    for (let i = 0; i < stepCount; i++) steps.push(0);
    return steps;
  }
  if (pattern === "up") {
    for (let i = 0; i < stepCount; i++) steps.push(i % n);
    return steps;
  }
  if (pattern === "down") {
    for (let i = 0; i < stepCount; i++) steps.push((n - 1 - (i % n) + n) % n);
    return steps;
  }
  const cycle = Math.max(1, n * 2 - 2);
  for (let i = 0; i < stepCount; i++) {
    const p = i % cycle;
    steps.push(p < n ? p : cycle - p);
  }
  return steps;
}

export function evalLfo(
  lfo: ArpLfo,
  tNorm: number,
): number {
  const ph = ((tNorm * lfo.rate + lfo.phase) % 1 + 1) % 1;
  let w: number;
  switch (lfo.shape) {
    case "triangle":
      w = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
      break;
    case "square":
      w = ph < 0.5 ? 1 : -1;
      break;
    case "saw":
      w = ph * 2 - 1;
      break;
    default:
      w = Math.sin(ph * Math.PI * 2);
  }
  return w * lfo.depth;
}

export function sumLfo(
  lfos: readonly ArpLfo[],
  target: ArpLfoTarget,
  tNorm: number,
): number {
  let s = 0;
  for (const l of lfos) {
    if (l.target === target) s += evalLfo(l, tNorm);
  }
  return s;
}

export type ArpNotePlan = {
  timeSec: number;
  hz: number;
  durationSec: number;
  peak: number;
  cutoffMul: number;
  accent: boolean;
  /**
   * Classic synth unison only (±cents on the *same* pitch).
   * Never chord intervals — harmony is sequence-generation's job.
   */
  unisonDetuneCents?: readonly number[];
};

export type PlanArpOpts = {
  fundHz: number;
  /** Preferred: lock all notes to this pitch class (0=C…11=B). */
  tonicPc?: number;
  /** Scientific octave for tonic root (default 4 = C4 region). */
  tonicOctave?: number;
  scaleMode?: ScaleMode;
  /** Prefer "sequence"; legacy sweeps still supported. */
  pattern?: ArpPatternId;
  bpm: number;
  bars: ArpBars | 1;
  /** Grid for legacy sweeps only. */
  division?: 8 | 16;
  form?: ArpFormId;
  /** Motif indices into ARP_MOTIFS (A,B,C,D). */
  motifs?: readonly number[];
  lfos?: readonly ArpLfo[];
};

function motifBars(form: ArpFormId, bars: number): string {
  const letters = form;
  if (bars <= 1) return "A";
  let out = "";
  for (let i = 0; i < bars; i++) {
    out += letters[i % letters.length] ?? "A";
  }
  return out;
}

function pickMotifIndex(
  pool: readonly number[],
  letter: string,
  rndFallback: number,
): number {
  const slot = letter.charCodeAt(0) - 65; // A=0
  if (slot >= 0 && slot < pool.length) return pool[slot]!;
  return pool[Math.floor(rndFallback * pool.length) % pool.length] ?? 0;
}

function expandMotifToBar(motif: readonly ArpStep[]): ArpStep[] {
  const sum = motif.reduce((s, st) => s + Math.max(1, st.sixteenths), 0);
  if (sum === 16) return [...motif];
  if (sum < 16) {
    const out = [...motif];
    out.push({ degree: null, sixteenths: 16 - sum });
    return out;
  }
  // Truncate to 16
  const out: ArpStep[] = [];
  let used = 0;
  for (const st of motif) {
    const left = 16 - used;
    if (left <= 0) break;
    const len = Math.min(Math.max(1, st.sixteenths), left);
    out.push({ ...st, sixteenths: len });
    used += len;
  }
  return out;
}

/** Build a multi-bar step list from form + motif pool. */
export function composeArpSteps(opts: {
  bars: number;
  form: ArpFormId;
  motifs: readonly number[];
}): ArpStep[] {
  const bars = Math.max(1, Math.min(8, Math.floor(opts.bars)));
  const pattern = motifBars(opts.form, bars);
  const pool =
    opts.motifs.length > 0
      ? opts.motifs
      : [0, 1, 2, 3].map((i) => i % ARP_MOTIFS.length);
  const out: ArpStep[] = [];
  for (let b = 0; b < bars; b++) {
    const letter = pattern[b] ?? "A";
    const mi = pickMotifIndex(pool, letter, b * 0.17);
    const motif = ARP_MOTIFS[mi % ARP_MOTIFS.length] ?? ARP_MOTIFS[0]!;
    // Light variation on return of A: drop last note → rest
    let steps = expandMotifToBar(motif);
    if (b > 0 && letter === "A" && b % 2 === 1 && steps.length > 2) {
      const last = steps[steps.length - 1]!;
      steps = [
        ...steps.slice(0, -1),
        { degree: null, sixteenths: last.sixteenths },
      ];
    }
    out.push(...steps);
  }
  return out;
}

/** Plan note onsets for one arp phrase (pure — no AudioContext). */
export function planArpNotes(opts: PlanArpOpts): {
  notes: ArpNotePlan[];
  durationSec: number;
  semis: number[];
  form: ArpFormId;
  bars: number;
  lfos: readonly ArpLfo[];
} {
  const bpm = Math.max(40, Math.min(240, opts.bpm || 120));
  const beat = 60 / bpm;
  const rawBars = opts.bars === 8 ? 8 : opts.bars === 4 ? 4 : opts.bars === 2 ? 2 : 1;
  const bars = rawBars === 1 ? 2 : rawBars; // never bake single-bar anymore
  const durationSec = bars * 4 * beat;
  const scale = arpScale(opts.scaleMode ?? "major");
  const semis = arpChordSemis(opts.scaleMode ?? "major");
  // Integer MIDI root — never leave continuous Hz (causes "almost" tuning).
  const tonicOctave = opts.tonicOctave ?? 4;
  const baseMidi =
    opts.tonicPc != null
      ? (tonicOctave + 1) * 12 + (((Math.round(opts.tonicPc) % 12) + 12) % 12)
      : Math.round(69 + 12 * Math.log2(Math.max(40, Math.min(2000, opts.fundHz)) / 440));
  const lfos = opts.lfos ?? [];
  const pattern = opts.pattern ?? "sequence";
  const form = opts.form ?? "ABAB";
  const motifs = opts.motifs ?? [0, 3, 6, 9];

  const notes: ArpNotePlan[] = [];

  const noteHz = (semi: number) => midiToHz(baseMidi + semi);
  /** Classic synth fatness: same pitch, slight detune — never chord stacks. */
  const unison = [-8, 8] as const;

  if (pattern !== "sequence") {
    // Legacy sweeps over full phrase length (single pitch class per step).
    const div = opts.division === 16 ? 16 : 8;
    const stepSec = (4 * beat) / div;
    const stepCount = Math.max(1, Math.round(durationSec / stepSec));
    const indices = expandArpSteps(pattern, semis.length, stepCount);
    for (let i = 0; i < stepCount; i++) {
      const t0 = i * stepSec;
      const tNorm = durationSec > 0 ? t0 / durationSec : 0;
      const gateMul = Math.max(0.25, 1 + sumLfo(lfos, "gate", tNorm) * 0.6);
      const vel = Math.max(0.2, Math.min(1, 0.65 + sumLfo(lfos, "velocity", tNorm) * 0.45));
      const cut = Math.max(0.35, Math.min(2.2, 1 + sumLfo(lfos, "cutoff", tNorm) * 0.85));
      const octLfo = sumLfo(lfos, "octave", tNorm);
      const oct = octLfo > 0.85 ? 12 : octLfo < -0.85 ? -12 : 0;
      const semi = (semis[indices[i] ?? 0] ?? 0) + oct;
      const gate = Math.min(stepSec * 0.9 * gateMul, stepSec - 0.006);
      notes.push({
        timeSec: t0,
        hz: noteHz(semi),
        durationSec: Math.max(0.02, gate),
        peak: 0.35 + vel * 0.5,
        cutoffMul: cut,
        accent: i % Math.max(1, div / 4) === 0,
        unisonDetuneCents: unison,
      });
    }
    return { notes, durationSec, semis, form, bars, lfos };
  }

  // Primary path: sequenced motifs (one pitch at a time; chords = sequence gen).
  const steps = composeArpSteps({ bars, form, motifs });
  const sixteenth = beat / 4;
  let cursor = 0;
  for (const st of steps) {
    const dur = Math.max(1, st.sixteenths) * sixteenth;
    if (st.degree == null) {
      cursor += dur;
      continue;
    }
    const t0 = cursor;
    const tNorm = durationSec > 0 ? t0 / durationSec : 0;
    const gateMul = Math.max(0.22, 1 + sumLfo(lfos, "gate", tNorm) * 0.65);
    const velRaw = sumLfo(lfos, "velocity", tNorm);
    const vel = Math.max(
      0.18,
      Math.min(1, (st.accent ? 0.82 : 0.55) + velRaw * 0.42),
    );
    const cut = Math.max(0.3, Math.min(2.4, 1 + sumLfo(lfos, "cutoff", tNorm) * 0.9));
    const octLfo = sumLfo(lfos, "octave", tNorm);
    const octExtra = octLfo > 0.85 ? 12 : octLfo < -0.85 ? -12 : 0;
    const semi = degreeToSemis(st.degree, scale) + octExtra;
    const gate = Math.min(dur * 0.92 * gateMul, dur - 0.004);
    notes.push({
      timeSec: t0,
      hz: noteHz(semi),
      durationSec: Math.max(0.018, gate),
      peak: 0.28 + vel * 0.55,
      cutoffMul: cut,
      accent: !!st.accent,
      unisonDetuneCents: unison,
    });
    cursor += dur;
  }

  return { notes, durationSec, semis, form, bars, lfos };
}

const LFO_SHAPES: readonly ArpLfoShape[] = [
  "sine",
  "triangle",
  "square",
  "saw",
];
/** Octave LFO left out — it fights equal temperament perception of the phrase. */
const LFO_TARGETS: readonly ArpLfoTarget[] = [
  "cutoff",
  "gate",
  "velocity",
];

export function pickArpForm(rnd: () => number): ArpFormId {
  const i = Math.min(
    ARP_FORM_IDS.length - 1,
    Math.floor(rnd() * ARP_FORM_IDS.length),
  );
  return ARP_FORM_IDS[i] ?? "ABAB";
}

export function pickArpBars(rnd: () => number): ArpBars {
  const r = rnd();
  if (r < 0.2) return 2;
  if (r < 0.7) return 4;
  return 8;
}

export function pickArpDivision(rnd: () => number, bpm: number): 8 | 16 {
  if (bpm >= 140) return 8;
  return rnd() < 0.45 ? 16 : 8;
}

/** Always prefer sequenced motifs. */
export function pickArpPattern(_rnd: () => number): ArpPatternId {
  return "sequence";
}

export function pickArpMotifs(rnd: () => number, count = 4): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  const n = ARP_MOTIFS.length;
  while (out.length < count && used.size < n) {
    const i = Math.floor(rnd() * n) % n;
    if (used.has(i)) continue;
    used.add(i);
    out.push(i);
  }
  while (out.length < count) out.push(out.length % n);
  return out;
}

/** Build 2–3 LFOs with distinct targets (cutoff / gate / velocity). */
export function pickArpLfos(rnd: () => number): ArpLfo[] {
  const count = rnd() < 0.35 ? 2 : 3;
  const targets = [...LFO_TARGETS];
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = targets[i]!;
    targets[i] = targets[j]!;
    targets[j] = tmp;
  }
  const rates = [0.5, 1, 2, 4, 0.25, 1.5];
  const out: ArpLfo[] = [];
  for (let i = 0; i < count; i++) {
    const target = targets[i % targets.length] ?? "cutoff";
    const shape = LFO_SHAPES[Math.floor(rnd() * LFO_SHAPES.length)] ?? "sine";
    const rate = rates[Math.floor(rnd() * rates.length)] ?? 1;
    const depth =
      target === "cutoff"
        ? 0.35 + rnd() * 0.5
        : 0.25 + rnd() * 0.45;
    out.push({
      target,
      shape,
      rate,
      depth,
      phase: rnd(),
    });
  }
  return out;
}
