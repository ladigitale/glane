/**
 * Bake a sequenced arpeggio phrase via OfflineAudioContext.
 * Honours the card's selected engines (equal-mix when several).
 */

import { normalizePeak, softClipCurve } from "./audio-util.js";
import {
  planArpNotes,
  type ArpBars,
  type ArpFormId,
  type ArpLfo,
  type ArpNotePlan,
  type ArpPatternId,
  type PlanArpOpts,
} from "./arp.js";
import {
  denormalizeAdditive,
  denormalizeFm,
  denormalizeNoise,
  denormalizePhysical,
  denormalizeSubtractive,
  denormalizeVoice,
} from "./map.js";
import type {
  AdditiveNorm,
  AdditivePhysical,
  FmNorm,
  FmPhysical,
  NoiseNorm,
  PhysicalNorm,
  PhysicalPhysical,
  SubtractiveNorm,
  SubtractivePhysical,
  SynthEngineId,
  VoiceNorm,
  VoicePhysical,
} from "./types.js";
import {
  DEFAULT_ADDITIVE_NORM,
  DEFAULT_FM_NORM,
  DEFAULT_NOISE_NORM,
  DEFAULT_PHYSICAL_NORM,
  DEFAULT_SUBTRACTIVE_NORM,
  DEFAULT_VOICE_NORM,
  LIVE_ENGINES,
} from "./types.js";

export type RenderArpResult = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  engines: SynthEngineId[];
  physical: SubtractivePhysical;
  fm?: FmPhysical;
  additive?: AdditivePhysical;
  physicalModel?: PhysicalPhysical;
  voice?: VoicePhysical;
  pattern: ArpPatternId;
  bars: ArpBars;
  form: ArpFormId;
  division: 8 | 16;
  fundHz: number;
  lfos: ArpLfo[];
  motifs: number[];
};

export type RenderArpOpts = PlanArpOpts & {
  engines?: readonly SynthEngineId[];
  subtractive?: SubtractiveNorm;
  fm?: FmNorm;
  noise?: NoiseNorm;
  additive?: AdditiveNorm;
  physical?: PhysicalNorm;
  voice?: VoiceNorm;
  sampleRate?: number;
};

function resolveEngines(
  engines: readonly SynthEngineId[] | undefined,
): SynthEngineId[] {
  const live = new Set<SynthEngineId>(LIVE_ENGINES);
  const picked = (engines?.length ? [...engines] : (["subtractive"] as const)).filter(
    (e): e is SynthEngineId => live.has(e),
  );
  // Granular has no pitched note scheduler — map to subtractive timbre.
  const mapped = picked.map((e) => (e === "granular" ? "subtractive" : e));
  const uniq = [...new Set(mapped)];
  return uniq.length > 0 ? uniq : ["subtractive"];
}

function scheduleAmp(
  amp: GainNode,
  t0: number,
  gateSec: number,
  peak: number,
  a: number,
  d: number,
  sustain: number,
  r: number,
): number {
  const gateEnd = t0 + Math.max(0.02, gateSec);
  const p = Math.max(0.0001, peak);
  const s = Math.max(0.0001, p * Math.max(0.05, sustain));
  const atk = Math.max(0.002, a);
  const dec = Math.max(0.002, d);
  const rel = Math.max(0.01, r);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(p, t0 + atk);
  amp.gain.exponentialRampToValueAtTime(s, t0 + atk + dec);
  amp.gain.setValueAtTime(s, gateEnd);
  amp.gain.exponentialRampToValueAtTime(0.0001, gateEnd + rel);
  return gateEnd + rel;
}

function scheduleSubtractiveNote(
  offline: OfflineAudioContext,
  dest: AudioNode,
  note: ArpNotePlan,
  physical: SubtractivePhysical,
  hz: number,
  peakScale: number,
  detuneCents = 0,
): void {
  const osc = offline.createOscillator();
  osc.type = physical.wave as OscillatorType;
  osc.frequency.value = hz;
  osc.detune.value = detuneCents;

  const filter = offline.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = physical.resoQ;
  const baseCut = Math.max(80, physical.cutoffHz);
  filter.frequency.value = Math.min(
    16_000,
    Math.max(90, baseCut * note.cutoffMul),
  );

  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  osc.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  const stop =
    scheduleAmp(
      amp,
      note.timeSec,
      note.durationSec,
      note.peak * peakScale,
      note.accent
        ? Math.min(0.03, physical.ampAttackSec)
        : Math.min(0.05, physical.ampAttackSec * 1.2),
      Math.min(0.22, physical.ampDecaySec),
      physical.ampSustain,
      Math.min(0.28, physical.ampReleaseSec),
    ) + 0.02;
  osc.start(note.timeSec);
  osc.stop(stop);
}

function scheduleFmNote(
  offline: OfflineAudioContext,
  dest: AudioNode,
  note: ArpNotePlan,
  physical: FmPhysical,
  hz: number,
  peakScale: number,
  /** When layered with other pitched engines, keep FM harmonic / gentle. */
  layered: boolean,
): void {
  const carrier = offline.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = hz;

  // Snap ratio toward nearest harmonic integer so sidebands stay tonal.
  const rawRatio = Math.max(0.25, physical.ratio);
  const harmonic = Math.max(1, Math.round(rawRatio));
  const ratio = layered
    ? harmonic
    : Math.abs(rawRatio - harmonic) < 0.35
      ? harmonic
      : rawRatio;
  const modHz = hz * ratio;
  const modulator = offline.createOscillator();
  modulator.type = "sine";
  modulator.frequency.value = modHz;

  const modIndex = offline.createGain();
  modIndex.gain.value = 0.0001;

  const amp = offline.createGain();
  amp.gain.value = 0.0001;

  modulator.connect(modIndex);
  modIndex.connect(carrier.frequency);

  const feedback = layered ? physical.feedback * 0.08 : physical.feedback * 0.35;
  if (feedback > 0.001) {
    const fb = offline.createGain();
    fb.gain.value = feedback * modHz * 0.25;
    carrier.connect(fb);
    fb.connect(modulator.frequency);
  }

  carrier.connect(amp);
  amp.connect(dest);

  const indexScale = layered ? 0.22 : 0.55;
  const peakDev = Math.max(
    1,
    physical.index * indexScale * hz * Math.min(1.2, note.cutoffMul),
  );
  const gateEnd = note.timeSec + Math.max(0.02, note.durationSec);
  const ma = Math.max(0.002, physical.modAttackSec);
  const md = Math.max(0.002, physical.modDecaySec);
  const mr = Math.max(0.01, physical.modReleaseSec);
  modIndex.gain.setValueAtTime(0.0001, note.timeSec);
  modIndex.gain.exponentialRampToValueAtTime(peakDev, note.timeSec + ma);
  modIndex.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, peakDev * Math.max(0.05, physical.modSustain)),
    note.timeSec + ma + md,
  );
  modIndex.gain.setValueAtTime(
    Math.max(0.0001, peakDev * Math.max(0.05, physical.modSustain)),
    gateEnd,
  );
  modIndex.gain.exponentialRampToValueAtTime(0.0001, gateEnd + mr);

  const stop =
    scheduleAmp(
      amp,
      note.timeSec,
      note.durationSec,
      note.peak * peakScale * (layered ? 0.55 : 0.85),
      Math.min(0.04, physical.ampAttackSec),
      Math.min(0.22, physical.ampDecaySec),
      physical.ampSustain,
      Math.min(0.28, physical.ampReleaseSec),
    ) + 0.02;
  modulator.start(note.timeSec);
  carrier.start(note.timeSec);
  modulator.stop(stop);
  carrier.stop(stop);
}

function scheduleAdditiveNote(
  offline: OfflineAudioContext,
  dest: AudioNode,
  note: ArpNotePlan,
  physical: AdditivePhysical,
  hz: number,
  peakScale: number,
): void {
  const mix = offline.createGain();
  mix.gain.value = 1;
  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  mix.connect(amp);
  amp.connect(dest);

  const n = Math.max(2, physical.partials);
  const evenBias = physical.evenOdd;
  const phaseCents = physical.inharm;
  const stopAt =
    note.timeSec + note.durationSec + physical.ampReleaseSec + 0.05;
  for (let i = 1; i <= n; i++) {
    const osc = offline.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz * i;
    osc.detune.value = (i % 2 === 0 ? 1 : -1) * phaseCents;
    const g = offline.createGain();
    const odd = i % 2 === 1;
    const weight = odd ? 1 - evenBias * 0.7 : evenBias;
    g.gain.value = (weight / i) * 0.45;
    osc.connect(g);
    g.connect(mix);
    osc.start(note.timeSec);
    osc.stop(stopAt);
  }

  scheduleAmp(
    amp,
    note.timeSec,
    note.durationSec,
    note.peak * peakScale,
    Math.min(0.05, physical.ampAttackSec),
    Math.min(0.22, physical.ampDecaySec),
    physical.ampSustain,
    Math.min(0.3, physical.ampReleaseSec),
  );
}

function scheduleVoiceNote(
  offline: OfflineAudioContext,
  dest: AudioNode,
  note: ArpNotePlan,
  physical: VoicePhysical,
  hz: number,
  peakScale: number,
): void {
  const glottal = offline.createOscillator();
  glottal.type = "sawtooth";
  glottal.frequency.value = hz;

  const frames = Math.max(
    64,
    Math.ceil((note.durationSec + physical.ampReleaseSec + 0.05) * offline.sampleRate),
  );
  const breathBuf = offline.createBuffer(1, frames, offline.sampleRate);
  const bd = breathBuf.getChannelData(0);
  for (let i = 0; i < frames; i++) bd[i] = Math.random() * 2 - 1;
  const breath = offline.createBufferSource();
  breath.buffer = breathBuf;

  const glottalGain = offline.createGain();
  glottalGain.gain.value = physical.voicing;
  const breathGain = offline.createGain();
  breathGain.gain.value = physical.breath * 0.35;
  glottal.connect(glottalGain);
  breath.connect(breathGain);

  const pre = offline.createGain();
  pre.gain.value = 1;
  glottalGain.connect(pre);
  breathGain.connect(pre);

  const f1 = offline.createBiquadFilter();
  f1.type = "bandpass";
  f1.frequency.value = physical.f1Hz * note.cutoffMul;
  f1.Q.value = 8;
  const f2 = offline.createBiquadFilter();
  f2.type = "bandpass";
  f2.frequency.value = physical.f2Hz;
  f2.Q.value = 10;
  const f3 = offline.createBiquadFilter();
  f3.type = "bandpass";
  f3.frequency.value = physical.f3Hz;
  f3.Q.value = 8;

  const formMix = offline.createGain();
  formMix.gain.value = 0.55;
  pre.connect(f1);
  pre.connect(f2);
  pre.connect(f3);
  f1.connect(formMix);
  f2.connect(formMix);
  f3.connect(formMix);

  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  formMix.connect(amp);
  amp.connect(dest);

  const stop =
    scheduleAmp(
      amp,
      note.timeSec,
      note.durationSec,
      note.peak * peakScale * 0.9,
      Math.min(0.05, physical.ampAttackSec),
      Math.min(0.22, physical.ampDecaySec),
      physical.ampSustain,
      Math.min(0.3, physical.ampReleaseSec),
    ) + 0.02;
  glottal.start(note.timeSec);
  breath.start(note.timeSec);
  glottal.stop(stop);
  breath.stop(stop);
}

function scheduleNoiseNote(
  offline: OfflineAudioContext,
  dest: AudioNode,
  note: ArpNotePlan,
  cutoffHz: number,
  peakScale: number,
): void {
  const frames = Math.max(
    64,
    Math.ceil((note.durationSec + 0.08) * offline.sampleRate),
  );
  const buf = offline.createBuffer(1, frames, offline.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = offline.createBufferSource();
  src.buffer = buf;

  const filter = offline.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = Math.min(12_000, Math.max(80, cutoffHz * note.cutoffMul));
  filter.Q.value = 4;

  const amp = offline.createGain();
  amp.gain.value = 0.0001;
  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  const stop =
    scheduleAmp(
      amp,
      note.timeSec,
      note.durationSec * 0.7,
      note.peak * peakScale * 0.55,
      0.005,
      0.08,
      0.2,
      0.06,
    ) + 0.02;
  src.start(note.timeSec);
  src.stop(stop);
}

/** Karplus-Strong write into an existing mono buffer (physical engine). */
function writePhysicalNote(
  pcm: Float32Array,
  sampleRate: number,
  note: ArpNotePlan,
  physical: PhysicalPhysical,
  hz: number,
  peakScale: number,
): void {
  const t0 = Math.floor(note.timeSec * sampleRate);
  const gateFrames = Math.max(
    8,
    Math.floor(note.durationSec * sampleRate),
  );
  const relFrames = Math.max(8, Math.floor(physical.ampReleaseSec * sampleRate));
  const frames = Math.min(pcm.length - t0, gateFrames + relFrames);
  if (frames <= 0 || t0 < 0) return;

  const delayLen = Math.max(
    2,
    Math.min(sampleRate, Math.round(sampleRate / Math.max(40, hz))),
  );
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
  const damp = physical.damping;
  const stiff = physical.stiffness;
  const aN = Math.max(1, Math.floor(physical.ampAttackSec * sampleRate));
  const dN = Math.max(1, Math.floor(physical.ampDecaySec * sampleRate));
  const sustain = physical.ampSustain;
  const noteEnd = Math.max(aN + dN, frames - relFrames);
  const gain = note.peak * peakScale * 0.85;

  for (let i = 0; i < frames; i++) {
    const a = delay[idx] ?? 0;
    const b = delay[(idx + 1) % delayLen] ?? 0;
    const avg = 0.5 * (a + b);
    const filtered = damp * (avg * (1 - stiff * 0.35) + a * stiff * 0.35);
    delay[idx] = filtered;
    let env = sustain;
    if (i < aN) env = i / aN;
    else if (i < aN + dN) env = 1 - (1 - sustain) * ((i - aN) / dN);
    else if (i >= noteEnd) env = sustain * (1 - (i - noteEnd) / relFrames);
    pcm[t0 + i] = (pcm[t0 + i] ?? 0) + filtered * Math.max(0, env) * gain;
    idx = (idx + 1) % delayLen;
  }
}

/**
 * Render a multi-bar sequenced arp with multi-LFO shaping + selected engines.
 */
export async function renderArp(
  opts: RenderArpOpts,
): Promise<RenderArpResult> {
  const engines = resolveEngines(opts.engines);
  const subNorm = opts.subtractive ?? {
    ...DEFAULT_SUBTRACTIVE_NORM,
    ampAttack: 0.05,
    ampDecay: 0.25,
    ampSustain: 0.35,
    ampRelease: 0.3,
    cutoff: 0.62,
    wave: 0.7,
  };
  const fmNorm = opts.fm ?? DEFAULT_FM_NORM;
  const noiseNorm = opts.noise ?? DEFAULT_NOISE_NORM;
  const addNorm = opts.additive ?? DEFAULT_ADDITIVE_NORM;
  const physNorm = opts.physical ?? DEFAULT_PHYSICAL_NORM;
  const voiceNorm = opts.voice ?? DEFAULT_VOICE_NORM;

  const subPhys = denormalizeSubtractive(subNorm);
  const fmPhys = denormalizeFm(fmNorm);
  const noisePhys = denormalizeNoise(noiseNorm);
  const addPhys = denormalizeAdditive(addNorm);
  const ksPhys = denormalizePhysical(physNorm);
  const voicePhys = denormalizeVoice(voiceNorm);

  const planned = planArpNotes(opts);
  const { notes, durationSec, form, bars, lfos } = planned;
  const motifs = [...(opts.motifs ?? [])];
  const sampleRate = opts.sampleRate ?? 48_000;
  const releasePad = Math.max(
    0.05,
    subPhys.ampReleaseSec,
    fmPhys.ampReleaseSec,
    addPhys.ampReleaseSec,
    voicePhys.ampReleaseSec,
  ) + 0.03;
  const frames = Math.max(
    1,
    Math.ceil((durationSec + releasePad) * sampleRate),
  );

  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const bus = offline.createGain();
  // Equal-mix headroom across engines
  bus.gain.value = 1 / Math.sqrt(Math.max(1, engines.length));

  const shaper = offline.createWaveShaper();
  const curve = softClipCurve(subPhys.drive);
  shaper.curve = new Float32Array(curve);
  shaper.oversample = "2x";
  bus.connect(shaper);
  shaper.connect(offline.destination);

  const peakScale = 0.85;
  const graphEngines = engines.filter((e) => e !== "physical");
  const pitchedCount = graphEngines.filter(
    (e) => e === "subtractive" || e === "fm" || e === "additive" || e === "voice",
  ).length;
  const fmLayered = pitchedCount > 1 && engines.includes("fm");

  for (const note of notes) {
    // Unison detune only (classic synth fatness) — never stacked chord tones.
    const detunes = note.unisonDetuneCents?.length
      ? [0, ...note.unisonDetuneCents]
      : [0];

    for (const cents of detunes) {
      const voiceScale =
        peakScale * (cents === 0 ? 1 : 0.55 / Math.max(1, detunes.length - 1));
      for (const engine of graphEngines) {
        if (engine === "subtractive") {
          scheduleSubtractiveNote(
            offline,
            bus,
            note,
            subPhys,
            note.hz,
            voiceScale,
            cents,
          );
        } else if (engine === "fm" && cents === 0) {
          // FM only on center pitch (avoid inharmonic multi-detune mush).
          scheduleFmNote(
            offline,
            bus,
            note,
            fmPhys,
            note.hz,
            voiceScale,
            fmLayered,
          );
        } else if (engine === "additive" && cents === 0) {
          scheduleAdditiveNote(offline, bus, note, addPhys, note.hz, voiceScale);
        } else if (engine === "voice" && cents === 0) {
          scheduleVoiceNote(offline, bus, note, voicePhys, note.hz, voiceScale);
        } else if (engine === "noise" && cents === 0) {
          scheduleNoiseNote(
            offline,
            bus,
            note,
            noisePhys.lpHz || subPhys.cutoffHz,
            voiceScale,
          );
        }
      }
    }
  }

  const rendered = await offline.startRendering();
  let pcm = new Float32Array(rendered.getChannelData(0));

  if (engines.includes("physical")) {
    for (const note of notes) {
      writePhysicalNote(pcm, sampleRate, note, ksPhys, note.hz, peakScale);
    }
  }

  pcm = new Float32Array(normalizePeak(pcm));

  const durationMs = Math.round((pcm.length / sampleRate) * 1000);
  const barsOut: ArpBars = bars >= 8 ? 8 : bars >= 4 ? 4 : 2;

  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs,
    engines,
    physical: { ...subPhys, durationMs, fundHz: opts.fundHz },
    fm: engines.includes("fm") ? { ...fmPhys, carrierHz: opts.fundHz } : undefined,
    additive: engines.includes("additive")
      ? { ...addPhys, fundHz: opts.fundHz }
      : undefined,
    physicalModel: engines.includes("physical")
      ? { ...ksPhys, fundHz: opts.fundHz }
      : undefined,
    voice: engines.includes("voice")
      ? { ...voicePhys, fundHz: opts.fundHz }
      : undefined,
    pattern: opts.pattern ?? "sequence",
    bars: barsOut,
    form,
    division: opts.division === 16 ? 16 : 8,
    fundHz: opts.fundHz,
    lfos: [...lfos],
    motifs,
  };
}
