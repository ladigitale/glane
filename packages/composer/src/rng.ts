import type { Path, Rng } from "./types.js";

/** xmur3-style 32-bit hash of `${seed}|${path}`. */
export function hash32(seed: number, path: Path): number {
  let h = 1779033703 ^ (seed >>> 0);
  const s = `${seed >>> 0}|${path}`;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Stateless mulberry32 one-shot from a 32-bit state → [0, 1). */
function mulberryOne(state: number): number {
  let t = (state + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Addressable RNG: `rng(seed, path)` → [0, 1). No shared state. */
export function rng(seed: number, path: Path): number {
  return mulberryOne(hash32(seed, path));
}

/** Curry seed into a path → [0,1) function. */
export function makeRng(seed: number): Rng {
  return (path) => rng(seed, path);
}

export function withSalt(path: Path, salt: string): Path {
  return salt ? `${path}#salt:${salt}` : path;
}

export function pick<T>(r: Rng, path: Path, arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error(`pick: empty array at ${path}`);
  }
  const i = Math.floor(r(path) * arr.length) % arr.length;
  return arr[i]!;
}

export function weighted<T>(
  r: Rng,
  path: Path,
  items: readonly { item: T; weight: number }[],
): T {
  if (items.length === 0) {
    throw new Error(`weighted: empty at ${path}`);
  }
  let total = 0;
  for (const it of items) total += Math.max(0, it.weight);
  if (!(total > 0)) return items[0]!.item;
  let x = r(path) * total;
  for (const it of items) {
    x -= Math.max(0, it.weight);
    if (x <= 0) return it.item;
  }
  return items[items.length - 1]!.item;
}

/** Inclusive integer in [lo, hi]. */
export function int(r: Rng, path: Path, lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return a + Math.floor(r(path) * (b - a + 1));
}

/** Fisher–Yates using `path + "#i"` for each swap. */
export function shuffle<T>(r: Rng, path: Path, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r(`${path}#${i}`) * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
