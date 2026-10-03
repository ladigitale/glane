import { PPQ } from "@glane/core-model";
import { degreeToMidi } from "./melody.js";
import type { MusicStyleId } from "./styles/ids.js";
import type {
  ChordSlot,
  ModeId,
  Motif,
  NoteEvent,
  RhythmGene,
  Rng,
  Section,
  SectionKind,
  TrackPart,
} from "./types.js";
import { geneFromOnsets, geneToBarTicks } from "./rhythm.js";

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
    if (t >= start && t < end) {
      if (!best || c.bar > best.bar || (c.bar === best.bar && c.beat >= best.beat)) {
        best = c;
      }
    }
  }
  return best;
}

function rootMidi(slot: ChordSlot, octave = 36): number {
  const pc = slot.tonesPc[0] ?? ((slot.degree * 2) % 12);
  return octave + pc;
}

function fifthMidi(slot: ChordSlot, octave = 36): number {
  const root = rootMidi(slot, octave);
  return root + 7;
}

function chordToneMidi(slot: ChordSlot, index: number, octave = 36): number {
  const tones = slot.tonesPc;
  if (!tones.length) return rootMidi(slot, octave);
  const pc = tones[index % tones.length]!;
  const rootPc = tones[0]!;
  let midi = octave + pc;
  while (midi < octave) midi += 12;
  while (midi > octave + 14) midi -= 12;
  if (pc < rootPc && midi - octave > 7) midi -= 12;
  return midi;
}

type BassMotion = {
  unlock: number;
  color: number;
  approach: number;
  walk: number;
};

function motionForStyle(style: MusicStyleId | undefined): BassMotion {
  switch (style) {
    case "jazz":
    case "blues":
      return { unlock: 0.7, color: 0.45, approach: 0.7, walk: 0.55 };
    case "funk":
    case "disco":
    case "latin":
    case "afrobeat":
      return { unlock: 0.55, color: 0.5, approach: 0.55, walk: 0.4 };
    case "reggae":
    case "dub":
      return { unlock: 0.35, color: 0.35, approach: 0.4, walk: 0.2 };
    case "techno":
    case "house":
    case "dnb":
    case "garage":
      return { unlock: 0.25, color: 0.4, approach: 0.3, walk: 0.15 };
    case "ambient":
    case "triphop":
    case "classical":
    case "folk":
      return { unlock: 0.4, color: 0.3, approach: 0.35, walk: 0.25 };
    case "metal":
    case "punk":
    case "rock":
      return { unlock: 0.2, color: 0.35, approach: 0.35, walk: 0.15 };
    default:
      return { unlock: 0.35, color: 0.35, approach: 0.4, walk: 0.25 };
  }
}

/** Chance that a section lets the bass carry the hook contour (still bass register). */
export function bassLeadChance(
  kind: SectionKind,
  style: MusicStyleId | undefined,
): number {
  const melodic =
    style === "jazz" ||
    style === "blues" ||
    style === "funk" ||
    style === "disco" ||
    style === "latin" ||
    style === "afrobeat" ||
    style === "folk";
  if (kind === "bridge" || kind === "break") return melodic ? 0.55 : 0.28;
  if (kind === "verse" && melodic) return 0.12;
  return 0;
}

function mergeHits(
  kickHits: Array<{ tick: number; accent: boolean; vel: number }>,
  geneHits: Array<{ tick: number; accent: boolean; vel: number }>,
  barStart: number,
): Array<{ tick: number; accent: boolean; vel: number }> {
  const byTick = new Map<number, { tick: number; accent: boolean; vel: number }>();
  for (const h of kickHits) byTick.set(h.tick, h);
  for (const h of geneHits) {
    const prev = byTick.get(h.tick);
    if (!prev) byTick.set(h.tick, h);
    else {
      byTick.set(h.tick, {
        tick: h.tick,
        accent: prev.accent || h.accent,
        vel: Math.max(prev.vel, h.vel),
      });
    }
  }
  if (![...byTick.keys()].some((t) => t === barStart)) {
    byTick.set(barStart, { tick: barStart, accent: true, vel: 0.85 });
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

function clampBassMidi(midi: number): number {
  while (midi < 28) midi += 12;
  while (midi > 55) midi -= 12;
  return midi;
}

/**
 * Bass: chord roots on strong beats, with style-aware unlock from kick,
 * 5ths/octaves, approaches, walking, and rare hook-lead sections.
 */
export function planBass(opts: {
  sections: readonly Section[];
  harmony: readonly ChordSlot[];
  kickEvents: readonly NoteEvent[];
  rhythmGenes: readonly RhythmGene[];
  /** Force lock-to-kick. Default: adaptive per section via style/energy. */
  lockKick?: boolean;
  trackIndex: number;
  ppq?: number;
  rng?: Rng;
  style?: MusicStyleId;
  density?: number;
  variation?: number;
  /** When set with mode/keyPc, rare sections play hook contour in bass register. */
  hook?: Motif;
  mode?: ModeId;
  keyPc?: number;
}): TrackPart {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const events: NoteEvent[] = [];
  const fallback = opts.rhythmGenes[1] ?? opts.rhythmGenes[0] ?? geneFromOnsets([0, 8], 16);
  const motion = motionForStyle(opts.style);
  const density = opts.density ?? 0.7;
  const variation = opts.variation ?? 0.35;
  const rng = opts.rng ?? ((_path: string) => 0.35);
  const mode = opts.mode ?? "aeolian";
  const keyPc = opts.keyPc ?? 0;

  for (const section of opts.sections) {
    const leadP = bassLeadChance(section.kind, opts.style);
    const asLead =
      !!opts.hook &&
      leadP > 0 &&
      rng(`bass/lead/${section.id}`) < leadP * (0.7 + variation * 0.5);

    if (asLead && opts.hook) {
      const motif = opts.hook;
      const onsets = motif.rhythm.onsets;
      for (let b = 0; b < section.bars; b++) {
        const bar = section.startBar + b;
        const barStart = bar * tpb;
        const barEnd = barStart + tpb;
        for (let i = 0; i < onsets.length; i++) {
          const step = onsets[i]!;
          const tick = barStart + Math.round((step / 16) * tpb);
          if (tick >= barEnd) continue;
          const degree = motif.contour[i] ?? motif.contour[motif.contour.length - 1] ?? 0;
          const accent = (motif.rhythm.accents[i] ?? 0.5) >= 0.7;
          // Octave 2–3: melodic contour, still under the lead.
          let midi = degreeToMidi(degree, mode, keyPc, 2);
          midi = clampBassMidi(midi);
          const nextStep = onsets[i + 1];
          const nextTick =
            nextStep != null
              ? barStart + Math.round((nextStep / 16) * tpb)
              : barEnd;
          events.push({
            tick,
            durTick: Math.max(Math.floor(ppq / 4), nextTick - tick - 2),
            midi,
            vel: accent ? 0.8 : 0.55,
            accent,
            tag: "variation",
          });
        }
        // Keep a rooted downbeat so the section does not float.
        if (!events.some((e) => e.tick === barStart)) {
          const slot = chordAt(opts.harmony, bar, 0) ?? opts.harmony[0];
          if (slot) {
            events.push({
              tick: barStart,
              durTick: Math.floor(ppq / 2),
              midi: clampBassMidi(rootMidi(slot)),
              vel: 0.85,
              accent: true,
            });
          }
        }
      }
      continue;
    }

    const unlockP = Math.min(
      0.95,
      motion.unlock * (0.55 + section.energy * 0.5) * (0.7 + variation * 0.6),
    );
    const lockKick =
      opts.lockKick === true
        ? true
        : opts.lockKick === false
          ? false
          : rng(`bass/lock/${section.id}`) >= unlockP;

    for (let b = 0; b < section.bars; b++) {
      const bar = section.startBar + b;
      const barStart = bar * tpb;
      const barEnd = barStart + tpb;
      const path = `bass/bar/${bar}`;

      const kickHits = opts.kickEvents
        .filter((e) => e.tick >= barStart && e.tick < barEnd)
        .map((e) => ({
          tick: e.tick,
          accent: e.accent,
          vel: Math.max(0.4, e.vel),
        }));
      const geneHits = geneToBarTicks(fallback, barStart, ppq).map((h) => ({
        ...h,
        vel: h.accent ? 0.75 : 0.5,
      }));

      let hits: Array<{ tick: number; accent: boolean; vel: number }>;
      if (lockKick) {
        hits = kickHits.slice();
        if (!hits.some((h) => h.tick === barStart)) {
          hits.unshift({ tick: barStart, accent: true, vel: 0.85 });
        }
        if (density > 0.55 && rng(`${path}/extra`) < 0.25 + variation * 0.35) {
          hits = mergeHits(hits, geneHits.filter((h) => !h.accent), barStart);
        }
      } else {
        hits = mergeHits(kickHits, geneHits, barStart);
      }

      const maxHits = Math.max(2, Math.round(2 + density * 4 + (lockKick ? 0 : 1)));
      if (hits.length > maxHits) {
        const accents = hits.filter((h) => h.accent || h.tick === barStart);
        const rest = hits
          .filter((h) => !(h.accent || h.tick === barStart))
          .sort((a, b) => b.vel - a.vel);
        hits = [...accents, ...rest.slice(0, Math.max(0, maxHits - accents.length))].sort(
          (a, b) => a.tick - b.tick,
        );
      }

      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]!;
        const beat = Math.floor((h.tick - barStart) / ppq);
        const slot = chordAt(opts.harmony, bar, beat) ?? opts.harmony[0];
        if (!slot) continue;
        const next = hits[i + 1];
        const nextBeat = next
          ? Math.floor((next.tick - barStart) / ppq)
          : beat;
        const nextSlot = next
          ? chordAt(opts.harmony, bar, nextBeat) ?? slot
          : chordAt(opts.harmony, bar + 1, 0) ?? slot;

        let midi = rootMidi(slot);
        const roll = rng(`${path}/pitch/${i}`);

        const wantApproach =
          next &&
          nextSlot.degree !== slot.degree &&
          !h.accent &&
          section.energy > 0.28 &&
          roll < motion.approach * (0.5 + section.energy * 0.5);

        if (wantApproach) {
          const target = rootMidi(nextSlot);
          midi = roll < motion.approach * 0.55 ? target - 1 : target - 2;
        } else if (!h.accent && roll < motion.color) {
          const colorRoll = rng(`${path}/color/${i}`);
          if (colorRoll < 0.4) midi = fifthMidi(slot);
          else if (colorRoll < 0.65) midi = rootMidi(slot, 36) + 12;
          else if (colorRoll < 0.85) midi = chordToneMidi(slot, 1);
          else midi = rootMidi(slot, 24);
        } else if (
          next &&
          nextSlot.degree !== slot.degree &&
          !h.accent &&
          roll < motion.walk
        ) {
          const from = rootMidi(slot);
          const to = rootMidi(nextSlot);
          const step = to > from ? 2 : -2;
          midi = from + step;
        }

        midi = clampBassMidi(midi);
        const nextTick = next?.tick ?? barEnd;
        events.push({
          tick: h.tick,
          durTick: Math.max(Math.floor(ppq / 4), nextTick - h.tick - 2),
          midi,
          vel: h.vel,
          accent: h.accent,
        });
      }
    }
  }

  events.sort((a, b) => a.tick - b.tick);

  return {
    trackIndex: opts.trackIndex,
    role: "bass",
    layerTier: 1,
    events,
  };
}
