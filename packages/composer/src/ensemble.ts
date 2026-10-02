import type { ExprRole } from "@glane/core-model";
import { PPQ } from "@glane/core-model";
import type { MusicStyleId } from "./styles/ids.js";
import type {
  NoteEvent,
  Section,
  SectionKind,
  TrackPart,
  VoiceRelation,
} from "./types.js";

export type EnsembleAssign = {
  primaryTrack: number;
  relationByTrack: VoiceRelation[];
};

const MELODIC: ExprRole[] = ["lead", "arp", "chord"];

function styleBias(style: MusicStyleId): {
  lock: number;
  respond: number;
  kinship: number;
} {
  if (
    style === "techno" ||
    style === "house" ||
    style === "dnb" ||
    style === "breakbeat"
  ) {
    return { lock: 0.7, respond: 0.15, kinship: 0.15 };
  }
  if (style === "jazz" || style === "folk" || style === "blues") {
    return { lock: 0.2, respond: 0.5, kinship: 0.3 };
  }
  if (style === "ambient" || style === "dub" || style === "triphop") {
    return { lock: 0.15, respond: 0.2, kinship: 0.65 };
  }
  if (style === "reggae" || style === "funk" || style === "hiphop") {
    return { lock: 0.25, respond: 0.55, kinship: 0.2 };
  }
  return { lock: 0.4, respond: 0.35, kinship: 0.25 };
}

function sectionPreferred(
  kind: SectionKind,
  bias: { lock: number; respond: number; kinship: number },
): VoiceRelation {
  if (kind === "chorus" || kind === "prechorus" || kind === "drop") {
    return bias.lock >= bias.kinship ? "lock" : "kinship";
  }
  if (kind === "verse") {
    return bias.respond >= bias.kinship ? "respond" : "kinship";
  }
  if (kind === "bridge" || kind === "break") return "kinship";
  return "independent";
}

/** Pick primary melodic track and follower relations. */
export function assignEnsemble(opts: {
  trackRoles: readonly ExprRole[];
  style: MusicStyleId;
  sectionKind?: SectionKind;
}): EnsembleAssign {
  const bias = styleBias(opts.style);
  let primaryTrack = -1;
  for (const pref of ["lead", "arp", "chord"] as const) {
    const i = opts.trackRoles.indexOf(pref);
    if (i >= 0) {
      primaryTrack = i;
      break;
    }
  }
  const kind = opts.sectionKind ?? "verse";
  const preferred = sectionPreferred(kind, bias);
  const relationByTrack = opts.trackRoles.map((role, i) => {
    if (i === primaryTrack) return "independent" as VoiceRelation;
    if (!MELODIC.includes(role)) return "independent";
    if (role === "bass") return "lock";
    return preferred;
  });
  return { primaryTrack, relationByTrack };
}

function eventsInHalf(
  events: readonly NoteEvent[],
  start: number,
  mid: number,
  end: number,
  half: "a" | "b",
): NoteEvent[] {
  return events.filter((e) =>
    half === "a" ? e.tick >= start && e.tick < mid : e.tick >= mid && e.tick < end,
  );
}

/**
 * Apply lock / respond / kinship to follower parts relative to primary lead.
 * Operates on already-planned events; does not re-roll onsets randomly.
 */
export function applyEnsembleRelations(opts: {
  parts: TrackPart[];
  sections: readonly Section[];
  assign: EnsembleAssign;
  ppq?: number;
}): TrackPart[] {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const primary = opts.parts.find(
    (p) => p.trackIndex === opts.assign.primaryTrack,
  );
  if (!primary || opts.assign.primaryTrack < 0) {
    return opts.parts.map((p, i) => ({
      ...p,
      relation: opts.assign.relationByTrack[i] ?? "independent",
    }));
  }

  return opts.parts.map((part) => {
    const rel =
      opts.assign.relationByTrack[part.trackIndex] ?? "independent";
    if (
      part.trackIndex === opts.assign.primaryTrack ||
      rel === "independent" ||
      !MELODIC.includes(part.role)
    ) {
      return { ...part, relation: rel };
    }

    const newEvents: NoteEvent[] = [];
    for (const section of opts.sections) {
      const start = section.startBar * tpb;
      const end = (section.startBar + section.bars) * tpb;
      const mid = start + Math.floor((end - start) / 2);
      const leadSec = primary.events.filter(
        (e) => e.tick >= start && e.tick < end,
      );
      const partSec = part.events.filter(
        (e) => e.tick >= start && e.tick < end,
      );

      if (rel === "lock") {
        // Follow lead onsets; keep follower pitch (or shift +3rd in degrees ≈ +4 semis rough)
        for (const le of leadSec) {
          const nearest = partSec.reduce(
            (best, e) =>
              Math.abs(e.tick - le.tick) < Math.abs(best.tick - le.tick)
                ? e
                : best,
            partSec[0] ?? le,
          );
          newEvents.push({
            ...nearest,
            tick: le.tick,
            accent: le.accent,
            midi:
              nearest.midi != null && le.midi != null
                ? nearest.midi
                : le.midi != null
                  ? le.midi + 4
                  : nearest.midi,
          });
        }
      } else if (rel === "respond") {
        // Follower silent on half A; answers on half B (or derived from lead A).
        const leadA = eventsInHalf(leadSec, start, mid, end, "a");
        const followB = eventsInHalf(partSec, start, mid, end, "b");
        if (followB.length > 0) {
          for (const e of followB) newEvents.push(e);
        } else {
          for (const e of leadA) {
            newEvents.push({
              ...e,
              tick: e.tick + (mid - start),
              midi: e.midi != null ? e.midi - 2 : null,
              tag: "variation",
            });
          }
        }
      } else {
        // kinship: keep accents aligned with lead; drop weak notes off skeleton
        const leadAccents = new Set(
          leadSec.filter((e) => e.accent).map((e) => e.tick),
        );
        for (const e of partSec) {
          const nearAccent = [...leadAccents].some(
            (t) => Math.abs(t - e.tick) < ppq / 4,
          );
          if (e.accent || nearAccent || e.tag === "cadence") {
            newEvents.push(e);
          }
        }
      }
    }

    // Dedup ticks
    newEvents.sort((a, b) => a.tick - b.tick);
    const dedup: NoteEvent[] = [];
    for (const e of newEvents) {
      const last = dedup[dedup.length - 1];
      if (last && last.tick === e.tick) continue;
      dedup.push(e);
    }

    return { ...part, relation: rel, events: dedup };
  });
}
