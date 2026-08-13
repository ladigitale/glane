/**
 * AudioWorklet processor source text (inlined for Vite URL blob registration).
 * Writes interleaved PCM (LRLR…) into SharedArrayBuffer ring; posts RMS/peak
 * every ~50ms (mid / max-abs). When `shared` is false, skips Atomics.
 */
export const CAPTURE_PROCESSOR_CODE = `
class GlaneCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.sab = opts.sab;
    this.capacity = opts.capacityFrames | 0;
    this.shared = !!opts.shared;
    this.channelCount = Math.min(2, Math.max(1, opts.channelCount | 0 || 1));
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
    const chans = inputs[0];
    const left = chans && chans[0];
    if (!left) return true;
    const right = (this.channelCount > 1 && chans[1]) ? chans[1] : null;
    const ch = right ? 2 : 1;
    let w = this._load(this.writeIndex);
    const r = this._load(this.readIndex);
    const cap = this.capacity;
    for (let i = 0; i < left.length; i++) {
      const L = left[i];
      const R = right ? right[i] : L;
      const mid = ch === 1 ? L : (L + R) * 0.5;
      // Need \`ch\` free slots (leave one empty for full/empty distinction).
      let next = w;
      let ok = true;
      for (let c = 0; c < ch; c++) {
        next = (next + 1) % cap;
        if (next === r) { ok = false; break; }
      }
      if (!ok) continue;
      this.data[w] = L;
      w = (w + 1) % cap;
      if (ch > 1) {
        this.data[w] = R;
        w = (w + 1) % cap;
      }
      const a = mid < 0 ? -mid : mid;
      if (a > this._peak) this._peak = a;
      this._sumSq += mid * mid;
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
