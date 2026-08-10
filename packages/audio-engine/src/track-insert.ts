import {
  DEFAULT_TRACK_FX,
  normalizeTrackFx,
  type TrackFx,
  type TrackFxType,
} from "@glane/core-model";

export type TrackInsertConfig = {
  id: string;
  /** Linear track gain (0…2). */
  gain: number;
  pan: number;
  fx: TrackFx;
};

type InsertHandles = {
  type: TrackFxType;
  /** Disconnect insert nodes (input → gain stays). */
  dispose: () => void;
  apply: (fx: TrackFx) => void;
};

export type TrackBus = {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  insert: InsertHandles;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function makeImpulse(
  ctx: BaseAudioContext,
  durationSec: number,
  decay: number,
): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const d = 2 + clamp(decay, 0, 1) * 5;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, d);
    }
  }
  return buf;
}

function buildNone(input: GainNode, gain: GainNode): InsertHandles {
  input.connect(gain);
  return {
    type: "none",
    dispose: () => {
      try {
        input.disconnect(gain);
      } catch {
        /* already disconnected */
      }
    },
    apply: () => undefined,
  };
}

function buildEq(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 320;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3200;

  const apply = (next: TrackFx) => {
    // Web Audio gain is dB for shelves/peaking
    low.gain.value = 20 * Math.log10(Math.max(0.05, next.low));
    mid.gain.value = 20 * Math.log10(Math.max(0.05, next.mid));
    high.gain.value = 20 * Math.log10(Math.max(0.05, next.high));
  };
  apply(fx);

  input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(gain);

  return {
    type: "eq",
    dispose: () => {
      try {
        input.disconnect(low);
      } catch {
        /* */
      }
      low.disconnect();
      mid.disconnect();
      high.disconnect();
    },
    apply,
  };
}

function buildEcho(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const merge = ctx.createGain();

  const apply = (next: TrackFx) => {
    const mix = clamp(next.mix, 0, 1);
    dry.gain.value = 1 - mix * 0.85;
    wet.gain.value = mix;
    delay.delayTime.value = clamp(next.delayMs, 20, 1500) / 1000;
    feedback.gain.value = clamp(next.feedback, 0, 0.9);
  };
  apply(fx);

  input.connect(dry);
  dry.connect(merge);
  input.connect(delay);
  delay.connect(wet);
  wet.connect(merge);
  delay.connect(feedback);
  feedback.connect(delay);
  merge.connect(gain);

  return {
    type: "echo",
    dispose: () => {
      try {
        input.disconnect(dry);
        input.disconnect(delay);
      } catch {
        /* */
      }
      dry.disconnect();
      wet.disconnect();
      delay.disconnect();
      feedback.disconnect();
      merge.disconnect();
    },
    apply,
  };
}

function buildReverb(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const conv = ctx.createConvolver();
  const merge = ctx.createGain();
  let lastDecay = Number.NaN;

  const apply = (next: TrackFx) => {
    const mix = clamp(next.mix, 0, 1);
    dry.gain.value = 1 - mix * 0.75;
    wet.gain.value = mix;
    const decay = clamp(next.decay, 0, 1);
    if (Math.abs(decay - lastDecay) > 0.02 || !conv.buffer) {
      lastDecay = decay;
      const dur = 0.6 + decay * 2.4;
      conv.buffer = makeImpulse(ctx, dur, decay);
    }
  };
  apply(fx);

  input.connect(dry);
  dry.connect(merge);
  input.connect(conv);
  conv.connect(wet);
  wet.connect(merge);
  merge.connect(gain);

  return {
    type: "reverb",
    dispose: () => {
      try {
        input.disconnect(dry);
        input.disconnect(conv);
      } catch {
        /* */
      }
      dry.disconnect();
      wet.disconnect();
      conv.disconnect();
      merge.disconnect();
    },
    apply,
  };
}

function buildInsert(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  switch (fx.type) {
    case "eq":
      return buildEq(ctx, input, gain, fx);
    case "echo":
      return buildEcho(ctx, input, gain, fx);
    case "reverb":
      return buildReverb(ctx, input, gain, fx);
    default:
      return buildNone(input, gain);
  }
}

export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  config: TrackInsertConfig,
): TrackBus {
  const fx = normalizeTrackFx(config.fx ?? DEFAULT_TRACK_FX);
  const input = ctx.createGain();
  input.gain.value = 1;
  const gain = ctx.createGain();
  gain.gain.value = clamp(config.gain, 0, 2);
  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp(config.pan, -1, 1);
  const insert = buildInsert(ctx, input, gain, fx);
  gain.connect(pan);
  pan.connect(destination);
  return { input, gain, pan, insert };
}

export function updateTrackBus(
  bus: TrackBus,
  ctx: BaseAudioContext,
  destination: AudioNode,
  config: TrackInsertConfig,
): void {
  const fx = normalizeTrackFx(config.fx ?? DEFAULT_TRACK_FX);
  bus.gain.gain.value = clamp(config.gain, 0, 2);
  bus.pan.pan.value = clamp(config.pan, -1, 1);
  try {
    bus.pan.disconnect();
  } catch {
    /* */
  }
  bus.pan.connect(destination);

  if (bus.insert.type !== fx.type) {
    bus.insert.dispose();
    bus.insert = buildInsert(ctx, bus.input, bus.gain, fx);
    return;
  }
  bus.insert.apply(fx);
}

export function disposeTrackBus(bus: TrackBus): void {
  bus.insert.dispose();
  try {
    bus.gain.disconnect();
    bus.pan.disconnect();
  } catch {
    /* */
  }
}

/** Build the same insert chain into an OfflineAudioContext (bounce). */
export function wireOfflineTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  config: TrackInsertConfig,
): GainNode {
  const bus = createTrackBus(ctx, destination, config);
  return bus.input;
}

/** Extra samples for echo/reverb tails when baking (editor / offline). */
export function fxTailSamples(fx: TrackFx, sampleRate: number): number {
  const n = normalizeTrackFx(fx);
  if (n.type === "echo") {
    const delay = (clamp(n.delayMs, 20, 1500) / 1000) * sampleRate;
    return Math.floor(delay * (2 + n.feedback * 10));
  }
  if (n.type === "reverb") {
    const dur = 0.6 + clamp(n.decay, 0, 1) * 2.4;
    return Math.floor(dur * sampleRate);
  }
  return 0;
}

/**
 * Bake a TrackFx insert onto mono PCM via OfflineAudioContext (ADR-0016 editor).
 * Echo/reverb may grow the buffer by a decay tail; EQ keeps length.
 */
export async function bakeTrackFx(
  pcm: Float32Array,
  sampleRate: number,
  fx: TrackFx,
): Promise<Float32Array> {
  const normalized = normalizeTrackFx(fx);
  if (normalized.type === "none" || pcm.length === 0) {
    return new Float32Array(pcm);
  }
  const tail =
    normalized.type === "eq" ? 0 : fxTailSamples(normalized, sampleRate);
  const length = Math.max(1, pcm.length + tail);
  const offline = new OfflineAudioContext(2, length, sampleRate);
  const buf = offline.createBuffer(1, pcm.length, sampleRate);
  const channel = new Float32Array(pcm.length);
  channel.set(pcm);
  buf.copyToChannel(channel, 0);

  const input = wireOfflineTrackBus(offline, offline.destination, {
    id: "bake",
    gain: 1,
    pan: 0,
    fx: normalized,
  });
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(input);
  src.start(0);

  const rendered = await offline.startRendering();
  const L = rendered.getChannelData(0);
  const R =
    rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  const outLen = normalized.type === "eq" ? pcm.length : rendered.length;
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = ((L[i] ?? 0) + (R[i] ?? 0)) * 0.5;
  }
  return out;
}
