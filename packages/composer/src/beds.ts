import { PPQ } from "@glane/core-model";
import type { ExprRole } from "@glane/core-model";
import type { ChordSlot, NoteEvent, Section, TrackPart } from "./types.js";

function rootMidiAt(
  harmony: readonly ChordSlot[],
  bar: number,
  octave: number,
): number | null {
  let best: ChordSlot | null = null;
  for (const c of harmony) {
    if (c.bar > bar) break;
    if (c.bar === bar || (c.bar < bar && c.bar + c.durBeats / 4 > bar)) {
      best = c;
    }
    if (c.bar <= bar) best = c;
  }
  if (!best) return null;
  const pc = best.tonesPc[0] ?? 0;
  return octave * 12 + (pc % 12);
}

/**
 * Sustained bed / loop / fx layers — one hold per bar (or every 2 bars).
 * Fills texture tracks that otherwise stay silent after role assign.
 */
export function planBed(opts: {
  role: Extract<ExprRole, "texture" | "loop" | "fx">;
  sections: readonly Section[];
  harmony: readonly ChordSlot[];
  trackIndex: number;
  ppq?: number;
}): TrackPart {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const events: NoteEvent[] = [];
  const stride = opts.role === "fx" ? 2 : 1;
  const octave = opts.role === "loop" ? 4 : 3;

  for (const section of opts.sections) {
    for (let b = 0; b < section.bars; b += stride) {
      const bar = section.startBar + b;
      const holdBars = Math.min(stride, section.bars - b);
      const midi =
        opts.role === "fx" ? null : rootMidiAt(opts.harmony, bar, octave);
      events.push({
        tick: bar * tpb,
        durTick: holdBars * tpb - Math.floor(ppq / 16),
        midi,
        vel: opts.role === "fx" ? 0.45 : 0.55 + section.energy * 0.25,
        accent: b === 0,
        tag: section.kind === "intro" || section.kind === "outro"
          ? "pickup"
          : undefined,
      });
    }
  }

  return {
    trackIndex: opts.trackIndex,
    role: opts.role,
    layerTier: 0,
    events,
  };
}

/** Sparse arp: chord tones on 8th grid in active sections. */
export function planArp(opts: {
  sections: readonly Section[];
  harmony: readonly ChordSlot[];
  trackIndex: number;
  ppq?: number;
}): TrackPart {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const t8 = Math.floor(ppq / 2);
  const events: NoteEvent[] = [];

  for (const section of opts.sections) {
    if (section.kind === "break") continue;
    if (section.kind === "intro" && section.occurrence === 0) continue;
    for (let b = 0; b < section.bars; b++) {
      const bar = section.startBar + b;
      const slot =
        opts.harmony.find((c) => c.bar === bar) ??
        opts.harmony.find((c) => c.bar <= bar);
      const tones = slot?.tonesPc ?? [0, 4, 7];
      const steps =
        section.kind === "chorus" || section.kind === "drop" ? 8 : 4;
      for (let i = 0; i < steps; i++) {
        const pc = tones[i % tones.length] ?? 0;
        events.push({
          tick: bar * tpb + i * (tpb / steps),
          durTick: Math.max(t8 / 2, Math.floor(ppq / 4)),
          midi: 60 + (pc % 12),
          vel: 0.5 + (i % 2 === 0 ? 0.15 : 0),
          accent: i % 4 === 0,
        });
      }
    }
  }

  return {
    trackIndex: opts.trackIndex,
    role: "arp",
    layerTier: 1,
    events,
  };
}
