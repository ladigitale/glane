/**
 * AudioWorklet processor source text (inlined for Vite URL blob registration).
 * Writes mono input into SharedArrayBuffer ring; posts RMS/peak every ~50ms.
 * When `shared` is false, skips Atomics (ArrayBuffer fallback — not truly shared).
 */
export const CAPTURE_PROCESSOR_CODE = `
class GlaneCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.sab = opts.sab;
    this.capacity = opts.capacityFrames | 0;
    this.shared = !!opts.shared;
    this.writeIndex = new Int32Array(this.sab, 0, 1);
    this.readIndex = new Int32Array(this.sab, 4, 1);
    this.data = new Float32Array(this.sab, 8, this.capacity);
    this._frames = 0;
    this._peak = 0;
    this._sumSq = 0;
  }

  _load(view) {
    return this.shared ? Atomics.load(view, 0) : (view[0] | 0);
  }

  _store(view, value) {
    if (this.shared) Atomics.store(view, 0, value);
    else view[0] = value;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let w = this._load(this.writeIndex);
    const r = this._load(this.readIndex);
    const cap = this.capacity;
    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      const next = (w + 1) % cap;
      if (next === r) {
        // overrun: drop sample, keep going
        continue;
      }
      this.data[w] = s;
      w = next;
      const a = s < 0 ? -s : s;
      if (a > this._peak) this._peak = a;
      this._sumSq += s * s;
      this._frames++;
    }
    this._store(this.writeIndex, w);
    if (this._frames >= 2400) {
      const rms = Math.sqrt(this._sumSq / this._frames);
      this.port.postMessage({ type: 'level', rms, peak: this._peak });
      this._frames = 0;
      this._peak = 0;
      this._sumSq = 0;
    }
    return true;
  }
}
registerProcessor('glane-capture-processor', GlaneCaptureProcessor);
`;

export function createCaptureWorkletUrl(): string {
  const blob = new Blob([CAPTURE_PROCESSOR_CODE], {
    type: "application/javascript",
  });
  return URL.createObjectURL(blob);
}
