/** Helpers for scheduling AutomationLane-like curves onto AudioParams. */

export type AutoCurve = "step" | "lin" | "exp" | "s";

export type SchedAutoPoint = {
  sample: number;
  value: number;
  curve: AutoCurve;
};

export type SchedAutoLane = {
  scope: "track" | "master";
  trackId?: string;
  param: "gainDb" | "hpHz" | "lpHz" | "pan" | "sendA" | "sendB";
  points: SchedAutoPoint[];
  /** Track fader linear gain — automation gainDb is an offset in dB. */
  baseGainLin?: number;
};

export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

/** Interpolate lane value at a sample index. */
export function autoValueAt(
  points: readonly SchedAutoPoint[],
  sample: number,
): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  if (sample <= first.sample) return first.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (sample > b.sample) continue;
    if (a.curve === "step" || b.sample <= a.sample) return a.value;
    const t = (sample - a.sample) / (b.sample - a.sample);
    const u =
      a.curve === "exp" ? t * t : a.curve === "s" ? t * t * (3 - 2 * t) : t;
    return a.value + (b.value - a.value) * u;
  }
  return points[points.length - 1]!.value;
}

/** Map automation value → AudioParam units for a known param. */
export function autoParamUnits(
  param: SchedAutoLane["param"],
  value: number,
  baseGainLin = 1,
): number {
  if (param === "gainDb") {
    return Math.max(0, baseGainLin * dbToLin(value));
  }
  if (param === "pan") {
    return Math.min(1, Math.max(-1, value));
  }
  if (param === "hpHz") {
    return Math.min(18_000, Math.max(20, value));
  }
  if (param === "sendA" || param === "sendB") {
    return Math.min(1, Math.max(0, value));
  }
  // lpHz
  return Math.min(20_000, Math.max(200, value));
}

/**
 * Schedule points onto an AudioParam for [fromSample, toSample).
 * Cancels from `audioNow` then sets current + ramps.
 */
export function scheduleAutoParam(
  param: AudioParam,
  lane: SchedAutoLane,
  opts: {
    fromSample: number;
    toSample: number;
    audioNow: number;
    originSample: number;
    originCtxTime: number;
    sampleRate: number;
    /** Master gainDb is absolute; track gainDb uses baseGainLin. */
    absoluteGain?: boolean;
  },
): void {
  const pts = [...lane.points].sort((a, b) => a.sample - b.sample);
  if (pts.length === 0) return;

  const sampleToTime = (s: number) =>
    opts.originCtxTime + (s - opts.originSample) / opts.sampleRate;

  const base = lane.baseGainLin ?? 1;
  const toUnits = (v: number) => {
    if (lane.param === "gainDb" && opts.absoluteGain) {
      return Math.max(0, dbToLin(v));
    }
    return autoParamUnits(lane.param, v, base);
  };

  param.cancelScheduledValues(opts.audioNow);
  const cur = toUnits(autoValueAt(pts, opts.fromSample));
  param.setValueAtTime(cur, opts.audioNow);

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.sample < opts.fromSample) continue;
    if (p.sample >= opts.toSample) break;
    const t = Math.max(opts.audioNow, sampleToTime(p.sample));
    const v = toUnits(p.value);
    const prev = i > 0 ? pts[i - 1]! : null;
    if (!prev || prev.curve === "step" || p.curve === "step") {
      param.setValueAtTime(v, t);
    } else {
      param.linearRampToValueAtTime(v, t);
    }
  }
}
