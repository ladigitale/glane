import { denormalizePhysical } from "./map.js";
import { normalizePeak } from "./audio-util.js";
import type { PhysicalNorm, PhysicalPhysical } from "./types.js";

export type RenderPhysicalResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  physical: PhysicalPhysical;
};

/** Extended Karplus-Strong into a mono buffer (no graph needed). */
export async function renderPhysical(
  norm: PhysicalNorm,
  opts?: { sampleRate?: number },
): Promise<RenderPhysicalResult> {
  const physical = denormalizePhysical(norm);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const durationMs = Math.max(40, physical.durationMs);
  const frames = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const delayLen = Math.max(
    2,
    Math.min(
      sampleRate,
      Math.round(sampleRate / Math.max(40, physical.fundHz)),
    ),
  );

  const buf = new Float32Array(frames);
  const delay = new Float32Array(delayLen);
  const exc = physical.excitation;
  const burst = Math.min(
    delayLen,
    exc === "bow" ? delayLen : Math.floor(delayLen * (exc === "blow" ? 0.5 : 0.15)),
  );
  for (let i = 0; i < burst; i++) {
    if (exc === "bow") {
      delay[i] = Math.sin((i / burst) * Math.PI) * (Math.random() * 2 - 1) * 0.5;
    } else if (exc === "blow") {
      delay[i] = (Math.random() * 2 - 1) * (1 - i / burst);
    } else {
      delay[i] = Math.random() * 2 - 1;
    }
  }

  let idx = 0;
  let prev = 0;
  const damp = physical.damping;
  const stiff = physical.stiffness;
  for (let i = 0; i < frames; i++) {
    const a = delay[idx] ?? 0;
    const b = delay[(idx + 1) % delayLen] ?? 0;
    // One-pole lowpass + stiffness blend
    const avg = 0.5 * (a + b);
    const filtered = damp * (avg * (1 - stiff * 0.35) + a * stiff * 0.35);
    delay[idx] = filtered;
    // Soft attack envelope for blow/bow
    let env = 1;
    if (exc === "bow") {
      env = Math.min(1, i / (sampleRate * 0.08));
    }
    buf[i] = filtered * env;
    prev = filtered;
    idx = (idx + 1) % delayLen;
  }
  void prev;

  // Apply simple amp envelope in-place
  const aN = Math.max(1, Math.floor(physical.ampAttackSec * sampleRate));
  const dN = Math.max(1, Math.floor(physical.ampDecaySec * sampleRate));
  const rN = Math.max(1, Math.floor(physical.ampReleaseSec * sampleRate));
  const sustain = physical.ampSustain;
  const noteEnd = Math.max(aN + dN, frames - rN);
  for (let i = 0; i < frames; i++) {
    let g = sustain;
    if (i < aN) g = i / aN;
    else if (i < aN + dN) g = 1 - (1 - sustain) * ((i - aN) / dN);
    else if (i >= noteEnd) g = sustain * (1 - (i - noteEnd) / rN);
    buf[i] = (buf[i] ?? 0) * Math.max(0, g);
  }

  const pcm = normalizePeak(buf);
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    physical,
  };
}
