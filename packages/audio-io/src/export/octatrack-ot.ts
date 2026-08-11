/**
 * Elektron Octatrack `.ot` sample-settings file (slice / trim / tempo).
 * Layout from OctaChainer (KaiDrange); multi-byte fields are big-endian.
 * Tempo scale: BPM × 24 (ot-tools-io / Elektronauts).
 */

const OT_SIZE = 832;
const HEADER = Uint8Array.of(
  0x46,
  0x4f,
  0x52,
  0x4d,
  0x00,
  0x00,
  0x00,
  0x00,
  0x44,
  0x50,
  0x53,
  0x31,
  0x53,
  0x4d,
  0x50,
  0x41,
);
const UNKNOWN = Uint8Array.of(0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00);

/** Disabled slice loop point (OctaChainer / OT). */
export const OT_SLICE_LOOP_OFF = 0xffff_ffff;

export const OT_MAX_SLICES = 64;

export type OtSlice = {
  start: number;
  end: number;
  /** Defaults to disabled. */
  loop?: number;
};

export type OtEncodeOpts = {
  /** Total sample frames in the paired WAV. */
  totalSamples: number;
  bpm: number;
  /** Musical length of the sample in bars (trim / loop bar length). */
  bars: number;
  slices: readonly OtSlice[];
  /** Sample gain in dB (−24…+24). Default 0. */
  gainDb?: number;
  /**
   * Stretch: 0 off, 2 normal, 3 beat.
   * Default 3 (beat) — suited to bar-sliced arrangement stems.
   */
  stretch?: 0 | 2 | 3;
  /** Loop: 0 off, 1 normal, 2 ping-pong. Default 0. */
  loop?: 0 | 1 | 2;
  /** Trig quantize; 0xFF = direct. Default 0xFF. */
  quantize?: number;
};

function clampBpm(bpm: number): number {
  return Math.min(300, Math.max(30, bpm));
}

function writeU16BE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value >>> 0, false);
}

function writeU32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

/** Even bar groups so slice count ≤ 64. */
function barsPerSlice(bars: number): number {
  const b = Math.max(1, Math.floor(bars));
  return Math.max(1, Math.ceil(b / OT_MAX_SLICES));
}

function sliceCountForBars(bars: number): number {
  const b = Math.max(1, Math.floor(bars));
  const step = barsPerSlice(b);
  return Math.ceil(b / step);
}

/**
 * Equal musical slices (bar groups) covering `totalSamples`.
 * Last slice end is clamped to `totalSamples`.
 */
function slicesForBars(opts: {
  bars: number;
  totalSamples: number;
  /** Sample frames per bar (from musical time at WAV sample rate). */
  samplesPerBar: number;
}): { slices: OtSlice[]; barsPerSlice: number; sliceCount: number } {
  const bars = Math.max(1, Math.floor(opts.bars));
  const step = barsPerSlice(bars);
  const count = sliceCountForBars(bars);
  const total = Math.max(1, Math.floor(opts.totalSamples));
  const spb = Math.max(1, Math.floor(opts.samplesPerBar));
  const slices: OtSlice[] = [];
  for (let i = 0; i < count; i++) {
    const startBar = i * step;
    const endBar = Math.min(bars, (i + 1) * step);
    const start = Math.min(total, startBar * spb);
    const end =
      i === count - 1 ? total : Math.min(total, Math.max(start + 1, endBar * spb));
    slices.push({ start, end, loop: OT_SLICE_LOOP_OFF });
  }
  return { slices, barsPerSlice: step, sliceCount: count };
}

function encode(opts: OtEncodeOpts): Uint8Array {
  const totalSamples = Math.max(1, Math.floor(opts.totalSamples));
  const bpm = clampBpm(opts.bpm);
  const bars = Math.max(0.01, opts.bars);
  const slices = opts.slices.slice(0, OT_MAX_SLICES);
  const gainDb = Math.min(24, Math.max(-24, opts.gainDb ?? 0));
  const stretch = opts.stretch ?? 3;
  const loop = opts.loop ?? 0;
  const quantize = opts.quantize ?? 0xff;

  const buf = new ArrayBuffer(OT_SIZE);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  bytes.set(HEADER, 0);
  bytes.set(UNKNOWN, 16);

  // tempo @ 0x17 — BPM × 24
  writeU32BE(view, 0x17, Math.round(bpm * 24));
  // trimLen / loopLen @ 0x1B / 0x1F — bars × 100
  const barLen = Math.max(1, Math.round(bars * 100));
  writeU32BE(view, 0x1b, barLen);
  writeU32BE(view, 0x1f, barLen);
  writeU32BE(view, 0x23, stretch);
  writeU32BE(view, 0x27, loop);
  // gain @ 0x2B — UI dB + 48 (0 dB → 48)
  writeU16BE(view, 0x2b, Math.round(gainDb + 48));
  view.setUint8(0x2d, quantize & 0xff);
  writeU32BE(view, 0x2e, 0); // trimStart
  writeU32BE(view, 0x32, totalSamples); // trimEnd
  writeU32BE(view, 0x36, 0); // loopPoint

  // slices @ 0x3A — 64 × 12 bytes
  let sliceOff = 0x3a;
  for (let i = 0; i < OT_MAX_SLICES; i++) {
    const s = slices[i];
    if (s) {
      const start = Math.max(0, Math.floor(s.start));
      const end = Math.max(start, Math.floor(s.end));
      const loopPt = s.loop ?? OT_SLICE_LOOP_OFF;
      writeU32BE(view, sliceOff, start);
      writeU32BE(view, sliceOff + 4, end);
      writeU32BE(view, sliceOff + 8, loopPt >>> 0);
    }
    sliceOff += 12;
  }

  writeU32BE(view, 0x33a, slices.length);

  // checksum @ 0x33E — sum of bytes [16 .. size-3] as u16 BE
  let sum = 0;
  for (let i = 16; i < OT_SIZE - 2; i++) sum = (sum + bytes[i]!) & 0xffff;
  writeU16BE(view, 0x33e, sum);

  return bytes;
}

export const octatrackOt = {
  SIZE: OT_SIZE,
  MAX_SLICES: OT_MAX_SLICES,
  encode,
  barsPerSlice,
  sliceCountForBars,
  slicesForBars,
} as const;
