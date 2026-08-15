import {
  pickArpBars,
  pickArpDivision,
  pickArpForm,
  pickArpLfos,
  pickArpMotifs,
  pickArpPattern,
} from "./arp.js";
import {
  applyCoherenceToCards,
  quantizePitchedParams,
  roleFundTargetHz,
  tonicHz,
  type CoherenceOpts,
} from "./coherence.js";
import { denormalizeNoise } from "./map.js";
import { renderAdditive } from "./render-additive.js";
import { renderArp } from "./render-arp.js";
import { renderFm } from "./render-fm.js";
import { renderGranular } from "./render-granular.js";
import { renderNoise } from "./render-noise.js";
import { renderPhysical } from "./render-physical.js";
import {
  renderRole,
  sampleMachineParams,
  usesRoleSynth,
} from "./render-role.js";
import { renderSubtractive } from "./render-subtractive.js";
import { renderVoice } from "./render-voice.js";
import { mixPcm } from "./audio-util.js";
import {
  defaultAdditiveRangesAround,
  defaultFmRangesAround,
  defaultGranularRangesAround,
  defaultNoiseRangesAround,
  defaultPhysicalRangesAround,
  defaultRangesAround,
  defaultVoiceRangesAround,
  mulberry32,
  sampleAdditive,
  sampleFm,
  sampleGranular,
  sampleNoise,
  samplePhysical,
  sampleSubtractive,
  sampleVoice,
} from "./sample.js";
import type { MachineParams } from "./machines.js";
import type { SynthRoleCard } from "./roles.js";
import type {
  AdditiveNorm,
  AdditiveRanges,
  FmNorm,
  FmRanges,
  GranularNorm,
  GranularRanges,
  NoiseNorm,
  NoiseRanges,
  PhysicalNorm,
  PhysicalRanges,
  SubtractiveNorm,
  SubtractiveRanges,
  SynthEngineId,
  SynthMeta,
  SynthMode,
  SynthRoleId,
  VoiceNorm,
  VoiceRanges,
} from "./types.js";
import {
  DEFAULT_ADDITIVE_NORM,
  DEFAULT_FM_NORM,
  DEFAULT_GRANULAR_NORM,
  DEFAULT_NOISE_NORM,
  DEFAULT_PHYSICAL_NORM,
  DEFAULT_SUBTRACTIVE_NORM,
  DEFAULT_VOICE_NORM,
  LIVE_ENGINES,
} from "./types.js";

export type VariationBatchItem = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: 1;
  durationMs: number;
  meta: SynthMeta;
};

export type EngineRangeOpts = {
  ranges?: SubtractiveRanges;
  pivot?: SubtractiveNorm;
  randomness?: number;
};

export type VariationBatchOpts = {
  engines?: readonly SynthEngineId[];
  count: number;
  seed: number;
  sampleRate?: number;
  referentId?: string;
  yieldEvery?: number;
  mode?: SynthMode;
  role?: SynthRoleId;
  subtractive?: EngineRangeOpts;
  fm?: { ranges?: FmRanges; pivot?: FmNorm; randomness?: number };
  noise?: { ranges?: NoiseRanges; pivot?: NoiseNorm; randomness?: number };
  ranges?: SubtractiveRanges;
};

export type GenerateFromRolesOpts = {
  cards: readonly SynthRoleCard[];
  seed: number;
  mode: SynthMode;
  sampleRate?: number;
  referentId?: string;
  yieldEvery?: number;
  coherence?: CoherenceOpts;
  intention?: string;
};

function yieldTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function resolveEngines(
  engines: readonly SynthEngineId[] | undefined,
): SynthEngineId[] {
  const live = new Set<SynthEngineId>(LIVE_ENGINES);
  const picked = (
    engines?.length ? [...engines] : (["subtractive"] as const)
  ).filter((e): e is SynthEngineId => live.has(e));
  return picked.length > 0 ? picked : ["subtractive"];
}

type RangeBags = {
  sub: SubtractiveRanges;
  fm: FmRanges;
  noise: NoiseRanges;
  granular: GranularRanges;
  additive: AdditiveRanges;
  physical: PhysicalRanges;
  voice: VoiceRanges;
};

async function renderOneRoleSynth(opts: {
  role: Exclude<SynthRoleId, "pivot" | "arp">;
  machine: MachineParams;
  randomness: number;
  rnd: () => number;
  sampleRate?: number;
  seed: number;
  mode: SynthMode;
  referentId?: string;
  coherence?: CoherenceOpts;
  intention?: string;
}): Promise<VariationBatchItem> {
  const machine = sampleMachineParams(
    opts.role,
    opts.machine,
    opts.randomness,
    opts.rnd,
  );
  let fundHz: number | undefined;
  const coh = opts.coherence;
  if (coh?.kind === "musical") {
    const target = roleFundTargetHz(
      opts.role,
      coh.tonicPc ?? 0,
      coh.scaleMode ?? "major",
    );
    if (target != null && (opts.role === "bass" || opts.role === "pad" || opts.role === "lead" || opts.role === "perc")) {
      fundHz = target;
    }
  }
  const rendered = await renderRole(opts.role, machine, {
    sampleRate: opts.sampleRate,
    fundHz,
    rnd: opts.rnd,
  });
  const meta: SynthMeta = {
    mode: opts.mode,
    seed: opts.seed,
    engines: [],
    engine: "subtractive",
    role: opts.role,
    roleSynth: true,
    machine,
    referentId: opts.referentId,
    coherence: opts.coherence?.kind,
    tonicPc: opts.coherence?.tonicPc,
    bpm: opts.coherence?.bpm,
    freeFmRatios: opts.coherence?.freeFmRatios,
    intention: opts.intention,
    fundHz: rendered.fundHz,
  };
  return {
    pcm: rendered.pcm,
    sampleRate: rendered.sampleRate,
    channelCount: 1,
    durationMs: rendered.durationMs,
    meta,
  };
}

async function renderOneVoice(opts: {
  engines: SynthEngineId[];
  bags: RangeBags;
  rnd: () => number;
  sampleRate?: number;
  seed: number;
  mode: SynthMode;
  role?: SynthRoleId;
  machine?: MachineParams;
  randomness?: number;
  referentId?: string;
  coherence?: CoherenceOpts;
  intention?: string;
}): Promise<VariationBatchItem> {
  if (opts.role === "arp") {
    return renderOneArp(opts);
  }
  if (usesRoleSynth(opts.role) && opts.role) {
    return renderOneRoleSynth({
      role: opts.role,
      machine: opts.machine ?? {},
      randomness: opts.randomness ?? 0.55,
      rnd: opts.rnd,
      sampleRate: opts.sampleRate,
      seed: opts.seed,
      mode: opts.mode,
      referentId: opts.referentId,
      coherence: opts.coherence,
      intention: opts.intention,
    });
  }

  const buffers: Float32Array[] = [];
  const meta: SynthMeta = {
    mode: opts.mode,
    seed: opts.seed,
    engines: opts.engines,
    engine: opts.engines[0] ?? "subtractive",
    role: opts.role,
    roleSynth: false,
    referentId: opts.referentId,
    coherence: opts.coherence?.kind,
    tonicPc: opts.coherence?.tonicPc,
    bpm: opts.coherence?.bpm,
    freeFmRatios: opts.coherence?.freeFmRatios,
    intention: opts.intention,
  };
  const sr = opts.sampleRate;

  // Sample + quantize pitched engines first so FM can lock unison / layered.
  let subParams = opts.engines.includes("subtractive")
    ? sampleSubtractive(opts.bags.sub, opts.rnd)
    : undefined;
  let fmParams = opts.engines.includes("fm")
    ? sampleFm(opts.bags.fm, opts.rnd)
    : undefined;
  let addParams = opts.engines.includes("additive")
    ? sampleAdditive(opts.bags.additive, opts.rnd)
    : undefined;
  let physParams = opts.engines.includes("physical")
    ? samplePhysical(opts.bags.physical, opts.rnd)
    : undefined;
  let voiceParams = opts.engines.includes("voice")
    ? sampleVoice(opts.bags.voice, opts.rnd)
    : undefined;

  if (opts.coherence) {
    const q = quantizePitchedParams(opts.role, opts.coherence, {
      sub: subParams,
      fm: fmParams,
      additive: addParams,
      physical: physParams,
      voice: voiceParams,
    });
    subParams = q.sub ?? subParams;
    fmParams = q.fm ?? fmParams;
    addParams = q.additive ?? addParams;
    physParams = q.physical ?? physParams;
    voiceParams = q.voice ?? voiceParams;
  }

  const sharedFundNorm =
    subParams?.fund ??
    addParams?.fund ??
    voiceParams?.fund ??
    physParams?.length ??
    fmParams?.carrier;
  const fmLayered =
    fmParams != null &&
    (subParams != null ||
      addParams != null ||
      voiceParams != null ||
      physParams != null);
  if (fmLayered && fmParams && sharedFundNorm != null) {
    fmParams = { ...fmParams, carrier: sharedFundNorm };
  }

  if (subParams) {
    const rendered = await renderSubtractive(subParams, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.subtractive = { params: subParams, physical: rendered.physical };
    meta.fundHz = rendered.physical.fundHz;
    meta.cutoffHz = rendered.physical.cutoffHz;
  }
  if (fmParams) {
    const rendered = await renderFm(fmParams, {
      sampleRate: sr,
      layered: fmLayered,
    });
    buffers.push(rendered.pcm);
    meta.fm = { params: fmParams, physical: rendered.physical };
    meta.fundHz ??= rendered.physical.carrierHz;
  }
  if (opts.engines.includes("noise")) {
    const params = sampleNoise(opts.bags.noise, opts.rnd);
    const rendered = await renderNoise(params, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.noise = { params, physical: rendered.physical };
    meta.cutoffHz ??= rendered.physical.lpHz;
  }
  if (opts.engines.includes("granular")) {
    let params = sampleGranular(opts.bags.granular, opts.rnd);
    if (opts.coherence?.kind === "musical") {
      params = { ...params, pitchRand: Math.min(params.pitchRand, 0.05) };
    }
    const rendered = await renderGranular(params, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.granular = { params, physical: rendered.physical };
  }
  if (addParams) {
    const rendered = await renderAdditive(addParams, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.additive = { params: addParams, physical: rendered.physical };
    meta.fundHz ??= rendered.physical.fundHz;
  }
  if (physParams) {
    const rendered = await renderPhysical(physParams, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.physicalModel = { params: physParams, physical: rendered.physical };
    meta.fundHz ??= rendered.physical.fundHz;
  }
  if (voiceParams) {
    const rendered = await renderVoice(voiceParams, { sampleRate: sr });
    buffers.push(rendered.pcm);
    meta.voice = { params: voiceParams, physical: rendered.physical };
    meta.fundHz ??= rendered.physical.fundHz;
  }

  const pcm = mixPcm(buffers);
  const sampleRate = sr ?? 48_000;
  return {
    pcm,
    sampleRate,
    channelCount: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    meta,
  };
}

/** Phrase bake: sequenced arp using the card's selected engines. */
async function renderOneArp(opts: {
  engines: SynthEngineId[];
  bags: RangeBags;
  rnd: () => number;
  sampleRate?: number;
  seed: number;
  mode: SynthMode;
  referentId?: string;
  coherence?: CoherenceOpts;
  intention?: string;
}): Promise<VariationBatchItem> {
  const engines = resolveEngines(opts.engines);
  let sub = sampleSubtractive(opts.bags.sub, opts.rnd);
  let fm = sampleFm(opts.bags.fm, opts.rnd);
  let noise = sampleNoise(opts.bags.noise, opts.rnd);
  let additive = sampleAdditive(opts.bags.additive, opts.rnd);
  let physical = samplePhysical(opts.bags.physical, opts.rnd);
  let voice = sampleVoice(opts.bags.voice, opts.rnd);
  const coherence = opts.coherence;
  if (coherence) {
    const q = quantizePitchedParams("arp", coherence, {
      sub,
      fm,
      additive,
      physical,
      voice,
    });
    sub = q.sub ?? sub;
    fm = q.fm ?? fm;
    additive = q.additive ?? additive;
    physical = q.physical ?? physical;
    voice = q.voice ?? voice;
  }
  const bpm = Math.max(40, Math.min(240, coherence?.bpm ?? 120));
  const scaleMode = coherence?.scaleMode ?? "major";
  const tonicPc = ((Math.round(coherence?.tonicPc ?? 0) % 12) + 12) % 12;
  // Arp is always tonal: lock to page/song tonic (ignore parametric fund drift).
  const fundHz = tonicHz(tonicPc, 4);
  const pattern = pickArpPattern(opts.rnd);
  const bars = pickArpBars(opts.rnd);
  const division = pickArpDivision(opts.rnd, bpm);
  const form = pickArpForm(opts.rnd);
  const motifs = pickArpMotifs(opts.rnd, 4);
  const lfos = pickArpLfos(opts.rnd);
  const rendered = await renderArp({
    fundHz,
    tonicPc,
    tonicOctave: 4,
    scaleMode,
    pattern,
    bpm,
    bars,
    division,
    form,
    motifs,
    lfos,
    engines,
    subtractive: sub,
    fm,
    noise,
    additive,
    physical,
    voice,
    sampleRate: opts.sampleRate,
  });

  const meta: SynthMeta = {
    mode: opts.mode,
    seed: opts.seed,
    engines: rendered.engines,
    engine: rendered.engines[0] ?? "subtractive",
    role: "arp",
    referentId: opts.referentId,
    coherence: coherence?.kind,
    tonicPc: coherence?.tonicPc,
    bpm,
    intention: opts.intention,
    subtractive: engines.includes("subtractive") || engines.includes("granular")
      ? { params: sub, physical: rendered.physical }
      : undefined,
    fm: rendered.fm ? { params: fm, physical: rendered.fm } : undefined,
    noise: engines.includes("noise")
      ? { params: noise, physical: denormalizeNoise(noise) }
      : undefined,
    additive: rendered.additive
      ? { params: additive, physical: rendered.additive }
      : undefined,
    physicalModel: rendered.physicalModel
      ? { params: physical, physical: rendered.physicalModel }
      : undefined,
    voice: rendered.voice
      ? { params: voice, physical: rendered.voice }
      : undefined,
    arp: {
      pattern: rendered.pattern,
      bars: rendered.bars,
      division: rendered.division,
      form: rendered.form,
      motifs: rendered.motifs,
      lfos: rendered.lfos,
    },
    fundHz: rendered.fundHz,
    cutoffHz: rendered.physical.cutoffHz,
  };

  return {
    pcm: rendered.pcm,
    sampleRate: rendered.sampleRate,
    channelCount: 1,
    durationMs: rendered.durationMs,
    meta,
  };
}

function bagsFromCard(
  card: SynthRoleCard,
  mode: SynthMode,
): RangeBags {
  const usePivot = card.usePivot && mode === "variations";
  return {
    sub: usePivot
      ? defaultRangesAround(card.pivot, card.randomness)
      : card.ranges,
    fm: usePivot
      ? defaultFmRangesAround(card.pivotFm, card.randomness)
      : card.rangesFm,
    noise: usePivot
      ? defaultNoiseRangesAround(card.pivotNoise, card.randomness)
      : card.rangesNoise,
    granular: usePivot
      ? defaultGranularRangesAround(card.pivotGranular, card.randomness)
      : card.rangesGranular,
    additive: usePivot
      ? defaultAdditiveRangesAround(card.pivotAdditive, card.randomness)
      : card.rangesAdditive,
    physical: usePivot
      ? defaultPhysicalRangesAround(card.pivotPhysical, card.randomness)
      : card.rangesPhysical,
    voice: usePivot
      ? defaultVoiceRangesAround(card.pivotVoice, card.randomness)
      : card.rangesVoice,
  };
}

export async function generateVariations(
  opts: VariationBatchOpts,
): Promise<VariationBatchItem[]> {
  const count = Math.min(40, Math.max(1, Math.floor(opts.count)));
  const rnd = mulberry32(opts.seed);
  const yieldEvery = Math.max(1, opts.yieldEvery ?? 1);
  const engines = resolveEngines(opts.engines);
  const randomness = opts.subtractive?.randomness ?? 0.35;
  const mode = opts.mode ?? "variations";
  const bags: RangeBags = {
    sub:
      opts.subtractive?.ranges ??
      opts.ranges ??
      defaultRangesAround(
        opts.subtractive?.pivot ?? DEFAULT_SUBTRACTIVE_NORM,
        randomness,
      ),
    fm:
      opts.fm?.ranges ??
      defaultFmRangesAround(
        opts.fm?.pivot ?? DEFAULT_FM_NORM,
        opts.fm?.randomness ?? randomness,
      ),
    noise:
      opts.noise?.ranges ??
      defaultNoiseRangesAround(
        opts.noise?.pivot ?? DEFAULT_NOISE_NORM,
        opts.noise?.randomness ?? randomness,
      ),
    granular: defaultGranularRangesAround(DEFAULT_GRANULAR_NORM, randomness),
    additive: defaultAdditiveRangesAround(DEFAULT_ADDITIVE_NORM, randomness),
    physical: defaultPhysicalRangesAround(DEFAULT_PHYSICAL_NORM, randomness),
    voice: defaultVoiceRangesAround(DEFAULT_VOICE_NORM, randomness),
  };

  const out: VariationBatchItem[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      await renderOneVoice({
        engines,
        bags,
        rnd,
        sampleRate: opts.sampleRate,
        seed: opts.seed,
        mode,
        role: opts.role,
        referentId: opts.referentId,
      }),
    );
    if ((i + 1) % yieldEvery === 0 && i + 1 < count) await yieldTick();
  }
  return out;
}

export async function generateFromRoles(
  opts: GenerateFromRolesOpts,
): Promise<VariationBatchItem[]> {
  const rnd = mulberry32(opts.seed);
  const yieldEvery = Math.max(1, opts.yieldEvery ?? 1);
  const out: VariationBatchItem[] = [];
  let rendered = 0;

  const cards =
    opts.coherence && (opts.mode === "song" || opts.mode === "family")
      ? applyCoherenceToCards(opts.cards, opts.coherence)
      : opts.cards;

  for (const card of cards) {
    const engines = resolveEngines(card.engines);
    const count = Math.min(40, Math.max(1, Math.floor(card.quantity)));
    const bags = bagsFromCard(card, opts.mode);
    for (let i = 0; i < count; i++) {
      out.push(
        await renderOneVoice({
          engines,
          bags,
          rnd,
          sampleRate: opts.sampleRate,
          seed: opts.seed,
          mode: opts.mode,
          role: card.role,
          machine: card.machine,
          randomness: card.randomness,
          referentId: opts.referentId,
          coherence: opts.coherence,
          intention: opts.intention,
        }),
      );
      rendered++;
      if (rendered % yieldEvery === 0) await yieldTick();
    }
  }
  return out;
}

export async function renderPreview(opts: {
  engines: readonly SynthEngineId[];
  subtractive?: SubtractiveNorm;
  fm?: FmNorm;
  noise?: NoiseNorm;
  granular?: GranularNorm;
  additive?: AdditiveNorm;
  physical?: PhysicalNorm;
  voice?: VoiceNorm;
  /** When set (Family role), bake via dedicated role synthesizer. */
  role?: SynthRoleId;
  machine?: MachineParams;
  fundHz?: number;
  sampleRate?: number;
}): Promise<{ pcm: Float32Array; sampleRate: number }> {
  if (usesRoleSynth(opts.role) && opts.role) {
    const rendered = await renderRole(opts.role, opts.machine ?? {}, {
      sampleRate: opts.sampleRate,
      fundHz: opts.fundHz,
    });
    return { pcm: rendered.pcm, sampleRate: rendered.sampleRate };
  }
  const engines = resolveEngines(opts.engines);
  const buffers: Float32Array[] = [];
  const sr = opts.sampleRate;
  if (engines.includes("subtractive")) {
    buffers.push(
      (
        await renderSubtractive(opts.subtractive ?? DEFAULT_SUBTRACTIVE_NORM, {
          sampleRate: sr,
        })
      ).pcm,
    );
  }
  if (engines.includes("fm")) {
    const pitched =
      engines.includes("subtractive") ||
      engines.includes("additive") ||
      engines.includes("voice") ||
      engines.includes("physical");
    buffers.push(
      (
        await renderFm(opts.fm ?? DEFAULT_FM_NORM, {
          sampleRate: sr,
          layered: pitched,
        })
      ).pcm,
    );
  }
  if (engines.includes("noise")) {
    buffers.push(
      (await renderNoise(opts.noise ?? DEFAULT_NOISE_NORM, { sampleRate: sr }))
        .pcm,
    );
  }
  if (engines.includes("granular")) {
    buffers.push(
      (
        await renderGranular(opts.granular ?? DEFAULT_GRANULAR_NORM, {
          sampleRate: sr,
        })
      ).pcm,
    );
  }
  if (engines.includes("additive")) {
    buffers.push(
      (
        await renderAdditive(opts.additive ?? DEFAULT_ADDITIVE_NORM, {
          sampleRate: sr,
        })
      ).pcm,
    );
  }
  if (engines.includes("physical")) {
    buffers.push(
      (
        await renderPhysical(opts.physical ?? DEFAULT_PHYSICAL_NORM, {
          sampleRate: sr,
        })
      ).pcm,
    );
  }
  if (engines.includes("voice")) {
    buffers.push(
      (await renderVoice(opts.voice ?? DEFAULT_VOICE_NORM, { sampleRate: sr }))
        .pcm,
    );
  }
  return { pcm: mixPcm(buffers), sampleRate: sr ?? 48_000 };
}
