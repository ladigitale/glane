/** Narrative phases for the landing backdrop — full Glane pipeline. */
export type LandingFlowPhaseId =
  | "capture"
  | "detect"
  | "library"
  | "arrange"
  | "export";

export const LANDING_FLOW_CYCLE_S = 28;

export const LANDING_FLOW_PHASES: ReadonlyArray<{
  id: LandingFlowPhaseId;
  duration: number;
}> = [
  { id: "capture", duration: 5 },
  { id: "detect", duration: 5 },
  { id: "library", duration: 5 },
  { id: "arrange", duration: 7 },
  { id: "export", duration: 6 },
];

const BLEND_FRAC = 0.2;

/** Smooth step for phase crossfades (0→1). */
export function landingBlendEase(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
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
        local > 1 - BLEND_FRAC
          ? (local - (1 - BLEND_FRAC)) / BLEND_FRAC
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
 * One phase at a time — outgoing fades first half of blend, incoming second half.
 * Avoids two groups at the same spot (z-fight / blink).
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
  if (t <= 0.5) {
    w[state.id] = 1 - t * 2;
  } else {
    w[state.next] = (t - 0.5) * 2;
  }
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
