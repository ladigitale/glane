/**
 * Rolling PCM window — keeps the last N seconds in RAM (no session master).
 * `totalPushed` is a monotonic sample counter for gap-free consumers (EventHunter).
 */
export class RollingPcmWindow {
  readonly capacity: number;
  readonly data: Float32Array;
  #write = 0;
  #filled = 0;
  #totalPushed = 0;

  constructor(capacityFrames: number) {
    this.capacity = Math.max(1, capacityFrames);
    this.data = new Float32Array(this.capacity);
  }

  get filled(): number {
    return this.#filled;
  }

  /** Samples pushed since construction (monotonic, does not wrap). */
  get totalPushed(): number {
    return this.#totalPushed;
  }

  /**
   * Absolute index of the oldest sample still in the window
   * (`totalPushed - filled`).
   */
  get oldestAbs(): number {
    return this.#totalPushed - this.#filled;
  }

  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) {
      this.data[this.#write] = chunk[i] ?? 0;
      this.#write = (this.#write + 1) % this.capacity;
      if (this.#filled < this.capacity) this.#filled++;
    }
    this.#totalPushed += chunk.length;
  }

  /** Oldest → newest copy of the filled window. */
  snapshot(): Float32Array {
    return this.snapshotRecent(this.#filled);
  }

  /** Newest `maxFrames` samples (oldest→newest). Cheap vs full 10 s copy. */
  snapshotRecent(maxFrames: number): Float32Array {
    const n = Math.min(this.#filled, Math.max(0, maxFrames | 0));
    const out = new Float32Array(n);
    if (n === 0) return out;
    const start =
      this.#filled < this.capacity
        ? Math.max(0, this.#filled - n)
        : (this.#write - n + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) {
      out[i] = this.data[(start + i) % this.capacity] ?? 0;
    }
    return out;
  }

  /**
   * Contiguous samples from absolute cursor `fromAbs` (inclusive) to `totalPushed`.
   * Clamps to the oldest sample still retained — caller should treat a jump in
   * the returned `fromAbs` as a capture gap.
   */
  snapshotFrom(fromAbs: number): { pcm: Float32Array; fromAbs: number; toAbs: number } {
    const oldest = this.oldestAbs;
    const start = Math.max(oldest, Math.floor(fromAbs));
    const n = Math.max(0, this.#totalPushed - start);
    const pcm = new Float32Array(n);
    if (n === 0) return { pcm, fromAbs: start, toAbs: start };

    // Map absolute index → ring index.
    const offsetInFilled = start - oldest;
    const ringStart =
      this.#filled < this.capacity
        ? offsetInFilled
        : (this.#write - this.#filled + offsetInFilled + this.capacity) %
          this.capacity;
    for (let i = 0; i < n; i++) {
      pcm[i] = this.data[(ringStart + i) % this.capacity] ?? 0;
    }
    return { pcm, fromAbs: start, toAbs: this.#totalPushed };
  }

  clear(): void {
    this.#write = 0;
    this.#filled = 0;
    this.#totalPushed = 0;
    this.data.fill(0);
  }
}
