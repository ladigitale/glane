import { PPQ } from "@glane/core-model";
import type {
  AutomationLane,
  AutoPoint,
  Gesture,
  GestureKind,
  Section,
  TrackPart,
} from "./types.js";

function lane(
  target: AutomationLane["target"],
  points: AutoPoint[],
  gesture: string,
): AutomationLane {
  return { target, points, gesture };
}

function ramp(
  fromTick: number,
  toTick: number,
  fromVal: number,
  toVal: number,
  curve: AutoPoint["curve"] = "lin",
): AutoPoint[] {
  return [
    { tick: fromTick, value: fromVal, curve: "step" },
    { tick: toTick, value: toVal, curve },
  ];
}

function trackIndices(
  tracks: Gesture["tracks"],
  parts: readonly TrackPart[],
): number[] {
  if (tracks === "all") return parts.map((p) => p.trackIndex);
  if (tracks === "nonKick") {
    return parts.filter((p) => p.role !== "kick").map((p) => p.trackIndex);
  }
  return tracks;
}

/** Place gestures from form transitions + energy curve. */
export function planGestures(opts: {
  sections: readonly Section[];
  parts: readonly TrackPart[];
  layerMatrix: boolean[][];
  ppq?: number;
}): Gesture[] {
  const ppq = opts.ppq ?? PPQ;
  const tpb = ppq * 4;
  const gestures: Gesture[] = [];
  const activeTracks = (si: number): number[] => {
    const out: number[] = [];
    for (let t = 0; t < opts.layerMatrix.length; t++) {
      if (opts.layerMatrix[t]?.[si]) out.push(t);
    }
    return out.length ? out : opts.parts.map((p) => p.trackIndex);
  };

  for (let i = 0; i < opts.sections.length; i++) {
    const sec = opts.sections[i]!;
    const start = sec.startBar * tpb;
    const end = (sec.startBar + sec.bars) * tpb;
    const tracks = activeTracks(i);
    const nonKick = tracks.filter((ti) => {
      const p = opts.parts.find((x) => x.trackIndex === ti);
      return p?.role !== "kick";
    });

    if (i === 0 || sec.kind === "intro") {
      gestures.push({
        kind: "fadeIn",
        fromTick: start,
        toTick: start + Math.min(sec.bars, 4) * tpb,
        tracks: "all",
        amount: 1,
        path: `gesture/${sec.id}/fadeIn`,
      });
    }

    if (sec.kind === "outro") {
      gestures.push({
        kind: "fadeOut",
        fromTick: Math.max(start, end - Math.min(sec.bars, 4) * tpb),
        toTick: end,
        tracks: "all",
        amount: 1,
        path: `gesture/${sec.id}/fadeOut`,
      });
    }

    if (
      sec.kind === "prechorus" ||
      sec.kind === "build" ||
      (sec.transitionIn === "riser" && sec.energy >= 0.55)
    ) {
      gestures.push({
        kind: "build",
        fromTick: start,
        toTick: end,
        tracks: nonKick.length ? nonKick : "nonKick",
        amount: 0.7 + sec.energy * 0.3,
        path: `gesture/${sec.id}/build`,
      });
    }

    if (sec.kind === "chorus" || sec.kind === "drop") {
      gestures.push({
        kind: "drop",
        fromTick: start,
        toTick: start + Math.floor(tpb / 2),
        tracks: "all",
        amount: 1,
        path: `gesture/${sec.id}/drop`,
      });
      gestures.push({
        kind: "dryPunch",
        fromTick: start,
        toTick: start + tpb,
        tracks: "all",
        amount: 0.8,
        path: `gesture/${sec.id}/dryPunch`,
      });
    }

    if (sec.kind === "bridge" || sec.kind === "break") {
      gestures.push({
        kind: "breakdown",
        fromTick: start,
        toTick: start + Math.min(2, sec.bars) * tpb,
        tracks: nonKick.length ? nonKick : "nonKick",
        amount: 0.7,
        path: `gesture/${sec.id}/breakdown`,
      });
    }

    // Energy rise into next section → swell/build cue
    const next = opts.sections[i + 1];
    if (next && next.energy > sec.energy + 0.12) {
      const hasBuild = gestures.some(
        (g) => g.path === `gesture/${sec.id}/build`,
      );
      if (!hasBuild) {
        gestures.push({
          kind: "swell",
          fromTick: end - tpb,
          toTick: end,
          tracks: nonKick.length ? nonKick : "nonKick",
          amount: next.energy - sec.energy,
          path: `gesture/${sec.id}/swell`,
        });
      }
    }
  }

  return gestures;
}

/**
 * Compile gestures → automation lanes.
 * Priority when overlapping same target: drop > build > breakdown > swell > LFO.
 */
export function compileGestures(opts: {
  gestures: readonly Gesture[];
  parts: readonly TrackPart[];
  life?: number;
}): AutomationLane[] {
  const life = opts.life ?? 0.5;
  const lanes: AutomationLane[] = [];
  const priority: Record<GestureKind, number> = {
    drop: 100,
    dryPunch: 95,
    build: 80,
    breakdown: 70,
    fadeIn: 60,
    fadeOut: 60,
    swell: 50,
    spaceBloom: 45,
    duck: 40,
    dubThrow: 35,
    filterSweep: 30,
    tapeStop: 25,
    stutterOut: 20,
  };

  const sorted = [...opts.gestures].sort(
    (a, b) => (priority[b.kind] ?? 0) - (priority[a.kind] ?? 0),
  );

  for (const g of sorted) {
    const idxs = trackIndices(g.tracks, opts.parts);
    const amt = g.amount;

    switch (g.kind) {
      case "fadeIn":
        lanes.push(
          lane(
            { scope: "master", param: "gainDb" },
            ramp(g.fromTick, g.toTick, -24, 0, "s"),
            g.kind,
          ),
        );
        break;
      case "fadeOut":
        lanes.push(
          lane(
            { scope: "master", param: "gainDb" },
            ramp(g.fromTick, g.toTick, 0, -36, "s"),
            g.kind,
          ),
        );
        break;
      case "build":
        for (const ti of idxs) {
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "hpHz" },
              ramp(g.fromTick, g.toTick, 20, 20 + 280 * amt, "lin"),
              g.kind,
            ),
          );
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "sendA" },
              ramp(g.fromTick, g.toTick, 0.1, 0.1 + 0.45 * amt, "lin"),
              g.kind,
            ),
          );
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "gainDb" },
              ramp(g.fromTick, g.toTick, 0, 1.5 * amt, "lin"),
              g.kind,
            ),
          );
        }
        lanes.push(
          lane(
            { scope: "bus", bus: "A", param: "decay" },
            ramp(g.fromTick, g.toTick, 0.35, 0.35 + 0.4 * amt, "lin"),
            g.kind,
          ),
        );
        break;
      case "drop":
        for (const ti of idxs) {
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "hpHz" },
              [
                { tick: g.fromTick, value: 20, curve: "step" },
                { tick: g.toTick, value: 20, curve: "step" },
              ],
              g.kind,
            ),
          );
        }
        lanes.push(
          lane(
            { scope: "bus", bus: "A", param: "decay" },
            [{ tick: g.fromTick, value: 0.25, curve: "step" }],
            g.kind,
          ),
        );
        break;
      case "dryPunch":
        lanes.push(
          lane(
            { scope: "bus", bus: "A", param: "returnDb" },
            ramp(g.fromTick, g.toTick, -18, -6, "lin"),
            g.kind,
          ),
        );
        break;
      case "breakdown":
        lanes.push(
          lane(
            { scope: "master", param: "lpHz" },
            ramp(g.fromTick, g.toTick, 18000, 2000, "lin"),
            g.kind,
          ),
        );
        lanes.push(
          lane(
            { scope: "bus", bus: "A", param: "decay" },
            ramp(g.fromTick, g.toTick, 0.4, 0.85, "lin"),
            g.kind,
          ),
        );
        break;
      case "swell":
        for (const ti of idxs.slice(0, 3)) {
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "lpHz" },
              ramp(g.fromTick, g.toTick, 4000, 16000, "s"),
              g.kind,
            ),
          );
          lanes.push(
            lane(
              { scope: "track", trackIndex: ti, param: "gainDb" },
              ramp(g.fromTick, g.toTick, -1, 2 * amt, "lin"),
              g.kind,
            ),
          );
        }
        break;
      default:
        break;
    }
  }

  // Slow LFO colour when life > 0
  if (life >= 0.35) {
    for (const p of opts.parts) {
      if (p.role === "kick" || p.role === "bass") continue;
      const periodBars = p.role === "hat" ? 8 : 16;
      const end =
        opts.parts.reduce((m, x) => {
          const last = x.events[x.events.length - 1];
          return last ? Math.max(m, last.tick) : m;
        }, 0) || periodBars * PPQ * 4;
      const pts: AutoPoint[] = [];
      const steps = Math.max(4, Math.floor(end / (PPQ * 4 * (periodBars / 4))));
      for (let i = 0; i <= steps; i++) {
        const t = Math.floor((i / steps) * end);
        const v = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / steps);
        pts.push({
          tick: t,
          value: p.role === "perc" ? -0.3 + v * 0.6 : 8000 + v * 6000 * life,
          curve: "lin",
        });
      }
      lanes.push(
        lane(
          {
            scope: "track",
            trackIndex: p.trackIndex,
            param: p.role === "perc" ? "pan" : "lpHz",
          },
          pts,
          "lfo",
        ),
      );
    }
  }

  return dedupeLanes(lanes);
}

/** Keep highest-priority gesture lane per target key (first wins after sort). */
function dedupeLanes(lanes: AutomationLane[]): AutomationLane[] {
  const seen = new Set<string>();
  const out: AutomationLane[] = [];
  for (const l of lanes) {
    const key = JSON.stringify(l.target);
    // Allow multiple non-overlapping later; for v1 keep first per target
    if (seen.has(key) && l.gesture !== "lfo") continue;
    if (l.gesture !== "lfo") seen.add(key);
    out.push(l);
  }
  return out;
}

/** True if energy-up transitions carry a build/swell/fill-like gesture. */
export function transitionsCoordinated(
  sections: readonly Section[],
  gestures: readonly Gesture[],
): boolean {
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]!;
    const b = sections[i + 1]!;
    if (b.energy <= a.energy + 0.12) continue;
    const hit = gestures.some(
      (g) =>
        (g.kind === "build" || g.kind === "swell" || g.kind === "drop") &&
        (g.path.includes(a.id) || g.path.includes(b.id)),
    );
    if (!hit) return false;
  }
  return true;
}
