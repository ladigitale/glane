/**
 * Interleaved float32 PCM helpers (ADR-0010 / 0011).
 * Layout: L0,R0,L1,R1,… with `pcm.length === frames * channelCount`.
 */

export function clampChannelCount(channelCount: number): number {
  const n = Math.floor(channelCount);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(2, n);
}

export function frameCount(
  pcm: Float32Array,
  channelCount = 1,
): number {
  const ch = clampChannelCount(channelCount);
  return Math.floor(pcm.length / ch);
}

export function durationMsFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
): number {
  const frames = frameCount(pcm, channelCount);
  if (sampleRate <= 0 || frames <= 0) return 0;
  return Math.round((frames / sampleRate) * 1000);
}

/** Mid (average) downmix — YAMNet / CLAP / envelope / peaks. */
export function toMonoPcm(
  pcm: Float32Array,
  channelCount = 1,
): Float32Array {
  const ch = clampChannelCount(channelCount);
  if (ch <= 1) return pcm.length === 0 ? new Float32Array(0) : Float32Array.from(pcm);
  const frames = frameCount(pcm, ch);
  const out = new Float32Array(frames);
  const inv = 1 / ch;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    const base = i * ch;
    for (let c = 0; c < ch; c++) s += pcm[base + c] ?? 0;
    out[i] = s * inv;
  }
  return out;
}

export function deinterleave(
  pcm: Float32Array,
  channelCount = 1,
): Float32Array[] {
  const ch = clampChannelCount(channelCount);
  const frames = frameCount(pcm, ch);
  if (ch <= 1) return [Float32Array.from(pcm.subarray(0, frames))];
  const out: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    const plane = new Float32Array(frames);
    for (let i = 0; i < frames; i++) plane[i] = pcm[i * ch + c] ?? 0;
    out.push(plane);
  }
  return out;
}

export function interleave(channels: Float32Array[]): Float32Array {
  const ch = clampChannelCount(channels.length);
  const frames = Math.min(...channels.map((c) => c.length));
  if (ch <= 1) {
    const src = channels[0];
    return src ? Float32Array.from(src.subarray(0, frames)) : new Float32Array(0);
  }
  const out = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const base = i * ch;
    for (let c = 0; c < ch; c++) out[base + c] = channels[c]?.[i] ?? 0;
  }
  return out;
}

/**
 * Run `fn` on each channel (planar), re-interleave to the shortest result.
 * Use when length may shrink (crop / texture polish).
 */
export function mapInterleavedChannels(
  pcm: Float32Array,
  channelCount: number,
  fn: (channel: Float32Array) => Float32Array,
): Float32Array {
  const ch = clampChannelCount(channelCount);
  if (ch <= 1) return fn(pcm);
  return interleave(deinterleave(pcm, ch).map(fn));
}

/** Reverse in time without swapping L/R within a frame. */
export function reverseInterleaved(
  pcm: Float32Array,
  channelCount = 1,
): Float32Array {
  const ch = clampChannelCount(channelCount);
  const frames = frameCount(pcm, ch);
  if (ch <= 1) {
    const out = Float32Array.from(pcm);
    out.reverse();
    return out;
  }
  const out = new Float32Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const src = (frames - 1 - i) * ch;
    const dst = i * ch;
    for (let c = 0; c < ch; c++) out[dst + c] = pcm[src + c] ?? 0;
  }
  return out;
}

/** Slice by frame range [startFrame, endFrame). */
export function sliceFrames(
  pcm: Float32Array,
  channelCount: number,
  startFrame: number,
  endFrame: number,
): Float32Array {
  const ch = clampChannelCount(channelCount);
  const frames = frameCount(pcm, ch);
  const a = Math.max(0, Math.min(frames, Math.floor(startFrame)));
  const b = Math.max(a, Math.min(frames, Math.floor(endFrame)));
  return Float32Array.from(pcm.subarray(a * ch, b * ch));
}

export function audioBufferToInterleaved(buf: AudioBuffer): {
  pcm: Float32Array;
  channelCount: number;
  sampleRate: number;
} {
  const channelCount = clampChannelCount(buf.numberOfChannels);
  const frames = buf.length;
  if (channelCount <= 1) {
    const pcm = new Float32Array(frames);
    pcm.set(buf.getChannelData(0));
    return { pcm, channelCount: 1, sampleRate: buf.sampleRate };
  }
  const L = buf.getChannelData(0);
  const R =
    buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const pcm = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[i * 2] = L[i] ?? 0;
    pcm[i * 2 + 1] = R[i] ?? 0;
  }
  return { pcm, channelCount: 2, sampleRate: buf.sampleRate };
}

export function interleavedToAudioBuffer(
  ctx: BaseAudioContext,
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
): AudioBuffer {
  const ch = clampChannelCount(channelCount);
  const frames = frameCount(pcm, ch);
  const buf = ctx.createBuffer(ch, Math.max(1, frames), sampleRate);
  if (ch <= 1) {
    buf.copyToChannel(Float32Array.from(pcm.subarray(0, frames)), 0);
    return buf;
  }
  for (let c = 0; c < ch; c++) {
    const plane = new Float32Array(frames);
    for (let i = 0; i < frames; i++) plane[i] = pcm[i * ch + c] ?? 0;
    buf.copyToChannel(plane, c);
  }
  return buf;
}
