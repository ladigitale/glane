/**
 * Dedicated role synthesizers for Family / Song cards.
 * Free engines (subtractive / FM / …) stay for Variations / pivot only —
 * each role here has its own DSP recipe driven by machine knobs.
 */
import { normalizePeak, softClipCurve } from "./audio-util.js";
import {
  clampMachineParams,
  filterTypeFromNorm,
  machineSpecFor,
  type MachineParams,
} from "./machines.js";
import { clamp01, lerp, logLerp, timeNormToSec } from "./map.js";
import type { Norm01, SynthRoleId } from "./types.js";

export type RenderRoleResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  fundHz?: number;
  machine: MachineParams;
};

function kn(m: MachineParams, id: keyof MachineParams, fallback = 0.5): Norm01 {
  return clamp01(m[id] ?? fallback);
}

function fillWhite(buf: Float32Array, rnd: () => number): void {
  for (let i = 0; i < buf.length; i++) buf[i] = rnd() * 2 - 1;
}

function fillPink(buf: Float32Array, rnd: () => number): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const white = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    buf[i] = (b0 + b1 + b2 + white * 0.3) * 0.11;
  }
}

/** Sample machine knobs around a pivot (Family variation). */
export function sampleMachineParams(
  role: Exclude<SynthRoleId, "pivot">,
  pivot: MachineParams,
  randomness: number,
  rnd: () => number,
): MachineParams {
  const spec = machineSpecFor(role);
  if (!spec) return clampMachineParams(role, pivot);
  const span = 0.06 + clamp01(randomness) * 0.32;
  const out: MachineParams = {};
  for (const k of spec.knobs) {
    const base = pivot[k.id] ?? k.default;
    if (k.id === "filtType") {
      // Discrete classic filter — often keep pivot, else pick another type.
      if (rnd() < 0.35 + clamp01(randomness) * 0.45) {
        out.filtType = rnd();
      } else {
        out.filtType = base;
      }
      continue;
    }
    out[k.id] = clamp01(base + (rnd() * 2 - 1) * span);
  }
  return clampMachineParams(role, out);
}

/** Linear ADSR on a filter cutoff / centre frequency. */
function scheduleFilterAdsr(
  param: AudioParam,
  t0: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  baseHz: number,
  peakHz: number,
  endTime: number,
): void {
  const a = Math.max(0.001, attack);
  const d = Math.max(0.001, decay);
  const r = Math.max(0.001, release);
  const base = Math.max(40, baseHz);
  const peak = Math.max(base + 1, peakHz);
  const sus = base + (peak - base) * clamp01(sustain);
  const noteEnd = Math.max(t0 + a + d + 0.01, endTime - r);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(base, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  param.linearRampToValueAtTime(sus, t0 + a + d);
  param.setValueAtTime(sus, noteEnd);
  param.linearRampToValueAtTime(base, noteEnd + r);
}

/**
 * Classic biquad + filter ADSR on top of a role bake.
 * `filtEnv` ≈ 0 bypasses; otherwise amount scales peak cutoff.
 */
async function applyMachineFilter(
  result: RenderRoleResult,
  machine: MachineParams,
): Promise<RenderRoleResult> {
  const envAmt = kn(machine, "filtEnv", 0);
  if (envAmt < 0.02 || result.pcm.length < 8) return result;

  const type = filterTypeFromNorm(kn(machine, "filtType", 0.1));
  const atk = timeNormToSec(kn(machine, "filtAtk", 0.12));
  const dec = timeNormToSec(kn(machine, "filtDec", 0.35));
  const sus = kn(machine, "filtSus", 0.45);
  const rel = timeNormToSec(kn(machine, "filtRel", 0.4));
  const sr = result.sampleRate;
  const durSec = result.pcm.length / sr;
  const frames = result.pcm.length;

  const offline = new OfflineAudioContext(1, frames, sr);
  const buf = offline.createBuffer(1, frames, sr);
  buf.getChannelData(0).set(result.pcm);
  const src = offline.createBufferSource();
  src.buffer = buf;

  const filter = offline.createBiquadFilter();
  filter.type = type;
  filter.Q.value =
    type === "bandpass" || type === "notch" || type === "peaking"
      ? lerp(0.7, 8, envAmt)
      : lerp(0.5, 4, envAmt);
  if (type === "peaking") filter.gain.value = lerp(0, 12, envAmt);

  const baseHz = logLerp(120, 1_800, 0.35);
  const peakHz = logLerp(baseHz, 14_000, envAmt);
  scheduleFilterAdsr(
    filter.frequency,
    0,
    atk,
    dec,
    sus,
    rel,
    baseHz,
    peakHz,
    durSec,
  );

  src.connect(filter);
  filter.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    ...result,
    pcm,
    durationMs: Math.round((pcm.length / sr) * 1000),
    machine,
  };
}

export function usesRoleSynth(
  role: SynthRoleId | undefined,
): role is Exclude<SynthRoleId, "pivot" | "arp"> {
  return (
    role != null &&
    role !== "pivot" &&
    role !== "arp"
  );
}

async function renderKick(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
): Promise<RenderRoleResult> {
  const body = kn(machine, "body");
  const punch = kn(machine, "punch");
  const click = kn(machine, "click");
  const length = kn(machine, "length");

  const bodyHz = logLerp(36, 78, body);
  const startHz = bodyHz * lerp(8, 22, punch);
  const sweepSec = lerp(0.055, 0.012, punch);
  const durSec = lerp(0.2, 0.65, length);
  const clickAmt = click;
  const drive = lerp(0.15, 0.75, punch);
  const frames = Math.ceil((durSec + 0.04) * sampleRate);

  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  // Body: sine with exponential pitch drop (classic analog kick).
  const osc = offline.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(startHz, t0);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(20, bodyHz),
    t0 + sweepSec,
  );
  osc.frequency.setValueAtTime(Math.max(20, bodyHz), t0 + sweepSec);

  const bodyAmp = offline.createGain();
  bodyAmp.gain.setValueAtTime(0.0001, t0);
  bodyAmp.gain.exponentialRampToValueAtTime(0.95, t0 + 0.002);
  bodyAmp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

  const shaper = offline.createWaveShaper();
  shaper.curve = new Float32Array(softClipCurve(drive));
  shaper.oversample = "2x";

  osc.connect(bodyAmp);
  bodyAmp.connect(shaper);
  shaper.connect(offline.destination);
  osc.start(t0);
  osc.stop(t0 + durSec + 0.02);

  // Click / beater: short noise burst (HP) + optional high sine tick.
  if (clickAmt > 0.02) {
    const clickFrames = Math.max(32, Math.ceil(0.012 * sampleRate));
    const nbuf = offline.createBuffer(1, clickFrames, sampleRate);
    fillWhite(nbuf.getChannelData(0), rnd);
    const nsrc = offline.createBufferSource();
    nsrc.buffer = nbuf;
    const hp = offline.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = lerp(1500, 6500, clickAmt);
    hp.Q.value = 0.7;
    const clickGain = offline.createGain();
    const peak = 0.15 + clickAmt * 0.55;
    clickGain.gain.setValueAtTime(0.0001, t0);
    clickGain.gain.exponentialRampToValueAtTime(peak, t0 + 0.0008);
    clickGain.gain.exponentialRampToValueAtTime(
      0.0001,
      t0 + lerp(0.008, 0.022, clickAmt),
    );
    nsrc.connect(hp);
    hp.connect(clickGain);
    clickGain.connect(offline.destination);
    nsrc.start(t0);
    nsrc.stop(t0 + 0.03);

    const tick = offline.createOscillator();
    tick.type = "sine";
    tick.frequency.value = lerp(2000, 5000, clickAmt);
    const tickG = offline.createGain();
    tickG.gain.setValueAtTime(0.0001, t0);
    tickG.gain.exponentialRampToValueAtTime(
      0.08 + clickAmt * 0.2,
      t0 + 0.0005,
    );
    tickG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.006);
    tick.connect(tickG);
    tickG.connect(offline.destination);
    tick.start(t0);
    tick.stop(t0 + 0.01);
  }

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: bodyHz,
    machine,
  };
}

async function renderSnare(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
): Promise<RenderRoleResult> {
  const body = kn(machine, "body");
  const snare = kn(machine, "snare");
  const tone = kn(machine, "tone");
  const length = kn(machine, "length");

  const bodyHz = logLerp(140, 280, body);
  const durSec = lerp(0.12, 0.45, length);
  const noiseAmt = 0.35 + snare * 0.65;
  const bodyAmt = 0.55 + body * 0.35;
  const frames = Math.ceil((durSec + 0.05) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  // Body tone with short pitch drop.
  const osc = offline.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(bodyHz * 1.6, t0);
  osc.frequency.exponentialRampToValueAtTime(bodyHz, t0 + 0.025);
  const bodyG = offline.createGain();
  bodyG.gain.setValueAtTime(0.0001, t0);
  bodyG.gain.exponentialRampToValueAtTime(0.7 * bodyAmt, t0 + 0.002);
  bodyG.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec * 0.55);
  const bodyLp = offline.createBiquadFilter();
  bodyLp.type = "lowpass";
  bodyLp.frequency.value = lerp(400, 1800, tone);
  osc.connect(bodyLp);
  bodyLp.connect(bodyG);
  bodyG.connect(offline.destination);
  osc.start(t0);
  osc.stop(t0 + durSec);

  // Snare wires: pink noise, band-shaped.
  const nFrames = Math.ceil(durSec * sampleRate);
  const nbuf = offline.createBuffer(1, nFrames, sampleRate);
  fillPink(nbuf.getChannelData(0), rnd);
  const nsrc = offline.createBufferSource();
  nsrc.buffer = nbuf;
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = lerp(800, 2800, snare);
  const bp = offline.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = lerp(1800, 5500, tone);
  bp.Q.value = lerp(0.6, 1.8, snare);
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lerp(4000, 12_000, tone);
  const nG = offline.createGain();
  nG.gain.setValueAtTime(0.0001, t0);
  nG.gain.exponentialRampToValueAtTime(0.85 * noiseAmt, t0 + 0.0015);
  nG.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
  nsrc.connect(hp);
  hp.connect(bp);
  bp.connect(lp);
  lp.connect(nG);
  nG.connect(offline.destination);
  nsrc.start(t0);
  nsrc.stop(t0 + durSec + 0.01);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: bodyHz,
    machine,
  };
}

async function renderHat(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
): Promise<RenderRoleResult> {
  const brightness = kn(machine, "brightness");
  const open = kn(machine, "open");
  const metal = kn(machine, "metal");
  const length = kn(machine, "length");

  const durSec = lerp(0.04, 0.35, Math.max(open, length * 0.7));
  const frames = Math.ceil((durSec + 0.04) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  // Metallic stack: inharmonic square partials (TR-ish hats).
  const ratios = [1, 1.342, 1.547, 1.831, 2.213, 2.547];
  const baseHz = logLerp(220, 480, metal * 0.4 + brightness * 0.3);
  const mix = offline.createGain();
  mix.gain.value = 1;
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = logLerp(2500, 9000, brightness);
  hp.Q.value = 0.7;
  const bp = offline.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = logLerp(5000, 12_000, brightness);
  bp.Q.value = lerp(0.8, 3.5, metal);
  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.7, t0 + 0.001);
  const sustain = lerp(0.0001, 0.12, open);
  amp.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, sustain),
    t0 + lerp(0.02, 0.08, open),
  );
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i] ?? 1;
    const osc = offline.createOscillator();
    osc.type = "square";
    osc.frequency.value = baseHz * r * (1 + (rnd() - 0.5) * 0.01 * metal);
    const g = offline.createGain();
    g.gain.value = (0.18 + metal * 0.08) / (1 + i * 0.35);
    osc.connect(g);
    g.connect(mix);
    osc.start(t0);
    osc.stop(t0 + durSec + 0.02);
  }

  // Air / noise layer.
  const nFrames = Math.ceil(durSec * sampleRate);
  const nbuf = offline.createBuffer(1, nFrames, sampleRate);
  fillWhite(nbuf.getChannelData(0), rnd);
  const nsrc = offline.createBufferSource();
  nsrc.buffer = nbuf;
  const nG = offline.createGain();
  nG.gain.value = 0.25 + brightness * 0.2;
  nsrc.connect(nG);
  nG.connect(mix);
  nsrc.start(t0);
  nsrc.stop(t0 + durSec);

  mix.connect(hp);
  hp.connect(bp);
  bp.connect(amp);
  amp.connect(offline.destination);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    machine,
  };
}

async function renderPerc(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
  fundHz?: number,
): Promise<RenderRoleResult> {
  const tone = kn(machine, "tone");
  const click = kn(machine, "click");
  const decay = kn(machine, "decay");
  const pitch = kn(machine, "pitch");

  const bodyHz = fundHz ?? logLerp(180, 720, pitch);
  const durSec = lerp(0.08, 0.4, decay);
  const frames = Math.ceil((durSec + 0.04) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  const osc = offline.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(bodyHz * lerp(1.8, 3.2, click), t0);
  osc.frequency.exponentialRampToValueAtTime(bodyHz, t0 + 0.03);
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = logLerp(600, 5000, tone);
  lp.Q.value = lerp(1, 6, tone);
  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.9, t0 + 0.0015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
  osc.connect(lp);
  lp.connect(amp);
  amp.connect(offline.destination);
  osc.start(t0);
  osc.stop(t0 + durSec + 0.02);

  if (click > 0.05) {
    const clickFrames = Math.ceil(0.015 * sampleRate);
    const nbuf = offline.createBuffer(1, clickFrames, sampleRate);
    fillWhite(nbuf.getChannelData(0), rnd);
    const nsrc = offline.createBufferSource();
    nsrc.buffer = nbuf;
    const hp = offline.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = lerp(2000, 8000, click);
    const nG = offline.createGain();
    nG.gain.setValueAtTime(0.0001, t0);
    nG.gain.exponentialRampToValueAtTime(0.35 * click, t0 + 0.0005);
    nG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012);
    nsrc.connect(hp);
    hp.connect(nG);
    nG.connect(offline.destination);
    nsrc.start(t0);
    nsrc.stop(t0 + 0.02);
  }

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: bodyHz,
    machine,
  };
}

async function renderBass(
  machine: MachineParams,
  sampleRate: number,
  fundHz?: number,
): Promise<RenderRoleResult> {
  const tone = kn(machine, "tone");
  const growl = kn(machine, "growl");
  const warmth = kn(machine, "warmth");
  const length = kn(machine, "length");

  const fund = fundHz ?? logLerp(40, 110, warmth * 0.4 + (1 - tone) * 0.2);
  const durSec = lerp(0.35, 1.4, length);
  const frames = Math.ceil((durSec + 0.08) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  // Sub sine + mid saw, filter envelope.
  const sub = offline.createOscillator();
  sub.type = "sine";
  sub.frequency.value = fund;
  const saw = offline.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.value = fund;
  const subG = offline.createGain();
  subG.gain.value = 0.55 + warmth * 0.3;
  const sawG = offline.createGain();
  sawG.gain.value = 0.25 + tone * 0.35 + growl * 0.2;

  const filter = offline.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = lerp(0.7, 8, growl);
  const cutOpen = logLerp(200, 2800, tone);
  const cutClosed = logLerp(80, 400, warmth);
  filter.frequency.setValueAtTime(cutClosed, t0);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(cutClosed + 1, cutOpen),
    t0 + 0.01,
  );
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(60, cutClosed * 0.8),
    t0 + lerp(0.12, 0.45, growl),
  );

  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.85, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.55, t0 + 0.12);
  amp.gain.setValueAtTime(0.55, Math.max(0.15, durSec - 0.12));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

  const shaper = offline.createWaveShaper();
  shaper.curve = new Float32Array(softClipCurve(lerp(0.1, 0.55, growl)));
  shaper.oversample = "2x";

  sub.connect(subG);
  saw.connect(sawG);
  subG.connect(filter);
  sawG.connect(filter);
  filter.connect(amp);
  amp.connect(shaper);
  shaper.connect(offline.destination);

  // Mild 2-op growl layer.
  if (growl > 0.15) {
    const mod = offline.createOscillator();
    mod.type = "sine";
    mod.frequency.value = fund * lerp(1.5, 3.2, growl);
    const modG = offline.createGain();
    modG.gain.value = fund * lerp(0.5, 4, growl);
    const car = offline.createOscillator();
    car.type = "sine";
    car.frequency.value = fund;
    mod.connect(modG);
    modG.connect(car.frequency);
    const fmG = offline.createGain();
    fmG.gain.value = 0.15 * growl;
    car.connect(fmG);
    fmG.connect(shaper);
    mod.start(t0);
    car.start(t0);
    mod.stop(t0 + durSec + 0.02);
    car.stop(t0 + durSec + 0.02);
  }

  sub.start(t0);
  saw.start(t0);
  sub.stop(t0 + durSec + 0.02);
  saw.stop(t0 + durSec + 0.02);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: fund,
    machine,
  };
}

async function renderPad(
  machine: MachineParams,
  sampleRate: number,
  fundHz?: number,
): Promise<RenderRoleResult> {
  const brightness = kn(machine, "brightness");
  const space = kn(machine, "space");
  const attack = kn(machine, "attack");
  const warmth = kn(machine, "warmth");

  const fund = fundHz ?? logLerp(110, 330, warmth * 0.3 + 0.35);
  const durSec = lerp(1.2, 3.5, space);
  const atk = lerp(0.15, 1.2, attack);
  const frames = Math.ceil((durSec + 0.15) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  const mix = offline.createGain();
  const dets = [-12, -5, 0, 7, 14];
  for (const cents of dets) {
    const osc = offline.createOscillator();
    osc.type = warmth > 0.55 ? "triangle" : "sawtooth";
    osc.frequency.value = fund;
    osc.detune.value = cents * (0.5 + space);
    const g = offline.createGain();
    g.gain.value = 0.18;
    osc.connect(g);
    g.connect(mix);
    osc.start(t0);
    osc.stop(t0 + durSec + 0.05);
  }

  const filter = offline.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = logLerp(400, 4500, brightness);
  filter.Q.value = 0.5;
  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(0.7, t0 + atk);
  amp.gain.setValueAtTime(0.65, Math.max(atk + 0.1, durSec - 0.4));
  amp.gain.linearRampToValueAtTime(0.0001, t0 + durSec);

  mix.connect(filter);
  filter.connect(amp);
  amp.connect(offline.destination);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: fund,
    machine,
  };
}

async function renderLead(
  machine: MachineParams,
  sampleRate: number,
  fundHz?: number,
): Promise<RenderRoleResult> {
  const bite = kn(machine, "bite");
  const brightness = kn(machine, "brightness");
  const glide = kn(machine, "glide");
  const length = kn(machine, "length");

  const fund = fundHz ?? logLerp(220, 880, 0.45);
  const durSec = lerp(0.25, 1.1, length);
  const atk = lerp(0.005, 0.12, glide);
  const frames = Math.ceil((durSec + 0.08) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  const osc = offline.createOscillator();
  osc.type = bite > 0.55 ? "square" : "sawtooth";
  osc.frequency.setValueAtTime(fund * (glide > 0.6 ? 0.97 : 1), t0);
  if (glide > 0.4) {
    osc.frequency.exponentialRampToValueAtTime(fund, t0 + atk * 1.5);
  } else {
    osc.frequency.value = fund;
  }

  const filter = offline.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = lerp(1, 10, bite);
  const peak = logLerp(800, 9000, brightness);
  filter.frequency.setValueAtTime(peak * 0.4, t0);
  filter.frequency.exponentialRampToValueAtTime(peak, t0 + 0.02);
  filter.frequency.exponentialRampToValueAtTime(
    peak * lerp(0.3, 0.7, bite),
    t0 + 0.15,
  );

  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.8, t0 + Math.max(0.003, atk));
  amp.gain.exponentialRampToValueAtTime(0.45, t0 + 0.12);
  amp.gain.setValueAtTime(0.4, Math.max(0.15, durSec - 0.1));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

  const shaper = offline.createWaveShaper();
  shaper.curve = new Float32Array(softClipCurve(lerp(0.05, 0.4, bite)));

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(shaper);
  shaper.connect(offline.destination);
  osc.start(t0);
  osc.stop(t0 + durSec + 0.02);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: fund,
    machine,
  };
}

async function renderFx(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
): Promise<RenderRoleResult> {
  const chaos = kn(machine, "chaos");
  const brightness = kn(machine, "brightness");
  const space = kn(machine, "space");
  const length = kn(machine, "length");

  const durSec = lerp(0.4, 2.2, Math.max(space, length));
  const fund = logLerp(60, 400, rnd());
  const frames = Math.ceil((durSec + 0.1) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  const mod = offline.createOscillator();
  mod.type = "sine";
  mod.frequency.value = fund * lerp(1.1, 7, chaos);
  const modG = offline.createGain();
  modG.gain.value = fund * lerp(2, 18, chaos);
  const car = offline.createOscillator();
  car.type = "sine";
  car.frequency.setValueAtTime(fund * lerp(0.5, 2, brightness), t0);
  car.frequency.exponentialRampToValueAtTime(
    Math.max(30, fund * lerp(0.25, 3, chaos)),
    t0 + durSec * 0.8,
  );
  mod.connect(modG);
  modG.connect(car.frequency);

  const nFrames = Math.ceil(durSec * sampleRate);
  const nbuf = offline.createBuffer(1, nFrames, sampleRate);
  fillPink(nbuf.getChannelData(0), rnd);
  const nsrc = offline.createBufferSource();
  nsrc.buffer = nbuf;
  const nFilter = offline.createBiquadFilter();
  nFilter.type = "bandpass";
  nFilter.frequency.value = logLerp(400, 8000, brightness);
  nFilter.Q.value = lerp(0.5, 4, chaos);
  const nG = offline.createGain();
  nG.gain.value = 0.15 + chaos * 0.35;

  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(0.7, t0 + lerp(0.02, 0.4, space));
  amp.gain.linearRampToValueAtTime(0.0001, t0 + durSec);

  car.connect(amp);
  nsrc.connect(nFilter);
  nFilter.connect(nG);
  nG.connect(amp);
  amp.connect(offline.destination);

  mod.start(t0);
  car.start(t0);
  nsrc.start(t0);
  mod.stop(t0 + durSec + 0.02);
  car.stop(t0 + durSec + 0.02);
  nsrc.stop(t0 + durSec);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    fundHz: fund,
    machine,
  };
}

async function renderTexture(
  machine: MachineParams,
  sampleRate: number,
  rnd: () => number,
): Promise<RenderRoleResult> {
  const breath = kn(machine, "breath");
  const grain = kn(machine, "grain");
  const space = kn(machine, "space");
  const brightness = kn(machine, "brightness");

  const durSec = lerp(1.0, 3.8, space);
  const frames = Math.ceil((durSec + 0.1) * sampleRate);
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const t0 = 0;

  const nbuf = offline.createBuffer(1, frames, sampleRate);
  fillPink(nbuf.getChannelData(0), rnd);
  // Sparse grains: zero out chunks.
  const data = nbuf.getChannelData(0);
  const grainLen = Math.max(64, Math.floor(lerp(800, 80, grain) * (sampleRate / 1000)));
  const density = 0.15 + breath * 0.5;
  for (let i = 0; i < data.length; i += grainLen) {
    if (rnd() > density) {
      for (let j = i; j < Math.min(data.length, i + grainLen); j++) {
        data[j] = 0;
      }
    } else {
      // Soft window
      for (let j = 0; j < grainLen && i + j < data.length; j++) {
        const w = Math.sin((Math.PI * j) / grainLen);
        data[i + j] = (data[i + j] ?? 0) * w;
      }
    }
  }

  const src = offline.createBufferSource();
  src.buffer = nbuf;
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = logLerp(80, 1200, breath);
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = logLerp(600, 10_000, brightness);
  const amp = offline.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(0.65, t0 + lerp(0.3, 1.2, space));
  amp.gain.setValueAtTime(0.55, Math.max(0.5, durSec - 0.5));
  amp.gain.linearRampToValueAtTime(0.0001, t0 + durSec);

  src.connect(hp);
  hp.connect(lp);
  lp.connect(amp);
  amp.connect(offline.destination);
  src.start(t0);
  src.stop(t0 + durSec);

  const rendered = await offline.startRendering();
  const pcm = normalizePeak(new Float32Array(rendered.getChannelData(0)));
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    machine,
  };
}

export type RenderRoleOpts = {
  sampleRate?: number;
  /** Musical lock for pitched roles (bass / pad / lead / perc). */
  fundHz?: number;
  rnd?: () => number;
};

/**
 * Bake one oneshot with the role-specific synthesizer.
 * `arp` is handled separately via renderArp.
 */
export async function renderRole(
  role: Exclude<SynthRoleId, "pivot" | "arp">,
  machineIn: MachineParams,
  opts?: RenderRoleOpts,
): Promise<RenderRoleResult> {
  const machine = clampMachineParams(role, machineIn);
  const sampleRate = opts?.sampleRate ?? 48_000;
  const rnd = opts?.rnd ?? Math.random;
  const fundHz = opts?.fundHz;

  let baked: RenderRoleResult;
  switch (role) {
    case "kick":
      baked = await renderKick(machine, sampleRate, rnd);
      break;
    case "snare":
      baked = await renderSnare(machine, sampleRate, rnd);
      break;
    case "hat":
      baked = await renderHat(machine, sampleRate, rnd);
      break;
    case "perc":
      baked = await renderPerc(machine, sampleRate, rnd, fundHz);
      break;
    case "bass":
      baked = await renderBass(machine, sampleRate, fundHz);
      break;
    case "pad":
      baked = await renderPad(machine, sampleRate, fundHz);
      break;
    case "lead":
      baked = await renderLead(machine, sampleRate, fundHz);
      break;
    case "fx":
      baked = await renderFx(machine, sampleRate, rnd);
      break;
    case "texture":
      baked = await renderTexture(machine, sampleRate, rnd);
      break;
    default: {
      const _exhaustive: never = role;
      throw new Error(`No role synth for ${String(_exhaustive)}`);
    }
  }
  return applyMachineFilter(baked, machine);
}
