/** 33⅓ RPM → deg/s (one revolution = 360°). */
export const TURNTABLE_33_DEG_PER_SEC = (33 + 1 / 3) * 6;

/** Light EMA on gyro rate (ms). */
export const TURNTABLE_RATE_TAU_MS = 40;

/** Ignore |ω| below this (deg/s) → hold. */
export const TURNTABLE_OMEGA_EPS = 4;

/**
 * Map platter angular speed (deg/s, signed) → playback rate.
 * +200°/s ≈ 33⅓ RPM forward = 1×. No max clamp.
 */
export function turntableRateFromOmega(
  omegaDegPerSec: number,
  refDegPerSec = TURNTABLE_33_DEG_PER_SEC,
): number {
  if (!(refDegPerSec > 0) || !Number.isFinite(omegaDegPerSec)) return 0;
  if (Math.abs(omegaDegPerSec) < TURNTABLE_OMEGA_EPS) return 0;
  const rate = omegaDegPerSec / refDegPerSec;
  return Number.isFinite(rate) ? rate : 0;
}

/** EMA step for noisy gyro samples. */
export function smoothTurntableRate(
  prev: number,
  instant: number,
  deltaMs: number,
  tauMs = TURNTABLE_RATE_TAU_MS,
): number {
  if (!(deltaMs > 0) || !Number.isFinite(instant) || !Number.isFinite(prev)) {
    return prev;
  }
  const a = 1 - Math.exp(-deltaMs / Math.max(1, tauMs));
  return prev + (instant - prev) * a;
}

/**
 * Pick the dominant rotation axis while the phone lies roughly flat
 * (face up on a platter): prefer Z / alpha.
 */
export function platterOmegaFromRotationRate(rr: {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}): number {
  const a = rr.alpha;
  const b = rr.beta;
  const g = rr.gamma;
  const candidates = [a, b, g].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (candidates.length === 0) return 0;
  // Alpha is yaw around screen-normal when device is flat — best platter axis.
  if (a != null && Number.isFinite(a)) return a;
  let best = candidates[0]!;
  for (const v of candidates) {
    if (Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

export type TurntableMotionPermission = "granted" | "denied" | "prompt" | "unsupported";

export function turntableMotionSupport(): TurntableMotionPermission {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") {
    return "unsupported";
  }
  const Ctor = DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof Ctor.requestPermission === "function") return "prompt";
  return "granted";
}

/** iOS requires a user-gesture call to requestPermission. */
export async function requestTurntableMotionPermission(): Promise<boolean> {
  const support = turntableMotionSupport();
  if (support === "unsupported") return false;
  if (support === "granted") return true;
  const Ctor = DeviceMotionEvent as unknown as {
    requestPermission: () => Promise<"granted" | "denied">;
  };
  try {
    const r = await Ctor.requestPermission();
    return r === "granted";
  } catch {
    return false;
  }
}

export type TurntableGyroHandle = {
  stop: () => void;
};

/**
 * Subscribe to device rotation rate; `onRate` gets signed playback rate (1 = 33⅓).
 */
export function startTurntableGyro(
  onRate: (rate: number) => void,
): TurntableGyroHandle {
  let smooth = 0;
  let lastT = performance.now();
  const onMotion = (e: DeviceMotionEvent): void => {
    const rr = e.rotationRate;
    if (!rr) return;
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    const omega = platterOmegaFromRotationRate({
      alpha: rr.alpha,
      beta: rr.beta,
      gamma: rr.gamma,
    });
    const instant = turntableRateFromOmega(omega);
    smooth = smoothTurntableRate(smooth, instant, dt);
    onRate(smooth);
  };
  window.addEventListener("devicemotion", onMotion, { passive: true });
  return {
    stop: () => {
      window.removeEventListener("devicemotion", onMotion);
    },
  };
}
