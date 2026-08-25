/** Scroll / wrap math for the landing WebGL waveform + particles. */

/** Unbounded tape travel distance (world units). */
export function waveTravel(timeS: number, speed: number): number {
  return Math.max(0, timeS) * speed;
}

/** Toroidal wrap into (−half, half] so bars stay full-bleed after long runtimes. */
export function wrapCentered(v: number, span: number): number {
  if (span <= 0) return v;
  const half = span * 0.5;
  return ((((v + half) % span) + span) % span) - half;
}

/** Zoomed-in sample: fewer, thicker columns across the frustum. */
export const BAR_SPACING = 0.32;
export const BAR_N = 48;
export const BAR_SPAN = BAR_N * BAR_SPACING;
export const PARTICLE_WRAP_X = BAR_SPAN;
/** Steady tape speed — continuous motion, no stepped height updates. */
export const WAVE_SPEED = 12.8;

type SampleHit = {
  at: number;
  attack: number;
  decay: number;
  peak: number;
  tag: number;
};

/** Sparse hits with firm attacks + long decays (zoomed sample grain). */
const SAMPLE_HITS: readonly SampleHit[] = [
  { at: 2, attack: 1, decay: 8, peak: 1, tag: 0 },
  { at: 12, attack: 1, decay: 4, peak: 0.55, tag: 1 },
  { at: 17, attack: 1, decay: 10, peak: 0.95, tag: 2 },
  { at: 29, attack: 1, decay: 5, peak: 0.78, tag: 0 },
  { at: 36, attack: 1, decay: 3, peak: 0.45, tag: 1 },
  { at: 40, attack: 1, decay: 9, peak: 0.9, tag: 2 },
];

const FLOOR = 0.035;

function buildSampleAmps(): Float32Array {
  const out = new Float32Array(BAR_N);
  out.fill(FLOOR);
  for (const hit of SAMPLE_HITS) {
    const len = hit.attack + hit.decay;
    for (let i = 0; i < len; i++) {
      const idx = (hit.at + i) % BAR_N;
      const env =
        i < hit.attack
          ? (i + 1) / hit.attack
          : Math.exp(-3.4 * ((i - hit.attack) / Math.max(1, hit.decay)));
      const grit = 0.72 + 0.28 * Math.abs(Math.sin(idx * 2.17 + hit.tag));
      out[idx] = Math.max(out[idx]!, hit.peak * env * grit);
    }
  }
  return out;
}

function buildSampleTags(): Int8Array {
  const out = new Int8Array(BAR_N);
  out.fill(-1);
  for (const hit of SAMPLE_HITS) {
    const len = hit.attack + hit.decay;
    for (let i = 0; i < len; i++) {
      const idx = (hit.at + i) % BAR_N;
      const env =
        i < hit.attack
          ? (i + 1) / hit.attack
          : Math.exp(-3.4 * ((i - hit.attack) / Math.max(1, hit.decay)));
      if (env > 0.08) out[idx] = hit.tag as 0 | 1 | 2;
    }
  }
  return out;
}

const SAMPLE_AMPS = buildSampleAmps();
const SAMPLE_TAGS = buildSampleTags();

export function ampForSlot(slot: number): number {
  const i = ((Math.floor(slot) % BAR_N) + BAR_N) % BAR_N;
  const base = SAMPLE_AMPS[i]!;
  // Slow cycle wobble so recycled columns stay on-the-fly, not a frozen loop.
  const cycle = Math.floor(Math.floor(slot) / BAR_N);
  const wobble = 1 + 0.1 * Math.sin(cycle * 1.9 + i * 0.31);
  return Math.min(1, Math.max(FLOOR, base * wobble));
}

export function tagForSlot(slot: number): number {
  const i = ((Math.floor(slot) % BAR_N) + BAR_N) % BAR_N;
  return SAMPLE_TAGS[i]!;
}

export function barX(i: number, travel: number): number {
  return wrapCentered(i * BAR_SPACING - travel, BAR_SPAN);
}

/**
 * Stateful tape: each bar keeps a fixed height while it slides;
 * only bars that wrap left→right pick a new on-the-fly size.
 * Positions follow continuous `travel` — no stepped height stutter.
 */
export type BarTape = {
  readonly heights: Float32Array;
  readonly tags: Int8Array;
  sync(travel: number): void;
};

export function wrapsBetween(i: number, t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  const half = BAR_SPAN * 0.5;
  const p0 = i * BAR_SPACING - t0;
  const p1 = i * BAR_SPACING - t1;
  return (
    Math.floor((p0 + half) / BAR_SPAN) - Math.floor((p1 + half) / BAR_SPAN)
  );
}

export function createBarTape(): BarTape {
  const heights = new Float32Array(BAR_N);
  const tags = new Int8Array(BAR_N);
  let nextSlot = BAR_N;
  let lastTravel = 0;
  const seed = () => {
    nextSlot = BAR_N;
    for (let i = 0; i < BAR_N; i++) {
      heights[i] = ampForSlot(i);
      tags[i] = tagForSlot(i);
    }
  };
  seed();
  return {
    heights,
    tags,
    sync(travel: number) {
      // Narrative cycle rewind → same starting sample as pass 1.
      if (travel < lastTravel - 1e-9) {
        seed();
        lastTravel = 0;
      }
      if (travel <= lastTravel) {
        lastTravel = travel;
        return;
      }
      for (let i = 0; i < BAR_N; i++) {
        const n = wrapsBetween(i, lastTravel, travel);
        for (let w = 0; w < n; w++) {
          heights[i] = ampForSlot(nextSlot);
          tags[i] = tagForSlot(nextSlot);
          nextSlot += 1;
        }
      }
      lastTravel = travel;
    },
  };
}
