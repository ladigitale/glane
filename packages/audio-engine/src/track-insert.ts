import {
  DEFAULT_TRACK_FX,
  ECHO_DELAY_MAX_SEC,
  echoDelaySec,
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
  /** Project tempo — resolves echo delayBeats → seconds. */
  bpm?: number;
};

type InsertHandles = {
  type: TrackFxType;
  /** Disconnect insert nodes (input → gain stays). */
  dispose: () => void;
  apply: (fx: TrackFx, bpm?: number) => void;
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

/** Map damping 0…1 → lowpass cutoff (bright → dark). */
function dampingHz(damping: number): number {
  const d = clamp(damping, 0, 1);
  return 800 + (1 - d) * 11_200;
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

function safeDisconnect(node: AudioNode, dest?: AudioNode): void {
  try {
    if (dest) node.disconnect(dest);
    else node.disconnect();
  } catch {
    /* already disconnected */
  }
}

function stopOsc(osc: OscillatorNode): void {
  try {
    osc.stop();
  } catch {
    /* already stopped */
  }
  safeDisconnect(osc);
}

function buildNone(input: GainNode, gain: GainNode): InsertHandles {
  input.connect(gain);
  return {
    type: "none",
    dispose: () => {
      safeDisconnect(input, gain);
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
      safeDisconnect(input, low);
      safeDisconnect(low);
      safeDisconnect(mid);
      safeDisconnect(high);
    },
    apply,
  };
}

function buildEcho(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
  bpm: number,
): InsertHandles {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(ECHO_DELAY_MAX_SEC);
  const feedback = ctx.createGain();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.Q.value = 0.7;
  const merge = ctx.createGain();

  const apply = (next: TrackFx, nextBpm = bpm) => {
    const mix = clamp(next.mix, 0, 1);
    dry.gain.value = 1 - mix * 0.85;
    wet.gain.value = mix;
    delay.delayTime.value = echoDelaySec(next.delayBeats, nextBpm);
    feedback.gain.value = clamp(next.feedback, 0, 0.9);
    damp.frequency.value = dampingHz(next.damping);
  };
  apply(fx, bpm);

  input.connect(dry);
  dry.connect(merge);
  input.connect(delay);
  delay.connect(damp);
  damp.connect(wet);
  wet.connect(merge);
  damp.connect(feedback);
  feedback.connect(delay);
  merge.connect(gain);

  return {
    type: "echo",
    dispose: () => {
      safeDisconnect(input, dry);
      safeDisconnect(input, delay);
      safeDisconnect(dry);
      safeDisconnect(wet);
      safeDisconnect(delay);
      safeDisconnect(damp);
      safeDisconnect(feedback);
      safeDisconnect(merge);
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
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.Q.value = 0.7;
  const merge = ctx.createGain();
  let lastDecay = Number.NaN;

  const apply = (next: TrackFx) => {
    const mix = clamp(next.mix, 0, 1);
    dry.gain.value = 1 - mix * 0.75;
    wet.gain.value = mix;
    damp.frequency.value = dampingHz(next.damping);
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
  conv.connect(damp);
  damp.connect(wet);
  wet.connect(merge);
  merge.connect(gain);

  return {
    type: "reverb",
    dispose: () => {
      safeDisconnect(input, dry);
      safeDisconnect(input, conv);
      safeDisconnect(dry);
      safeDisconnect(wet);
      safeDisconnect(conv);
      safeDisconnect(damp);
      safeDisconnect(merge);
    },
    apply,
  };
}

function buildChorus(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const merge = ctx.createGain();
  const delayA = ctx.createDelay(0.05);
  const delayB = ctx.createDelay(0.05);
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  const modA = ctx.createGain();
  const modB = ctx.createGain();

  const apply = (next: TrackFx) => {
    const mix = clamp(next.mix, 0, 1);
    const depth = clamp(next.depth, 0, 1);
    dry.gain.value = 1 - mix * 0.7;
    wet.gain.value = mix;
    lfo.frequency.value = clamp(next.rateHz, 0.1, 12);
    // Base delays ~18 / 26 ms; depth sweeps ± up to ~6 ms
    delayA.delayTime.value = 0.018;
    delayB.delayTime.value = 0.026;
    modA.gain.value = depth * 0.006;
    modB.gain.value = -(depth * 0.005);
  };
  apply(fx);

  input.connect(dry);
  dry.connect(merge);
  input.connect(delayA);
  input.connect(delayB);
  delayA.connect(wet);
  delayB.connect(wet);
  wet.connect(merge);
  merge.connect(gain);
  lfo.connect(modA);
  lfo.connect(modB);
  modA.connect(delayA.delayTime);
  modB.connect(delayB.delayTime);
  lfo.start(0);

  return {
    type: "chorus",
    dispose: () => {
      stopOsc(lfo);
      safeDisconnect(input, dry);
      safeDisconnect(input, delayA);
      safeDisconnect(input, delayB);
      safeDisconnect(dry);
      safeDisconnect(wet);
      safeDisconnect(delayA);
      safeDisconnect(delayB);
      safeDisconnect(modA);
      safeDisconnect(modB);
      safeDisconnect(merge);
    },
    apply,
  };
}

function buildTremolo(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const amp = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  const mod = ctx.createGain();

  const apply = (next: TrackFx) => {
    const depth = clamp(next.depth, 0, 1);
    lfo.frequency.value = clamp(next.rateHz, 0.1, 12);
    // Center at 1 − depth/2 so peaks stay ≤ 1
    amp.gain.value = 1 - depth * 0.5;
    mod.gain.value = depth * 0.5;
  };
  apply(fx);

  input.connect(amp);
  amp.connect(gain);
  lfo.connect(mod);
  mod.connect(amp.gain);
  lfo.start(0);

  return {
    type: "tremolo",
    dispose: () => {
      stopOsc(lfo);
      safeDisconnect(input, amp);
      safeDisconnect(amp);
      safeDisconnect(mod);
    },
    apply,
  };
}

function buildVibrato(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
): InsertHandles {
  const delay = ctx.createDelay(0.05);
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  const mod = ctx.createGain();

  const apply = (next: TrackFx) => {
    const depth = clamp(next.depth, 0, 1);
    lfo.frequency.value = clamp(next.rateHz, 0.1, 12);
    delay.delayTime.value = 0.004 + depth * 0.002;
    mod.gain.value = depth * 0.0035;
  };
  apply(fx);

  input.connect(delay);
  delay.connect(gain);
  lfo.connect(mod);
  mod.connect(delay.delayTime);
  lfo.start(0);

  return {
    type: "vibrato",
    dispose: () => {
      stopOsc(lfo);
      safeDisconnect(input, delay);
      safeDisconnect(delay);
      safeDisconnect(mod);
    },
    apply,
  };
}

function buildInsert(
  ctx: BaseAudioContext,
  input: GainNode,
  gain: GainNode,
  fx: TrackFx,
  bpm: number,
): InsertHandles {
  switch (fx.type) {
    case "eq":
      return buildEq(ctx, input, gain, fx);
    case "echo":
      return buildEcho(ctx, input, gain, fx, bpm);
    case "reverb":
      return buildReverb(ctx, input, gain, fx);
    case "chorus":
      return buildChorus(ctx, input, gain, fx);
    case "tremolo":
      return buildTremolo(ctx, input, gain, fx);
    case "vibrato":
      return buildVibrato(ctx, input, gain, fx);
    default:
      return buildNone(input, gain);
  }
}

function configBpm(config: TrackInsertConfig): number {
  const b = config.bpm;
  return Number.isFinite(b) && (b as number) > 0 ? (b as number) : 120;
}

export function createTrackBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  config: TrackInsertConfig,
): TrackBus {
  const fx = normalizeTrackFx(config.fx ?? DEFAULT_TRACK_FX);
  const bpm = configBpm(config);
  const input = ctx.createGain();
  input.gain.value = 1;
  const gain = ctx.createGain();
  gain.gain.value = clamp(config.gain, 0, 2);
  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp(config.pan, -1, 1);
  const insert = buildInsert(ctx, input, gain, fx, bpm);
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
  const bpm = configBpm(config);
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
    bus.insert = buildInsert(ctx, bus.input, bus.gain, fx, bpm);
    return;
  }
  bus.insert.apply(fx, bpm);
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

function fxGrowsBuffer(type: TrackFxType): boolean {
  return type === "echo" || type === "reverb" || type === "chorus";
}

/** Extra samples for echo/reverb/chorus tails when baking (editor / offline). */
export function fxTailSamples(
  fx: TrackFx,
  sampleRate: number,
  bpm = 120,
): number {
  const n = normalizeTrackFx(fx);
  if (n.type === "echo") {
    const delay = echoDelaySec(n.delayBeats, bpm) * sampleRate;
    return Math.floor(delay * (2 + n.feedback * 10));
  }
  if (n.type === "reverb") {
    const dur = 0.6 + clamp(n.decay, 0, 1) * 2.4;
    return Math.floor(dur * sampleRate);
  }
  if (n.type === "chorus") {
    return Math.floor(0.05 * sampleRate);
  }
  return 0;
}

/**
 * Bake a TrackFx insert onto mono PCM via OfflineAudioContext (ADR-0016 editor).
 * Echo/reverb/chorus may grow the buffer by a decay tail; others keep length.
 */
export async function bakeTrackFx(
  pcm: Float32Array,
  sampleRate: number,
  fx: TrackFx,
  bpm = 120,
): Promise<Float32Array> {
  const normalized = normalizeTrackFx(fx);
  if (normalized.type === "none" || pcm.length === 0) {
    return new Float32Array(pcm);
  }
  const tail = fxGrowsBuffer(normalized.type)
    ? fxTailSamples(normalized, sampleRate, bpm)
    : 0;
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
    bpm,
  });
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(input);
  src.start(0);

  const rendered = await offline.startRendering();
  const L = rendered.getChannelData(0);
  const R =
    rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  const outLen = fxGrowsBuffer(normalized.type)
    ? rendered.length
    : pcm.length;
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = ((L[i] ?? 0) + (R[i] ?? 0)) * 0.5;
  }
  return out;
}
