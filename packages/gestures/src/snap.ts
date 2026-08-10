/**
 * Magnetism + overlap helpers for the sequencer (spec §11.3–11.4).
 */

export type SnapTarget = {
  tick: number;
  kind: "clip-edge" | "playhead" | "marker" | "grid";
  priority: number;
};

export type SnapResult = {
  tick: number;
  snapped: boolean;
  target?: SnapTarget;
};

/** Priority: clip edge > playhead > marker > grid (lower number wins). */
export function snapTick(
  rawTick: number,
  targets: SnapTarget[],
  radiusTicks: number,
): SnapResult {
  let best: SnapTarget | undefined;
  let bestDist = Infinity;
  const sorted = [...targets].sort((a, b) => a.priority - b.priority);
  for (const t of sorted) {
    const d = Math.abs(t.tick - rawTick);
    if (d <= radiusTicks && d < bestDist) {
      // First matching priority band wins if equal priority with closer dist
      if (!best || t.priority < best.priority || d < bestDist) {
        best = t;
        bestDist = d;
        if (t.priority === sorted[0]?.priority && d <= radiusTicks) {
          // keep searching same priority for closer
        }
      }
    }
  }
  // Re-pick: among those within radius, prefer higher priority then closer
  best = undefined;
  bestDist = Infinity;
  let bestPri = Infinity;
  for (const t of targets) {
    const d = Math.abs(t.tick - rawTick);
    if (d > radiusTicks) continue;
    if (t.priority < bestPri || (t.priority === bestPri && d < bestDist)) {
      best = t;
      bestDist = d;
      bestPri = t.priority;
    }
  }
  if (!best) return { tick: rawTick, snapped: false };
  return { tick: best.tick, snapped: true, target: best };
}

export function gridTargets(
  fromTick: number,
  toTick: number,
  gridTicks: number,
): SnapTarget[] {
  if (gridTicks <= 0) return [];
  const out: SnapTarget[] = [];
  const start = Math.floor(fromTick / gridTicks) * gridTicks;
  for (let t = start; t <= toTick; t += gridTicks) {
    out.push({ tick: t, kind: "grid", priority: 4 });
  }
  return out;
}

export function clipEdgeTargets(
  clips: Array<{ startTick: number; lengthTick: number; id: string }>,
  excludeId?: string,
): SnapTarget[] {
  const out: SnapTarget[] = [];
  for (const c of clips) {
    if (c.id === excludeId) continue;
    out.push({ tick: c.startTick, kind: "clip-edge", priority: 1 });
    out.push({
      tick: c.startTick + c.lengthTick,
      kind: "clip-edge",
      priority: 1,
    });
  }
  return out;
}

/**
 * Hard constraint: overlap cannot exceed 50% of the shorter clip.
 * Returns clamped startTick for `moving` against `other` on same track.
 */
export function clipOverlapTicks(
  a: { startTick: number; lengthTick: number },
  b: { startTick: number; lengthTick: number },
): { startTick: number; lengthTick: number } | null {
  const start = Math.max(a.startTick, b.startTick);
  const end = Math.min(a.startTick + a.lengthTick, b.startTick + b.lengthTick);
  if (end <= start) return null;
  return { startTick: start, lengthTick: end - start };
}

export function clampOverlapStart(
  moving: { startTick: number; lengthTick: number },
  other: { startTick: number; lengthTick: number },
): { startTick: number; blocked: boolean } {
  const a0 = moving.startTick;
  const a1 = moving.startTick + moving.lengthTick;
  const b0 = other.startTick;
  const b1 = other.startTick + other.lengthTick;
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (overlap <= 0) return { startTick: moving.startTick, blocked: false };

  const shorter = Math.min(moving.lengthTick, other.lengthTick);
  const maxOverlap = shorter * 0.5;
  if (overlap <= maxOverlap) {
    return { startTick: moving.startTick, blocked: false };
  }

  // Push moving so overlap == maxOverlap
  const movingIsLeft = moving.startTick <= other.startTick;
  if (movingIsLeft) {
    // moving ends into other: start = other.start - length + maxOverlap
    const startTick = Math.round(
      other.startTick - moving.lengthTick + maxOverlap,
    );
    return { startTick, blocked: true };
  }
  const startTick = Math.round(other.startTick + other.lengthTick - maxOverlap);
  return { startTick, blocked: true };
}

/**
 * Clamp a trim (fixed opposite edge) so overlap ≤ 50% of the shorter clip.
 */
export function clampOverlapTrim(
  resized: { startTick: number; lengthTick: number },
  other: { startTick: number; lengthTick: number },
  edge: "start" | "end",
  minLength: number,
): { startTick: number; lengthTick: number; blocked: boolean } {
  const ov = clipOverlapTicks(resized, other);
  if (!ov) {
    return {
      startTick: resized.startTick,
      lengthTick: Math.max(minLength, resized.lengthTick),
      blocked: false,
    };
  }
  const shorter = Math.min(resized.lengthTick, other.lengthTick);
  const maxOverlap = shorter * 0.5;
  if (ov.lengthTick <= maxOverlap) {
    return {
      startTick: resized.startTick,
      lengthTick: Math.max(minLength, resized.lengthTick),
      blocked: false,
    };
  }
  if (edge === "end") {
    // Keep start; shrink end so overlap == maxOverlap
    const end = Math.round(other.startTick + maxOverlap);
    const lengthTick = Math.max(minLength, end - resized.startTick);
    return { startTick: resized.startTick, lengthTick, blocked: true };
  }
  // edge === start: keep end; push start
  const end = resized.startTick + resized.lengthTick;
  const startTick = Math.round(other.startTick + other.lengthTick - maxOverlap);
  const lengthTick = Math.max(minLength, end - startTick);
  return { startTick, lengthTick, blocked: true };
}

export function pxRadiusToTicks(
  radiusPx: number,
  pxPerTick: number,
): number {
  if (pxPerTick <= 0) return 0;
  return Math.max(1, Math.round(radiusPx / pxPerTick));
}
