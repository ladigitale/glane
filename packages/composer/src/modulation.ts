import type { ExprRole } from "@glane/core-model";
import { PPQ } from "@glane/core-model";
import type { MusicStyleId } from "./styles/ids.js";
import type {
  EventParam,
  ModRoute,
  ModSource,
  NoteEvent,
  Section,
  TrackPart,
} from "./types.js";
import type { Rng } from "./types.js";

/** Resolved clip expression (maps to Clip fields at render). */
export type EventExpression = {
  gainDb: number;
  lengthScale: number;
  fadeInMs: number;
  fadeOutMs: number;
  offsetMs: number;
  roundRobin: number;
  pitchCents: number;
  pan: number;
  lpHz: number;
  sendA: number;
  sendB: number;
  reverse: number; // 0|1
};

export type ModContext = {
  energy: number;
  sectionRamp: number;
  phraseRamp: number;
  barInPhrase: number;
  beatStrength: number;
  accent: number;
  velocity: number;
  lfoBars: number;
  holdPerPhrase: number;
  occurrence: number;
  sampleEnvelope: number;
};

const DEFAULT_EXPR: EventExpression = {
  gainDb: 0,
  lengthScale: 1,
  fadeInMs: 2,
  fadeOutMs: 40,
  offsetMs: 0,
  roundRobin: 0,
  pitchCents: 0,
  pan: 0,
  lpHz: 20000,
  sendA: 0,
  sendB: 0,
  reverse: 0,
};

/** Beat strength 0..1 from tick within bar (4/4). */
export function beatStrengthAt(tickInBar: number, ppq: number): number {
  const beat = tickInBar / ppq;
  const i = Math.floor(beat + 1e-9);
  const frac = beat - i;
  if (i % 4 === 0 && frac < 0.05) return 1;
  if (i % 2 === 0 && frac < 0.05) return 0.6;
  if (frac < 0.05) return 0.3;
  return 0.1;
}

export function evalSource(source: ModSource, ctx: ModContext): number {
  return ctx[source] ?? 0;
}

function curveMap(
  x: number,
  curve: ModRoute["curve"],
): number {
  const v = Math.min(1, Math.max(0, x));
  if (curve === "exp") return v * v;
  if (curve === "step") return v >= 0.5 ? 1 : 0;
  return v;
}

/** Base modulation matrix; depths scaled by `life` (0 → empty). */
export function buildModRoutes(opts: {
  life: number;
  style: MusicStyleId;
  density?: number;
}): ModRoute[] {
  const life = Math.min(1, Math.max(0, opts.life));
  if (life <= 0) return [];

  const d = (base: number) => base * life;
  const routes: ModRoute[] = [
    {
      source: "beatStrength",
      dest: "gainDb",
      depth: d(1.2),
      roles: ["kick"],
      curve: "lin",
    },
    {
      source: "energy",
      dest: "lengthScale",
      depth: d(-0.25),
      roles: ["kick"],
      curve: "lin",
    },
    {
      source: "accent",
      dest: "gainDb",
      depth: d(2),
      roles: ["snare", "perc"],
      curve: "step",
    },
    {
      source: "phraseRamp",
      dest: "sendA",
      depth: d(0.35),
      roles: ["snare"],
      curve: "exp",
    },
    {
      source: "beatStrength",
      dest: "gainDb",
      depth: d(1.5),
      roles: ["hat"],
      curve: "lin",
    },
    {
      source: "lfoBars",
      dest: "fadeOutMs",
      depth: d(40),
      roles: ["hat"],
      period: 2,
      curve: "lin",
    },
    {
      source: "holdPerPhrase",
      dest: "pitchCents",
      depth: d(15),
      roles: ["perc"],
      curve: "lin",
    },
    {
      source: "lfoBars",
      dest: "pan",
      depth: d(0.35),
      roles: ["perc"],
      period: 8,
      curve: "lin",
    },
    {
      source: "beatStrength",
      dest: "lengthScale",
      depth: d(0.4),
      roles: ["bass"],
      curve: "lin",
    },
    {
      source: "accent",
      dest: "gainDb",
      depth: d(1.5),
      roles: ["bass", "lead"],
      curve: "lin",
    },
    {
      source: "energy",
      dest: "fadeInMs",
      depth: d(-25),
      roles: ["chord"],
      curve: "lin",
    },
    {
      source: "energy",
      dest: "lpHz",
      depth: d(8000),
      roles: ["chord"],
      curve: "exp",
    },
    {
      source: "sectionRamp",
      dest: "lpHz",
      depth: d(4000),
      roles: ["chord", "lead"],
      curve: "lin",
    },
    {
      source: "phraseRamp",
      dest: "sendB",
      depth: d(0.4),
      roles: ["lead", "arp"],
      curve: "exp",
    },
    {
      source: "occurrence",
      dest: "offsetMs",
      depth: d(40),
      roles: ["texture", "loop"],
      curve: "step",
    },
    {
      source: "lfoBars",
      dest: "gainDb",
      depth: d(2),
      roles: ["texture", "loop"],
      period: 16,
      curve: "lin",
    },
  ];

  // Style signature lean
  if (opts.style === "dub" || opts.style === "reggae") {
    routes.push({
      source: "phraseRamp",
      dest: "sendB",
      depth: d(0.55),
      roles: ["snare", "perc", "lead"],
      curve: "exp",
    });
  }
  if (opts.style === "ambient") {
    routes.push({
      source: "lfoBars",
      dest: "lpHz",
      depth: d(6000),
      roles: ["chord", "texture", "lead"],
      period: 32,
      curve: "lin",
    });
  }

  // Round-robin for repeated kit roles when life high enough
  if (life >= 0.35) {
    for (const role of ["hat", "snare", "perc"] as ExprRole[]) {
      routes.push({
        source: "holdPerPhrase",
        dest: "roundRobin",
        depth: d(2.5),
        roles: [role],
        curve: "step",
      });
    }
  }

  return routes;
}

export function buildModContext(opts: {
  section: Section;
  tick: number;
  event: NoteEvent;
  ppq: number;
  rng: Rng;
  path: string;
}): ModContext {
  const ppq = opts.ppq;
  const tpb = ppq * 4;
  const tickInSec = opts.tick - opts.section.startBar * tpb;
  const secTicks = opts.section.bars * tpb;
  const phraseBars = Math.min(8, opts.section.bars);
  const phraseTicks = phraseBars * tpb;
  const barInPhrase = Math.floor(tickInSec / tpb) % phraseBars;
  const tickInBar = ((tickInSec % tpb) + tpb) % tpb;
  const period = 8;
  const lfo =
    0.5 +
    0.5 *
      Math.sin(
        (2 * Math.PI * (opts.section.startBar + tickInSec / tpb)) / period,
      );

  return {
    energy: opts.section.energy,
    sectionRamp: secTicks > 0 ? tickInSec / secTicks : 0,
    phraseRamp:
      phraseTicks > 0 ? (tickInSec % phraseTicks) / phraseTicks : 0,
    barInPhrase,
    beatStrength: beatStrengthAt(tickInBar, ppq),
    accent: opts.event.accent ? 1 : 0,
    velocity: opts.event.vel,
    lfoBars: lfo,
    holdPerPhrase: opts.rng(`${opts.path}/hold/${opts.section.id}`),
    occurrence: Math.min(1, opts.section.occurrence / 3),
    sampleEnvelope: 0.5,
  };
}

/** Sum routed modulation into an EventExpression (clamped). */
export function resolveEventExpression(
  routes: readonly ModRoute[],
  role: ExprRole,
  ctx: ModContext,
): EventExpression {
  const out: EventExpression = { ...DEFAULT_EXPR };
  // Role-ish defaults
  if (role === "kick" || role === "bass") {
    out.sendA = 0;
    out.pan = 0;
  }
  if (role === "hat") out.fadeOutMs = 30;
  if (role === "chord") {
    out.fadeInMs = 40;
    out.lpHz = 12000;
  }

  for (const route of routes) {
    if (route.roles && !route.roles.includes(role)) continue;
    let src = evalSource(route.source, ctx);
    if (route.source === "lfoBars" && route.period && route.period > 0) {
      // period already baked loosely in ctx; re-scale not needed
      src = ctx.lfoBars;
    }
    const x = curveMap(src, route.curve);
    const delta = (x - 0.5) * 2 * route.depth; // bipolar around depth
    // Unipolar sources that should add from 0
    const uni =
      route.source === "accent" ||
      route.source === "phraseRamp" ||
      route.source === "sectionRamp" ||
      route.source === "occurrence" ||
      route.source === "energy";
    const add = uni ? x * route.depth : delta;

    switch (route.dest) {
      case "gainDb":
        out.gainDb += add;
        break;
      case "lengthScale":
        out.lengthScale += uni ? add : delta;
        break;
      case "fadeOutMs":
        out.fadeOutMs += add;
        break;
      case "fadeInMs":
        out.fadeInMs += add;
        break;
      case "offsetMs":
        out.offsetMs += add;
        break;
      case "roundRobin":
        out.roundRobin = Math.floor(Math.abs(x * route.depth));
        break;
      case "pitchCents":
        out.pitchCents += add;
        break;
      case "pan":
        out.pan += add;
        break;
      case "lpHz":
        out.lpHz += add;
        break;
      case "sendA":
        out.sendA += add;
        break;
      case "sendB":
        out.sendB += add;
        break;
      case "reverse":
        out.reverse = x * route.depth > 0.5 ? 1 : 0;
        break;
      default:
        break;
    }
  }

  out.lengthScale = Math.min(2, Math.max(0.25, out.lengthScale));
  out.gainDb = Math.min(6, Math.max(-12, out.gainDb));
  out.pan = Math.min(1, Math.max(-1, out.pan));
  out.sendA = Math.min(1, Math.max(0, out.sendA));
  out.sendB = Math.min(1, Math.max(0, out.sendB));
  out.fadeInMs = Math.max(0, out.fadeInMs);
  out.fadeOutMs = Math.max(5, out.fadeOutMs);
  out.lpHz = Math.min(20000, Math.max(200, out.lpHz));
  out.pitchCents = Math.min(50, Math.max(-50, out.pitchCents));
  return out;
}

/**
 * Apply lengthScale + gain into existing NoteEvent fields (vel / durTick).
 * Full EventExpression is for the render layer; this keeps score listenable.
 */
export function applyExpressionToParts(
  parts: TrackPart[],
  sections: readonly Section[],
  routes: readonly ModRoute[],
  rng: Rng,
  ppq: number = PPQ,
): TrackPart[] {
  if (routes.length === 0) return parts;
  const tpb = ppq * 4;

  return parts.map((part) => {
    const events = part.events.map((ev) => {
      const section =
        sections.find(
          (s) =>
            ev.tick >= s.startBar * tpb &&
            ev.tick < (s.startBar + s.bars) * tpb,
        ) ?? sections[0];
      if (!section) return ev;
      const ctx = buildModContext({
        section,
        tick: ev.tick,
        event: ev,
        ppq,
        rng,
        path: `mod/track:${part.trackIndex}`,
      });
      const expr = resolveEventExpression(routes, part.role, ctx);
      const gainLin = 10 ** (expr.gainDb / 20);
      return {
        ...ev,
        vel: Math.min(1, Math.max(0.05, ev.vel * gainLin)),
        durTick: Math.max(
          Math.floor(ppq / 8),
          Math.round(ev.durTick * expr.lengthScale),
        ),
      };
    });
    return { ...part, events };
  });
}

/** Count routes that can change clip params beyond accent→vel. */
export function modulationDepth(routes: readonly ModRoute[]): number {
  return routes.reduce((s, r) => s + Math.abs(r.depth), 0);
}

export type { EventParam };
