import { PPQ } from "@glane/core-model";
import type {
  ChordSlot,
  NoteEvent,
  RhythmGene,
  Section,
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

/**
 * Bass: chord roots on strong beats, optional approach before changes.
 * Rhythm locks to kick onsets when lockKick, else uses a rhythm gene.
 */
export function planBass(opts: {
  sections: readonly Section[];
  harmony: readonly ChordSlot[];
  kickEvents: readonly NoteEvent[];
  rhythmGenes: readonly RhythmGene[];
  lockKick?: boolean;
  trackIndex: number;
  ppq?: number;
}): TrackPart {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const lockKick = opts.lockKick !== false;
  const events: NoteEvent[] = [];
  const fallback = opts.rhythmGenes[0] ?? geneFromOnsets([0, 8], 16);

  for (const section of opts.sections) {
    for (let b = 0; b < section.bars; b++) {
      const bar = section.startBar + b;
      const barStart = bar * tpb;
      const barEnd = barStart + tpb;

      let hits: Array<{ tick: number; accent: boolean; vel: number }>;
      if (lockKick) {
        hits = opts.kickEvents
          .filter((e) => e.tick >= barStart && e.tick < barEnd)
          .map((e) => ({
            tick: e.tick,
            accent: e.accent,
            vel: Math.max(0.4, e.vel),
          }));
        // Ensure downbeat
        if (!hits.some((h) => h.tick === barStart)) {
          hits.unshift({ tick: barStart, accent: true, vel: 0.85 });
        }
      } else {
        hits = geneToBarTicks(fallback, barStart, ppq);
      }

      for (let i = 0; i < hits.length; i++) {
        const h = hits[i]!;
        const beat = Math.floor((h.tick - barStart) / ppq);
        const slot = chordAt(opts.harmony, bar, beat) ?? opts.harmony[0];
        if (!slot) continue;
        let midi = rootMidi(slot);
        // Approach: chromatic below before chord change
        const next = hits[i + 1];
        if (next && section.energy > 0.45) {
          const nextBeat = Math.floor((next.tick - barStart) / ppq);
          const nextSlot = chordAt(opts.harmony, bar, nextBeat);
          if (nextSlot && nextSlot.degree !== slot.degree && !h.accent) {
            midi = rootMidi(nextSlot) - 1;
          }
        }
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

  return {
    trackIndex: opts.trackIndex,
    role: "bass",
    layerTier: 1,
    events,
  };
}
