/**
 * SPSC ring buffer over SharedArrayBuffer (or fallback ArrayBuffer views).
 * Layout: [writeIndex:u32][readIndex:u32][frames...]
 */
export class RingBuffer {
  readonly capacityFrames: number;
  readonly sab: SharedArrayBuffer | ArrayBuffer;
  readonly writeIndex: Int32Array;
  readonly readIndex: Int32Array;
  readonly data: Float32Array;
  readonly usesSharedMemory: boolean;

  constructor(capacityFrames: number, shared = true) {
    this.capacityFrames = capacityFrames;
    const headerBytes = 8;
    const bytes = headerBytes + capacityFrames * 4;
    this.usesSharedMemory =
      shared && typeof SharedArrayBuffer !== "undefined";
    this.sab = this.usesSharedMemory
      ? new SharedArrayBuffer(bytes)
      : new ArrayBuffer(bytes);
    this.writeIndex = new Int32Array(this.sab, 0, 1);
    this.readIndex = new Int32Array(this.sab, 4, 1);
    this.data = new Float32Array(this.sab, 8, capacityFrames);
    this.#store(this.writeIndex, 0);
    this.#store(this.readIndex, 0);
  }

  #load(view: Int32Array): number {
    return this.usesSharedMemory ? Atomics.load(view, 0) : (view[0] ?? 0);
  }

  #store(view: Int32Array, value: number): void {
    if (this.usesSharedMemory) Atomics.store(view, 0, value);
    else view[0] = value;
  }

  /** Available frames for reading (producer/consumer). */
  availableRead(): number {
    const w = this.#load(this.writeIndex);
    const r = this.#load(this.readIndex);
    return (w - r + this.capacityFrames) % this.capacityFrames;
  }

  availableWrite(): number {
    return this.capacityFrames - 1 - this.availableRead();
  }

  write(input: Float32Array): number {
    let written = 0;
    let w = this.#load(this.writeIndex);
    const r = this.#load(this.readIndex);
    const cap = this.capacityFrames;
    for (let i = 0; i < input.length; i++) {
      const next = (w + 1) % cap;
      if (next === r) break;
      this.data[w] = input[i] ?? 0;
      w = next;
      written++;
    }
    this.#store(this.writeIndex, w);
    return written;
  }

  read(output: Float32Array): number {
    let read = 0;
    let r = this.#load(this.readIndex);
    const w = this.#load(this.writeIndex);
    const cap = this.capacityFrames;
    for (let i = 0; i < output.length; i++) {
      if (r === w) break;
      output[i] = this.data[r] ?? 0;
      r = (r + 1) % cap;
      read++;
    }
    this.#store(this.readIndex, r);
    return read;
  }

  /** Peek without advancing read (for pre-roll / backtrack). */
  peek(output: Float32Array, offsetFromWrite: number): number {
    const w = this.#load(this.writeIndex);
    const cap = this.capacityFrames;
    let idx = (w - offsetFromWrite + cap * 4) % cap;
    const n = Math.min(output.length, offsetFromWrite);
    for (let i = 0; i < n; i++) {
      output[i] = this.data[idx] ?? 0;
      idx = (idx + 1) % cap;
    }
    return n;
  }
}

export function ringCapacityForSeconds(
  seconds: number,
  sampleRate: number,
  channelCount = 1,
): number {
  return Math.floor(seconds * sampleRate * Math.max(1, channelCount | 0));
}
