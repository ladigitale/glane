export type InterestScoreInput = {
  pcm: Float32Array;
  sampleRate: number;
  kind: "oneshot" | "texture";
  /** Optional live/classifier confidence 0–1. */
  confidence?: number;
  loopScore?: number;
};

/**
 * 0–1 “how worth keeping” after polish.
 * Favors clear energy, useful duration, punchy crest (oneshot) or loopability (texture).
 */
export function computeInterestScore(input: InterestScoreInput): number {
  const { pcm, sampleRate, kind } = input;
  if (!pcm.length || sampleRate <= 0) return 0;

  let sum = 0;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i] ?? 0;
    sum += x;
    sumSq += x * x;
    const a = Math.abs(x);
    if (a > peak) peak = a;
  }
  const n = pcm.length;
  const rms = Math.sqrt(sumSq / n);
  const mean = sum / n;
  let varAcc = 0;
  for (let i = 0; i < n; i++) {
    const d = (pcm[i] ?? 0) - mean;
    varAcc += d * d;
  }
  const std = Math.sqrt(varAcc / n);
  const crest = peak / (rms + 1e-9);
  const durationMs = (n / sampleRate) * 1000;

  // Loud enough vs near-silence
  const energy = clamp01((rms - 0.01) / 0.12);

  // Duration sweet spots
  const duration =
    kind === "texture"
      ? bell(durationMs, 900, 3500, 12_000)
      : bell(durationMs, 60, 280, 2500);

  // Oneshot: attack punch; texture: steadier crest is fine
  const shape =
    kind === "texture"
      ? clamp01(0.35 + (1 - clamp01((crest - 2) / 14)) * 0.5)
      : clamp01((crest - 1.8) / 6);

  // Dynamic range (flat noise / DC → low)
  const dynamics = clamp01(std / (peak + 1e-9) / 0.35);

  const confidence = clamp01(input.confidence ?? 0.55);
  const loop =
    kind === "texture" ? clamp01(input.loopScore ?? 0.35) : 0.5;

  const raw =
    energy * 0.28 +
    duration * 0.22 +
    shape * 0.22 +
    dynamics * 0.12 +
    confidence * 0.08 +
    loop * 0.08;

  // Near-silence cannot be “interesting” even with a sweet duration.
  const gated = raw * (0.15 + 0.85 * energy);
  return Math.round(clamp01(gated) * 1000) / 1000;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Triangular-ish membership: 0 outside [lo, hi], 1 at mid. */
function bell(x: number, lo: number, mid: number, hi: number): number {
  if (x <= lo || x >= hi) return 0;
  if (x === mid) return 1;
  if (x < mid) return (x - lo) / Math.max(1e-9, mid - lo);
  return (hi - x) / Math.max(1e-9, hi - mid);
}
