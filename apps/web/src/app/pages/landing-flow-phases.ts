/** Narrative phases for the landing backdrop — full Glane pipeline. */
export type LandingFlowPhaseId =
  | "capture"
  | "detect"
  | "library"
  | "arrange"
  | "export";

export const LANDING_FLOW_CYCLE_S = 34;

export const LANDING_FLOW_PHASES: ReadonlyArray<{
  id: LandingFlowPhaseId;
  duration: number;
}> = [
  { id: "capture", duration: 5.5 },
  { id: "detect", duration: 5.5 },
  { id: "library", duration: 5.5 },
  /** Extra time to receive library pieces, settle, then scroll the timeline. */
  { id: "arrange", duration: 10.5 },
  { id: "export", duration: 7 },
];

/** Short tail — snappy handoff between creative steps. */
export const LANDING_BLEND_FRAC = 0.18;

/** Symmetric motion ease — position/scale A→B. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Fast opacity ease — phase A drops quickly at blend start. */
export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Opacity / visibility crossfade (not motion).
 * Compressed so A is nearly gone before the blend midpoint.
 */
export function landingOpacityEase(t: number): number {
  const x = Math.max(0, Math.min(1, t * 1.35));
  return easeOutCubic(x);
}

/** Camera / visibility use the snappy opacity curve. */
export function landingBlendEase(t: number): number {
  return landingOpacityEase(t);
}

export type LandingPhaseState = {
  id: LandingFlowPhaseId;
  /** 0…1 within the active phase. */
  local: number;
  next: LandingFlowPhaseId;
  /** 0…1 crossfade toward `next` at phase tail. */
  blend: number;
};

export function landingPhaseAt(timeS: number): LandingPhaseState {
  const loop =
    ((timeS % LANDING_FLOW_CYCLE_S) + LANDING_FLOW_CYCLE_S) %
    LANDING_FLOW_CYCLE_S;
  let acc = 0;
  for (let i = 0; i < LANDING_FLOW_PHASES.length; i++) {
    const phase = LANDING_FLOW_PHASES[i]!;
    const end = acc + phase.duration;
    if (loop < end) {
      const local = (loop - acc) / phase.duration;
      const next =
        LANDING_FLOW_PHASES[(i + 1) % LANDING_FLOW_PHASES.length]!.id;
      const blend =
        local > 1 - LANDING_BLEND_FRAC
          ? (local - (1 - LANDING_BLEND_FRAC)) / LANDING_BLEND_FRAC
          : 0;
      return { id: phase.id, local, next, blend };
    }
    acc = end;
  }
  const last = LANDING_FLOW_PHASES[LANDING_FLOW_PHASES.length - 1]!;
  return {
    id: last.id,
    local: 1,
    next: LANDING_FLOW_PHASES[0]!.id,
    blend: 0,
  };
}

export function landingPhaseDuration(id: LandingFlowPhaseId): number {
  return LANDING_FLOW_PHASES.find((p) => p.id === id)?.duration ?? 5;
}

/** Seconds elapsed since the start of `phaseId` within the current cycle. */
export function landingPhaseClock(
  timeS: number,
  phaseId: LandingFlowPhaseId,
): number {
  const loop =
    ((timeS % LANDING_FLOW_CYCLE_S) + LANDING_FLOW_CYCLE_S) %
    LANDING_FLOW_CYCLE_S;
  let acc = 0;
  for (const phase of LANDING_FLOW_PHASES) {
    const end = acc + phase.duration;
    if (phase.id === phaseId) return Math.max(0, loop - acc);
    acc = end;
  }
  return 0;
}

/** 0…1 progress within `phaseId` for the current cycle (continuous, no blend reset). */
export function landingPhaseProgress(
  timeS: number,
  phaseId: LandingFlowPhaseId,
): number {
  const dur = landingPhaseDuration(phaseId);
  if (dur <= 0) return 0;
  return Math.min(1, landingPhaseClock(timeS, phaseId) / dur);
}

/**
 * Motion clock for `phaseId`, starting `LANDING_BLEND_FRAC` of the previous
 * phase early so scene B is already moving during the A→B handoff.
 */
export function landingPhaseMotionClock(
  timeS: number,
  phaseId: LandingFlowPhaseId,
): number {
  const loop =
    ((timeS % LANDING_FLOW_CYCLE_S) + LANDING_FLOW_CYCLE_S) %
    LANDING_FLOW_CYCLE_S;
  let acc = 0;
  for (let i = 0; i < LANDING_FLOW_PHASES.length; i++) {
    const phase = LANDING_FLOW_PHASES[i]!;
    if (phase.id === phaseId) {
      const prev = LANDING_FLOW_PHASES[i === 0 ? LANDING_FLOW_PHASES.length - 1 : i - 1]!;
      const lead = prev.duration * LANDING_BLEND_FRAC;
      return Math.max(0, loop - (acc - lead));
    }
    acc += phase.duration;
  }
  return 0;
}

/** Linear 0…1 blend from `from` into `to` (no easing). */
export function landingHandoffLinear(
  timeS: number,
  from: LandingFlowPhaseId,
  to: LandingFlowPhaseId,
): number {
  const state = landingPhaseAt(timeS);
  if (state.id === from && state.next === to) return state.blend;
  if (state.id === to) return 1;
  const order = LANDING_FLOW_PHASES.map((p) => p.id);
  const iFrom = order.indexOf(from);
  const iTo = order.indexOf(to);
  const iCur = order.indexOf(state.id);
  if (iFrom >= 0 && iTo >= 0 && iCur >= 0) {
    if (iTo > iFrom && iCur > iTo) return 1;
    if (iTo < iFrom && (iCur > iTo || iCur < iFrom)) return 1;
  }
  return 0;
}

function handoffRaw(linear: number, index: number): number {
  const lag = (index % 4) * 0.035;
  const span = Math.max(0.001, 1 - lag);
  return Math.min(1, Math.max(0, (linear - lag) / span));
}

/** 0…1 opacity handoff (fast out) when `from` blends into `to`. */
export function landingHandoff(
  timeS: number,
  from: LandingFlowPhaseId,
  to: LandingFlowPhaseId,
): number {
  return landingOpacityEase(landingHandoffLinear(timeS, from, to));
}

/**
 * Shared A→B motion progress (easeInOutCubic) — identical on both scenes.
 */
export function landingHandoffMotion(
  timeS: number,
  from: LandingFlowPhaseId,
  to: LandingFlowPhaseId,
  index = 0,
): number {
  return easeInOutCubic(
    handoffRaw(landingHandoffLinear(timeS, from, to), index),
  );
}

/** Opacity progress for object `index` — fast A exit / B entry. */
export function landingHandoffOpacity(
  timeS: number,
  from: LandingFlowPhaseId,
  to: LandingFlowPhaseId,
  index = 0,
): number {
  return landingOpacityEase(
    handoffRaw(landingHandoffLinear(timeS, from, to), index),
  );
}

/**
 * One step at a time with overlapping morph during blend
 * (outgoing shrinks / fades while incoming grows).
 */
export function landingPhaseVisibility(
  state: LandingPhaseState,
): Record<LandingFlowPhaseId, number> {
  const w: Record<LandingFlowPhaseId, number> = {
    capture: 0,
    detect: 0,
    library: 0,
    arrange: 0,
    export: 0,
  };
  if (state.blend <= 0.001) {
    w[state.id] = 1;
    return w;
  }
  const t = landingBlendEase(state.blend);
  w[state.id] = 1 - t;
  w[state.next] = t;
  return w;
}

/** @deprecated Prefer landingPhaseProgress — kept for crossfade weight hints. */
export function landingDriverLocal(
  state: LandingPhaseState,
  phaseId: LandingFlowPhaseId,
): number {
  if (phaseId === state.id) return state.local;
  if (state.blend > 0 && phaseId === state.next) return state.blend;
  return 0;
}
