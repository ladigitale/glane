import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { handle, subscribe } from "@supersoniks/concorde/decorators";
import { set } from "@supersoniks/concorde/utils";
import {
  audioSynth,
  type AdditiveKey,
  type CoherenceKind,
  type FmKey,
  type GranularKey,
  type NoiseKey,
  type PhysicalKey,
  type ScaleMode,
  type SongIntention,
  type SubtractiveKey,
  type SynthEngineId,
  type SynthMode,
  type SynthRoleCard,
  type SynthRoleId,
  type VariationBatchItem,
  type VoiceKey,
  type MachineKnobId,
  type MachineFilterType,
} from "@glane/audio-synth";
import type { Sample } from "@glane/core-model";
import tailwind from "../../css/tailwind";
import { t, tf } from "../i18n/messages.js";
import { db } from "../db.js";
import { navigate } from "../router.js";
import {
  PROJECT_CHANGE_EVENT,
  projectWorkspace,
} from "../project-workspace.js";
import { saveSynthBatch } from "../sample-actions.js";
import { takeSynthHandoff } from "../synth-handoff.js";
import {
  synthUiState,
  type SynthUiSnapshot,
} from "../synth-ui-state.js";
import {
  synthFormKey,
  synthRoleFormKey,
  synthValidateFormKey,
  type SynthForm,
  type SynthRoleForm,
} from "../dp-keys.js";
import { glIcon } from "../icon.js";
import "../pop-select.js";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/fieldset";
import "@supersoniks/concorde/form-layout";
import "@supersoniks/concorde/form-actions";
import "@supersoniks/concorde/checkbox";
import "@supersoniks/concorde/switch";
import "@supersoniks/concorde/divider";
import "@supersoniks/concorde/alert";

type Phase = "edit" | "validate";
type DraftItem = VariationBatchItem;

const ENGINE_LABEL: Record<SynthEngineId, string> = {
  subtractive: "synth.engine.subtractive",
  fm: "synth.engine.fm",
  granular: "synth.engine.granular",
  additive: "synth.engine.additive",
  physical: "synth.engine.physical",
  noise: "synth.engine.noise",
  voice: "synth.engine.voice",
};

const ROLE_LABEL: Record<SynthRoleId, string> = {
  pivot: "synth.role.pivot",
  kick: "synth.role.kick",
  snare: "synth.role.snare",
  hat: "synth.role.hat",
  perc: "synth.role.perc",
  bass: "synth.role.bass",
  pad: "synth.role.pad",
  lead: "synth.role.lead",
  arp: "synth.role.arp",
  fx: "synth.role.fx",
  texture: "synth.role.texture",
};

const SUB_LABEL: Record<SubtractiveKey, string> = {
  wave: "synth.param.wave",
  fund: "synth.param.fund",
  detune: "synth.param.detune",
  cutoff: "synth.param.cutoff",
  reso: "synth.param.reso",
  filterAttack: "synth.param.filterAttack",
  filterDecay: "synth.param.filterDecay",
  filterSustain: "synth.param.filterSustain",
  filterRelease: "synth.param.filterRelease",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  drive: "synth.param.drive",
  duration: "synth.param.duration",
};

const FM_LABEL: Record<FmKey, string> = {
  carrier: "synth.param.carrier",
  ratio: "synth.param.ratio",
  index: "synth.param.index",
  modAttack: "synth.param.modAttack",
  modDecay: "synth.param.modDecay",
  modSustain: "synth.param.modSustain",
  modRelease: "synth.param.modRelease",
  feedback: "synth.param.feedback",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

const NOISE_LABEL: Record<NoiseKey, string> = {
  color: "synth.param.color",
  lp: "synth.param.lp",
  hp: "synth.param.hp",
  density: "synth.param.density",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

const GRANULAR_LABEL: Record<GranularKey, string> = {
  density: "synth.param.gDensity",
  grainSize: "synth.param.grainSize",
  pitchRand: "synth.param.pitchRand",
  position: "synth.param.position",
  spray: "synth.param.spray",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

const ADDITIVE_LABEL: Record<AdditiveKey, string> = {
  fund: "synth.param.fund",
  partials: "synth.param.partials",
  evenOdd: "synth.param.evenOdd",
  inharm: "synth.param.inharm",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

const PHYSICAL_LABEL: Record<PhysicalKey, string> = {
  length: "synth.param.length",
  stiffness: "synth.param.stiffness",
  damping: "synth.param.damping",
  excitation: "synth.param.excitation",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

const VOICE_LABEL: Record<VoiceKey, string> = {
  fund: "synth.param.fund",
  f1: "synth.param.f1",
  f2: "synth.param.f2",
  f3: "synth.param.f3",
  voicing: "synth.param.voicing",
  breath: "synth.param.breath",
  ampAttack: "synth.param.ampAttack",
  ampDecay: "synth.param.ampDecay",
  ampSustain: "synth.param.ampSustain",
  ampRelease: "synth.param.ampRelease",
  duration: "synth.param.duration",
};

type EngineKind =
  | "sub"
  | "fm"
  | "noise"
  | "granular"
  | "additive"
  | "physical"
  | "voice";

const LIVE = new Set<string>(audioSynth.liveEngines);



@customElement("gl-synth-page")
export class GlSynthPage extends LitElement {
  static override styles = [
    tailwind,
    css`
      :host {
        display: block;
        box-sizing: border-box;
        padding: 1rem;
        padding-left: max(1rem, env(safe-area-inset-left));
        padding-right: max(1rem, env(safe-area-inset-right));
        padding-bottom: max(5.5rem, env(safe-area-inset-bottom));
        --sc-label-fs: 0.9rem;
        --sc-label-fw: 500;
      }
      .form-label {
        margin-bottom: 0.22em;
        display: block;
        font-size: var(--sc-label-fs);
        font-weight: var(--sc-label-fw);
        line-height: 1.2;
      }
      .form-description {
        color: var(--sc-base-400, var(--sc-neutral-500, #888));
        font-size: 0.85em;
        margin-top: 0.2em;
        display: block;
      }
      input[type="range"] {
        width: 100%;
        accent-color: var(--sc-primary, #3d7ea6);
      }
      canvas.gl-synth-wave {
        display: block;
        width: 100%;
        height: 36px;
        border-radius: 4px;
        background: color-mix(
          in srgb,
          var(--sc-neutral-100, #222) 80%,
          transparent
        );
      }
      sonic-fieldset {
        --sc-fieldset-mb: 0;
      }
    `,
  ];

  @property({ attribute: false }) sampleId = "";

  @state() private phase: Phase = "edit";
  @state() private cards: SynthRoleCard[] = [
    audioSynth.roles.createRoleCard("pivot", { quantity: 8 }),
  ];
  @state() private referent: Sample | null = null;
  @state() private fromLibrary = false;
  @state() private busy = false;
  @state() private progress = "";
  @state() private drafts: DraftItem[] = [];
  @state() private statusMsg = "";
  @state() private addRole: SynthRoleId = "bass";
  @state() private intention: SongIntention = "full";
  @state() private tonicPc = 0;
  @state() private scaleMode: ScaleMode = "major";
  @state() private bpm = 120;

  @subscribe(synthFormKey.mode)
  @state()
  mode: SynthMode = "variations";

  @subscribe(synthFormKey.globalQty)
  @state()
  globalQtyStr = "6";

  @subscribe(synthFormKey.openCardId)
  @state()
  openCardId = "";

  @subscribe(synthFormKey.coherence)
  @state()
  coherence: CoherenceKind = "musical";

  @subscribe(synthFormKey.freeFmRatios)
  @state()
  freeFmRatiosFlag: "1" | null = null;

  @subscribe(synthRoleFormKey.engineUi)
  @state()
  roleEngineUi: "1" | null = null;

  @subscribe(synthRoleFormKey.quantity)
  @state()
  roleQtyStr = "8";

  @subscribe(synthRoleFormKey.randomness)
  @state()
  roleRandStr = "35";

  @subscribe(synthValidateFormKey.selected)
  @state()
  validateSelected: string[] = [];

  #playCtx: AudioContext | null = null;
  #playSrc: AudioBufferSourceNode | null = null;
  #booting = false;
  #bootGen = 0;
  #persistQueued = false;
  #projectId = "";
  #roleFormSync = false;
  #onProjectChange = (): void => {
    this.#flushPersist();
    void this.#boot();
  };

  get globalQty(): number {
    return Math.max(1, Number(this.globalQtyStr) || 1);
  }

  get freeFmRatios(): boolean {
    return this.freeFmRatiosFlag === "1";
  }

  @handle(synthFormKey.mode)
  onMode(mode: SynthMode): void {
    if (this.#booting || !mode) return;
    if (this.fromLibrary && mode !== "variations") {
      this.statusMsg = t("synth.familyNoReferent");
      set(synthFormKey.mode, "variations");
      return;
    }
    this.#applyMode(mode);
  }

  @handle(synthFormKey.globalQty)
  onGlobalQty(raw: string): void {
    if (this.#booting) return;
    const q = Math.max(1, Math.min(40, Number(raw) || 1));
    this.cards = this.cards.map((c) => ({ ...c, quantity: q }));
    this.#pushRoleForm();
  }

  @handle(synthFormKey.openCardId)
  onOpenCard(_id: string): void {
    if (this.#booting) return;
    this.#pushRoleForm();
  }

  @handle(synthFormKey.coherence)
  onCoherence(_c: CoherenceKind): void {
    if (this.#booting) return;
    this.#queuePersist();
  }

  @handle(synthFormKey.freeFmRatios)
  onFreeFm(_v: "1" | null): void {
    if (this.#booting) return;
    this.#queuePersist();
  }

  @handle(synthRoleFormKey.engines)
  onRoleEngines(engines: string[]): void {
    if (this.#roleFormSync || this.#booting) return;
    const id = this.openCardId;
    if (!id) return;
    const next = (engines ?? []).filter((e) => LIVE.has(e)) as SynthEngineId[];
    if (next.length === 0) {
      const cur = this.cards.find((c) => c.id === id);
      if (cur?.engines.length) {
        this.#roleFormSync = true;
        set(synthRoleFormKey.engines, [...cur.engines]);
        queueMicrotask(() => {
          this.#roleFormSync = false;
        });
      }
      return;
    }
    this.#patchCard(id, { engines: next });
  }

  @handle(synthRoleFormKey.engineUi)
  onRoleEngineUi(v: "1" | null): void {
    if (this.#roleFormSync || this.#booting) return;
    const id = this.openCardId;
    if (!id) return;
    this.#patchCard(id, { engineUi: v === "1" });
  }

  @handle(synthRoleFormKey.quantity)
  onRoleQty(raw: string): void {
    if (this.#roleFormSync || this.#booting) return;
    const id = this.openCardId;
    if (!id) return;
    const q = Math.max(1, Math.min(40, Number(raw) || 1));
    this.#patchCard(id, { quantity: q });
  }

  @handle(synthRoleFormKey.randomness)
  onRoleRand(raw: string): void {
    if (this.#roleFormSync || this.#booting) return;
    const id = this.openCardId;
    if (!id) return;
    this.#applyRandomness(id, (Number(raw) || 0) / 100);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    void this.#boot();
  }

  override disconnectedCallback(): void {
    window.removeEventListener(PROJECT_CHANGE_EVENT, this.#onProjectChange);
    this.#flushPersist();
    this.#stopPlay();
    void this.#playCtx?.close();
    this.#playCtx = null;
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("sampleId")) void this.#boot();
    if (this.#booting) return;
    const persistKeys = [
      "mode",
      "globalQtyStr",
      "cards",
      "openCardId",
      "addRole",
      "intention",
      "coherence",
      "tonicPc",
      "scaleMode",
      "bpm",
      "freeFmRatiosFlag",
    ] as const;
    if (persistKeys.some((k) => changed.has(k))) this.#queuePersist();
  }

  #snapshotUi(): SynthUiSnapshot {
    return {
      mode: this.mode,
      globalQty: this.globalQty,
      cards: this.cards,
      openCardId: this.openCardId,
      addRole: this.addRole,
      intention: this.intention,
      coherence: this.coherence,
      tonicPc: this.tonicPc,
      scaleMode: this.scaleMode,
      bpm: this.bpm,
      freeFmRatios: this.freeFmRatios,
    };
  }

  #applySnapshot(s: SynthUiSnapshot): void {
    this.cards = s.cards;
    this.addRole = s.addRole;
    this.intention = s.intention;
    this.tonicPc = s.tonicPc;
    this.scaleMode = s.scaleMode;
    this.bpm = s.bpm;
    this.#pushSynthForm({
      mode: s.mode,
      globalQty: String(s.globalQty),
      openCardId: s.openCardId,
      coherence: s.coherence,
      freeFmRatios: s.freeFmRatios ? "1" : null,
    });
  }

  #pushSynthForm(partial?: Partial<SynthForm>): void {
    set(synthFormKey, {
      mode: this.mode,
      freeFmRatios: this.freeFmRatiosFlag,
      coherence: this.coherence,
      globalQty: this.globalQtyStr,
      openCardId: this.openCardId,
      ...partial,
    });
  }

  #pushRoleForm(card?: SynthRoleCard | null): void {
    const c =
      card ?? this.cards.find((x) => x.id === this.openCardId) ?? null;
    if (!c) return;
    this.#roleFormSync = true;
    const payload: SynthRoleForm = {
      engines: [...c.engines],
      engineUi: c.engineUi ? "1" : null,
      quantity: String(c.quantity),
      randomness: String(Math.round(c.randomness * 100)),
    };
    set(synthRoleFormKey, payload);
    queueMicrotask(() => {
      this.#roleFormSync = false;
    });
  }

  #queuePersist(): void {
    if (this.#persistQueued || !this.#projectId || this.#booting) return;
    this.#persistQueued = true;
    queueMicrotask(() => {
      this.#persistQueued = false;
      this.#flushPersist();
    });
  }

  #flushPersist(): void {
    if (!this.#projectId || this.#booting) return;
    const prev = synthUiState.load(this.#projectId) ?? {};
    const snap = this.#snapshotUi();
    const sampleId = this.sampleId?.trim();
    if (sampleId && this.fromLibrary) {
      synthUiState.save(this.#projectId, {
        ...prev,
        referent: { ...snap, sampleId },
      });
    } else if (!sampleId) {
      synthUiState.save(this.#projectId, {
        ...prev,
        blank: snap,
      });
    }
  }

  async #boot(): Promise<void> {
    const gen = ++this.#bootGen;
    this.#booting = true;
    this.phase = "edit";
    this.drafts = [];
    this.statusMsg = "";

    try {
      this.#projectId = (await projectWorkspace.currentId()) ?? "";
      if (gen !== this.#bootGen) return;
      const saved = this.#projectId
        ? synthUiState.load(this.#projectId)
        : null;

      const handoff = takeSynthHandoff();
      if (handoff && !this.sampleId?.trim()) {
        this.fromLibrary = false;
        this.referent = null;
        this.bpm = handoff.bpm ?? 120;
        this.tonicPc = handoff.tonicPc ?? 0;
        this.scaleMode =
          handoff.scaleMode === "minor" || handoff.scaleMode === "major"
            ? handoff.scaleMode
            : "major";
        this.intention = (handoff.intention as SongIntention) || "full";
        if (!audioSynth.songIntentions.includes(this.intention)) {
          this.intention = "full";
        }
        this.cards = audioSynth.song.proposeSongCards(this.intention);
        this.#pushSynthForm({
          mode: "song",
          coherence: "musical",
          freeFmRatios: null,
          openCardId: this.cards[0]?.id ?? "",
          globalQty: String(this.cards[0]?.quantity ?? 4),
        });
        this.#pushRoleForm(this.cards[0]);
        return;
      }

      const id = this.sampleId?.trim();
      if (!id) {
        this.fromLibrary = false;
        this.referent = null;
        if (saved?.blank) {
          this.#applySnapshot(saved.blank);
          this.#pushRoleForm();
          return;
        }
        this.cards = [
          audioSynth.roles.createRoleCard("pivot", { quantity: 8 }),
        ];
        this.#pushSynthForm({
          mode: "variations",
          coherence: "musical",
          freeFmRatios: null,
          openCardId: this.cards[0]?.id ?? "",
          globalQty: "8",
        });
        this.#pushRoleForm(this.cards[0]);
        return;
      }

      const sample = await db.samples.get(id);
      if (gen !== this.#bootGen) return;
      if (!sample || sample.deletedAt) {
        this.fromLibrary = false;
        this.referent = null;
        return;
      }

      this.fromLibrary = true;
      this.referent = sample;

      if (saved?.referent?.sampleId === id) {
        this.#applySnapshot(saved.referent);
        this.#pushRoleForm();
        return;
      }

      await this.#bootLibraryCard(sample, id);
    } finally {
      if (gen !== this.#bootGen) return;
      this.#booting = false;
      this.#queuePersist();
    }
  }

  async #bootLibraryCard(
    sample: Sample,
    id: string,
  ): Promise<void> {
    const analysis = await db.analyses.get(id);
    // Keep pitch class of the referent (metadata + free-FM musical helpers).
    this.tonicPc =
      analysis?.pitchHz && analysis.pitchHz > 20 && analysis.pitchHz < 4000
        ? audioSynth.coherence.hzToPitchClass(analysis.pitchHz)
        : 0;
    const card = audioSynth.roles.createRoleCard("pivot", { quantity: 8 });
    // Library referent: editable min/max ranges around analysis (not pivot UI).
    card.usePivot = false;
    card.pivot = audioSynth.anchorFromAnalysis({
      durationMs: sample.durationMs,
      pitchHz: analysis?.pitchHz,
      centroidHz: analysis?.centroidHz,
      transientDensity: analysis?.transientDensity,
      harmonicity: analysis?.harmonicity,
    });
    card.pivotFm = {
      ...audioSynth.defaultsFm,
      carrier: card.pivot.fund,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    card.pivotNoise = {
      ...audioSynth.defaultsNoise,
      lp: card.pivot.cutoff,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    card.pivotAdditive = {
      ...audioSynth.defaultsAdditive,
      fund: card.pivot.fund,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    card.pivotPhysical = {
      ...audioSynth.defaultsPhysical,
      length: card.pivot.fund,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    card.pivotVoice = {
      ...audioSynth.defaultsVoice,
      fund: card.pivot.fund,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    card.pivotGranular = {
      ...audioSynth.defaultsGranular,
      duration: card.pivot.duration,
      ampAttack: card.pivot.ampAttack,
      ampDecay: card.pivot.ampDecay,
      ampSustain: card.pivot.ampSustain,
      ampRelease: card.pivot.ampRelease,
    };
    Object.assign(card, this.#rangesAroundPivots(card, card.randomness));
    // Slightly tighter / asymmetric band around the analysis pivot.
    const span = card.randomness * 0.55;
    for (const key of audioSynth.keys) {
      const p = card.pivot[key];
      card.ranges[key] = {
        ...card.ranges[key],
        min: Math.max(0, p - span * 1.15),
        max: Math.min(1, p + span * 0.85),
      };
    }
    this.cards = [card];
    this.#pushSynthForm({
      mode: "variations",
      coherence: this.coherence || "musical",
      freeFmRatios: this.freeFmRatiosFlag,
      openCardId: card.id,
      globalQty: "8",
    });
    this.#pushRoleForm(card);
  }


  /** Rebuild all engine sampling ranges from current pivots. */
  #rangesAroundPivots(
    c: SynthRoleCard,
    randomness: number,
  ): Pick<
    SynthRoleCard,
    | "ranges"
    | "rangesFm"
    | "rangesNoise"
    | "rangesGranular"
    | "rangesAdditive"
    | "rangesPhysical"
    | "rangesVoice"
  > {
    return {
      ranges: audioSynth.sample.defaultRangesAround(c.pivot, randomness),
      rangesFm: audioSynth.sample.defaultFmRangesAround(c.pivotFm, randomness),
      rangesNoise: audioSynth.sample.defaultNoiseRangesAround(
        c.pivotNoise,
        randomness,
      ),
      rangesGranular: audioSynth.sample.defaultGranularRangesAround(
        c.pivotGranular,
        randomness,
      ),
      rangesAdditive: audioSynth.sample.defaultAdditiveRangesAround(
        c.pivotAdditive,
        randomness,
      ),
      rangesPhysical: audioSynth.sample.defaultPhysicalRangesAround(
        c.pivotPhysical,
        randomness,
      ),
      rangesVoice: audioSynth.sample.defaultVoiceRangesAround(
        c.pivotVoice,
        randomness,
      ),
    };
  }



  #applyMode(mode: SynthMode): void {
    this.statusMsg = "";
    if (mode === "family") {
      this.cards = audioSynth.roles.defaultFamilyCards(this.globalQty);
    } else if (mode === "song") {
      this.cards = audioSynth.song.proposeSongCards(this.intention);
      set(synthFormKey.globalQty, String(this.cards[0]?.quantity ?? 4));
    } else {
      this.cards = [
        audioSynth.roles.createRoleCard("pivot", { quantity: this.globalQty }),
      ];
    }
    const open = this.cards[0]?.id ?? "";
    set(synthFormKey.openCardId, open);
    this.#pushRoleForm(this.cards[0]);
  }

  #applyIntention(): void {
    this.cards = audioSynth.song.proposeSongCards(this.intention);
    const open = this.cards[0]?.id ?? "";
    set(synthFormKey.openCardId, open);
    this.#pushRoleForm(this.cards[0]);
  }

  #patchCard(id: string, patch: Partial<SynthRoleCard>): void {
    this.cards = this.cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  #updateCard(id: string, fn: (c: SynthRoleCard) => SynthRoleCard): void {
    this.cards = this.cards.map((c) => (c.id === id ? fn(c) : c));
  }

  #addFamilyRole(): void {
    const role = this.addRole;
    if (!audioSynth.roles.isFamilyRoleId(role)) return;
    const card = audioSynth.roles.createRoleCard(role, {
      quantity: this.globalQty,
    });
    this.cards = [...this.cards, card];
    set(synthFormKey.openCardId, card.id);
    this.#pushRoleForm(card);
  }

  #removeCard(id: string): void {
    if (this.cards.length <= 1) return;
    this.cards = this.cards.filter((c) => c.id !== id);
    if (this.openCardId === id) {
      const open = this.cards[0]?.id ?? "";
      set(synthFormKey.openCardId, open);
      this.#pushRoleForm(this.cards[0]);
    }
  }

  #applyRandomness(cardId: string, randomness: number): void {
    this.#updateCard(cardId, (c) => {
      if (
        this.mode === "variations" &&
        (c.usePivot || this.fromLibrary || c.role === "pivot")
      ) {
        return {
          ...c,
          randomness,
          ...this.#rangesAroundPivots(c, randomness),
        };
      }
      if (c.role !== "pivot") {
        return audioSynth.roles.applyCardMachine({ ...c, randomness });
      }
      return { ...c, randomness };
    });
  }

  #onMachineKnob(cardId: string, knob: MachineKnobId, e: Event): void {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    this.#setMachineKnob(cardId, knob, v);
  }

  #setMachineKnob(cardId: string, knob: MachineKnobId, v: number): void {
    this.#updateCard(cardId, (c) =>
      audioSynth.roles.applyCardMachine({
        ...c,
        machine: { ...c.machine, [knob]: Math.max(0, Math.min(1, v)) },
      }),
    );
  }

  #onMachineFilterType(cardId: string, type: MachineFilterType): void {
    this.#setMachineKnob(
      cardId,
      "filtType",
      audioSynth.machines.filterTypeToNorm(type),
    );
  }

  async #ensureCtx(): Promise<AudioContext> {
    if (!this.#playCtx || this.#playCtx.state === "closed") {
      this.#playCtx = new AudioContext();
    }
    if (this.#playCtx.state === "suspended") await this.#playCtx.resume();
    return this.#playCtx;
  }

  #stopPlay(): void {
    try {
      this.#playSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.#playSrc = null;
  }

  async #playPcm(pcm: Float32Array, sampleRate: number): Promise<void> {
    this.#stopPlay();
    const ctx = await this.#ensureCtx();
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    buf.copyToChannel(pcm.slice(), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    this.#playSrc = src;
  }

  async #previewCard(card: SynthRoleCard): Promise<void> {
    this.#stopPlay();
    if (card.role === "arp") {
      const rnd = () => Math.random();
      const rendered = await audioSynth.renderArp({
        fundHz: audioSynth.coherence.tonicHz(this.tonicPc, 4),
        tonicPc: this.tonicPc,
        tonicOctave: 4,
        scaleMode: this.scaleMode,
        pattern: "sequence",
        bpm: this.bpm,
        bars: audioSynth.arp.pickArpBars(rnd),
        form: audioSynth.arp.pickArpForm(rnd),
        motifs: audioSynth.arp.pickArpMotifs(rnd, 4),
        lfos: audioSynth.arp.pickArpLfos(rnd),
        engines: card.engines,
        subtractive: card.pivot,
        fm: card.pivotFm,
        noise: card.pivotNoise,
        additive: card.pivotAdditive,
        physical: card.pivotPhysical,
        voice: card.pivotVoice,
      });
      await this.#playPcm(rendered.pcm, rendered.sampleRate);
      return;
    }
    if (audioSynth.usesRoleSynth(card.role)) {
      const fundHz =
        this.#usesMusicalPitch()
          ? audioSynth.coherence.roleFundTargetHz(
              card.role,
              this.tonicPc,
              this.scaleMode,
            ) ?? undefined
          : undefined;
      const rendered = await audioSynth.renderPreview({
        engines: [],
        role: card.role,
        machine: card.machine,
        fundHz,
      });
      await this.#playPcm(rendered.pcm, rendered.sampleRate);
      return;
    }
    const rendered = await audioSynth.renderPreview({
      engines: card.engines,
      subtractive: card.pivot,
      fm: card.pivotFm,
      noise: card.pivotNoise,
      granular: card.pivotGranular,
      additive: card.pivotAdditive,
      physical: card.pivotPhysical,
      voice: card.pivotVoice,
    });
    await this.#playPcm(rendered.pcm, rendered.sampleRate);
  }

  #totalCount(): number {
    return this.cards.reduce((s, c) => s + Math.max(1, c.quantity), 0);
  }

  #enginesSummary(): string {
    const set = new Set<string>();
    for (const c of this.cards) {
      if (audioSynth.usesRoleSynth(c.role)) {
        set.add(t(ROLE_LABEL[c.role] as "synth.role.kick"));
        continue;
      }
      for (const e of c.engines) {
        set.add(t(ENGINE_LABEL[e] as "synth.engine.subtractive"));
      }
    }
    return [...set].join(" + ") || "—";
  }

  /** Pitch lock active → FM ratio snap unless freeFmRatios is checked. */
  #usesMusicalPitch(): boolean {
    return this.mode !== "song" || this.coherence === "musical";
  }


  async #generate(): Promise<void> {
    if (this.busy) return;
    if (
      this.cards.some(
        (c) =>
          !audioSynth.usesRoleSynth(c.role) &&
          c.role !== "arp" &&
          c.engines.length === 0,
      )
    ) {
      this.statusMsg = t("synth.needEngine");
      return;
    }
    this.busy = true;
    this.progress = t("synth.generating");
    this.statusMsg = "";
    try {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const items = await audioSynth.generateFromRoles({
        cards: this.cards,
        seed,
        mode: this.mode,
        referentId: this.referent?.id,
        yieldEvery: 1,
        intention: this.mode === "song" ? this.intention : undefined,
        coherence: {
          // Blank variations / family: lock pitched engines to tonic.
          // Library referent: parametric so analysis fund/cutoff ranges are audible
          // (musical snap-to-C was wiping the referent pitch).
          // Song keeps the parametric / musical toggle.
          kind: this.fromLibrary
            ? "parametric"
            : this.mode === "song"
              ? this.coherence
              : "musical",
          tonicPc: this.tonicPc,
          bpm: this.bpm,
          scaleMode: this.scaleMode,
          freeFmRatios: this.freeFmRatios,
        },
      });
      this.drafts = items;
      set(synthValidateFormKey, {
        selected: items.map((_, i) => String(i)),
      });
      this.phase = "validate";
      queueMicrotask(() => this.#paintWaves());
    } catch (err) {
      this.statusMsg = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
      this.progress = "";
    }
  }

  #paintWaves(): void {
    const root = this.renderRoot;
    if (!(root instanceof ShadowRoot)) return;
    this.drafts.forEach((d, i) => {
      const canvas = root.querySelector(
        `canvas[data-wave="${i}"]`,
      ) as HTMLCanvasElement | null;
      if (!canvas) return;
      const w = canvas.clientWidth || 280;
      const h = 36;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle =
        getComputedStyle(this).getPropertyValue("--sc-primary").trim() ||
        "#3d7ea6";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(d.pcm.length / w));
      for (let x = 0; x < w; x++) {
        let peak = 0;
        const start = x * step;
        for (let j = 0; j < step && start + j < d.pcm.length; j++) {
          peak = Math.max(peak, Math.abs(d.pcm[start + j] ?? 0));
        }
        const y = h / 2 - peak * (h / 2 - 2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  async #saveSelected(): Promise<void> {
    const sel = new Set(this.validateSelected);
      const selected = this.drafts.filter((_, i) => sel.has(String(i)));
    if (selected.length === 0) return;
    this.busy = true;
    try {
      const projectId = await projectWorkspace.currentId();
      if (!projectId) throw new Error("no_project");
      const n = await saveSynthBatch(
        projectId,
        selected.map((d, i) => {
          const role = d.meta.role && d.meta.role !== "pivot" ? d.meta.role : "";
          return {
            pcm: d.pcm,
            sampleRate: d.sampleRate,
            channelCount: d.channelCount,
            durationMs: d.durationMs,
            name: role ? `${role} ${i + 1}` : `Synth ${i + 1}`,
            meta: d.meta,
          };
        }),
      );
      this.statusMsg = tf("synth.saved", { n: String(n) });
      navigate({ name: "library" });
    } catch (err) {
      this.statusMsg = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }



  #paramRow(
    card: SynthRoleCard,
    key: string,
    pivot: number,
    range: { min: number; max: number },
    labelKey: string,
    usePivotUi: boolean,
    kind: EngineKind,
  ) {
    const label = t(labelKey as "synth.param.fund");
    if (!usePivotUi) {
      return html`
        <div class="form-item-container flex flex-col gap-1">
          <div class="flex justify-between gap-2">
            <span class="form-label mb-0">${label}</span>
            ${this.fromLibrary
              ? html`<span class="text-neutral-500 tabular-nums text-xs"
                  >◉ ${Math.round(pivot * 100)}</span
                >`
              : nothing}
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-0.5">
              <span class="form-description m-0">${t("synth.min")}</span>
              <input
                type="range"
                min="0"
                max="100"
                .value=${String(Math.round(range.min * 100))}
                @input=${(e: Event) =>
                  this.#onRange(card.id, kind, key, "min", e)}
              />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="form-description m-0">${t("synth.max")}</span>
              <input
                type="range"
                min="0"
                max="100"
                .value=${String(Math.round(range.max * 100))}
                @input=${(e: Event) =>
                  this.#onRange(card.id, kind, key, "max", e)}
              />
            </label>
          </div>
        </div>
      `;
    }
    return html`
      <div class="form-item-container flex flex-col gap-1">
        <span class="form-label flex justify-between gap-2 mb-0">
          <span>${label}</span>
          <span class="tabular-nums text-xs font-normal"
            >${Math.round(pivot * 100)}</span
          >
        </span>
        <input
          type="range"
          min="0"
          max="100"
          .value=${String(Math.round(pivot * 100))}
          @input=${(e: Event) => this.#onPivot(card.id, kind, key, e)}
        />
      </div>
    `;
  }

  #onPivot(
    cardId: string,
    kind: EngineKind,
    key: string,
    e: Event,
  ): void {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    this.#updateCard(cardId, (c) => {
      if (kind === "sub") {
        const pivot = { ...c.pivot, [key]: v };
        return {
          ...c,
          pivot,
          ranges: audioSynth.sample.defaultRangesAround(pivot, c.randomness),
        };
      }
      if (kind === "fm") {
        const pivotFm = { ...c.pivotFm, [key]: v };
        return {
          ...c,
          pivotFm,
          rangesFm: audioSynth.sample.defaultFmRangesAround(
            pivotFm,
            c.randomness,
          ),
        };
      }
      if (kind === "noise") {
        const pivotNoise = { ...c.pivotNoise, [key]: v };
        return {
          ...c,
          pivotNoise,
          rangesNoise: audioSynth.sample.defaultNoiseRangesAround(
            pivotNoise,
            c.randomness,
          ),
        };
      }
      if (kind === "granular") {
        const pivotGranular = { ...c.pivotGranular, [key]: v };
        return {
          ...c,
          pivotGranular,
          rangesGranular: audioSynth.sample.defaultGranularRangesAround(
            pivotGranular,
            c.randomness,
          ),
        };
      }
      if (kind === "additive") {
        const pivotAdditive = { ...c.pivotAdditive, [key]: v };
        return {
          ...c,
          pivotAdditive,
          rangesAdditive: audioSynth.sample.defaultAdditiveRangesAround(
            pivotAdditive,
            c.randomness,
          ),
        };
      }
      if (kind === "physical") {
        const pivotPhysical = { ...c.pivotPhysical, [key]: v };
        return {
          ...c,
          pivotPhysical,
          rangesPhysical: audioSynth.sample.defaultPhysicalRangesAround(
            pivotPhysical,
            c.randomness,
          ),
        };
      }
      const pivotVoice = { ...c.pivotVoice, [key]: v };
      return {
        ...c,
        pivotVoice,
        rangesVoice: audioSynth.sample.defaultVoiceRangesAround(
          pivotVoice,
          c.randomness,
        ),
      };
    });
  }

  #onRange(
    cardId: string,
    kind: EngineKind,
    key: string,
    which: "min" | "max",
    e: Event,
  ): void {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    this.#updateCard(cardId, (c) => {
      const bag =
        kind === "sub"
          ? c.ranges
          : kind === "fm"
            ? c.rangesFm
            : kind === "noise"
              ? c.rangesNoise
              : kind === "granular"
                ? c.rangesGranular
                : kind === "additive"
                  ? c.rangesAdditive
                  : kind === "physical"
                    ? c.rangesPhysical
                    : c.rangesVoice;
      const cur = bag[key as keyof typeof bag] as {
        min: number;
        max: number;
        mode: "add" | "mul";
      };
      let min = which === "min" ? v : cur.min;
      let max = which === "max" ? v : cur.max;
      if (min > max) {
        if (which === "min") max = min;
        else min = max;
      }
      const next = { ...bag, [key]: { ...cur, min, max } };
      if (kind === "sub") return { ...c, ranges: next as typeof c.ranges };
      if (kind === "fm") return { ...c, rangesFm: next as typeof c.rangesFm };
      if (kind === "noise")
        return { ...c, rangesNoise: next as typeof c.rangesNoise };
      if (kind === "granular")
        return { ...c, rangesGranular: next as typeof c.rangesGranular };
      if (kind === "additive")
        return { ...c, rangesAdditive: next as typeof c.rangesAdditive };
      if (kind === "physical")
        return { ...c, rangesPhysical: next as typeof c.rangesPhysical };
      return { ...c, rangesVoice: next as typeof c.rangesVoice };
    });
  }


  override render() {
    if (this.phase === "validate") return this.#renderValidate();
    return this.#renderEdit();
  }

  #rangeField(
    label: string,
    value: number,
    min: number,
    max: number,
    onInput: (n: number) => void,
  ) {
    return html`
      <div class="form-item-container flex flex-col gap-1">
        <span class="form-label flex justify-between gap-2 mb-0">
          <span>${label}</span>
          <span class="tabular-nums text-xs font-normal">${value}</span>
        </span>
        <input
          type="range"
          min=${String(min)}
          max=${String(max)}
          .value=${String(value)}
          @input=${(e: Event) =>
            onInput(Number((e.target as HTMLInputElement).value))}
        />
      </div>
    `;
  }

  #checkIcon() {
    return html`${glIcon("check", { slot: "prefix", size: "xs", swap: "on" })}
    ${glIcon("circle", { slot: "prefix", size: "xs", swap: "off" })}`;
  }

  #modePop() {
    const options = this.fromLibrary
      ? [
          {
            value: "variations",
            label: t("synth.modeVariations"),
          },
        ]
      : [
          {
            value: "variations",
            label: t("synth.modeVariations"),
          },
          { value: "family", label: t("synth.modeFamily") },
          { value: "song", label: t("synth.modeSong") },
        ];
    return html`
      <gl-pop-select
        size="sm"
        .value=${this.mode}
        .options=${options}
        ?active=${this.mode !== "variations"}
        @gl-change=${(e: CustomEvent<{ value: string }>) => {
          const mode = e.detail.value as SynthMode;
          if (this.fromLibrary && mode !== "variations") {
            this.statusMsg = t("synth.familyNoReferent");
            return;
          }
          set(synthFormKey.mode, mode);
        }}
      ></gl-pop-select>
    `;
  }

  #freeFmSwitch() {
    if (!this.#usesMusicalPitch()) return nothing;
    return html`
      <sonic-switch unique name="freeFmRatios" value="1">
        ${t("synth.freeFmRatios")}
      </sonic-switch>
    `;
  }

  #renderEdit() {
    const referentLabel = this.referent
      ? this.referent.userName?.trim() || this.referent.name
      : "";
    const open = this.cards.find((c) => c.id === this.openCardId) ?? null;
    const tonicOpts = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ].map((name, i) => ({ value: String(i), label: name }));
    return html`
      <div
        class="box-border mx-auto flex w-full max-w-[90rem] flex-col gap-5"
        formDataProvider=${synthFormKey.path}
      >
        <header class="flex flex-wrap items-end justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <h1 class="font-display m-0 text-2xl lg:text-3xl">
              ${t("synth.title")}
            </h1>
            ${this.fromLibrary && referentLabel
              ? html`<p class="form-description m-0">
                  ${t("synth.referent")}: ${referentLabel}
                </p>`
              : nothing}
          </div>
          ${this.#modePop()}
        </header>

        <div
          class="grid gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:items-start"
        >
          <aside class="flex flex-col gap-4 lg:sticky lg:top-2">
            <sonic-fieldset
              label=${t("synth.setup")}
              description=${t("synth.setupHint")}
            >
              <sonic-form-layout>
                ${this.#rangeField(
                  t("synth.quantity"),
                  this.globalQty,
                  1,
                  40,
                  (n) => set(synthFormKey.globalQty, String(n)),
                )}
                ${this.mode !== "song" && !this.fromLibrary
                  ? this.#freeFmSwitch()
                  : nothing}
                ${this.fromLibrary && referentLabel
                  ? html`<p class="form-description m-0">
                      ${t("synth.referentHint")}
                    </p>`
                  : nothing}
              </sonic-form-layout>

              ${this.mode === "song"
                ? html`
                    <sonic-divider></sonic-divider>
                    <sonic-form-layout>
                      <div class="form-item-container flex flex-col gap-1">
                        <span class="form-label">${t("synth.intention")}</span>
                        <gl-pop-select
                          class="max-w-full w-full"
                          size="sm"
                          .value=${this.intention}
                          .options=${audioSynth.songIntentions.map((id) => ({
                            value: id,
                            label: t(
                              `synth.intention.${id}` as "synth.intention.full",
                            ),
                          }))}
                          @gl-change=${(e: CustomEvent<{ value: string }>) => {
                            this.intention = e.detail.value as SongIntention;
                            this.#applyIntention();
                          }}
                        ></gl-pop-select>
                      </div>

                      <div class="flex flex-col gap-2">
                        <span class="form-label">${t("synth.coherence")}</span>
                        <div class="flex flex-wrap gap-2">
                          <sonic-button
                            unique
                            name="coherence"
                            value="parametric"
                            type="primary"
                            variant="outline"
                            size="sm"
                          >
                            ${this.#checkIcon()}
                            ${t("synth.coherenceParametric")}
                          </sonic-button>
                          <sonic-button
                            unique
                            name="coherence"
                            value="musical"
                            type="primary"
                            variant="outline"
                            size="sm"
                          >
                            ${this.#checkIcon()}
                            ${t("synth.coherenceMusical")}
                          </sonic-button>
                        </div>
                      </div>

                      ${this.#freeFmSwitch()}
                      ${this.coherence === "musical"
                        ? html`
                            <div class="form-item-container flex flex-col gap-1">
                              <span class="form-label">${t("synth.tonic")}</span>
                              <gl-pop-select
                                class="max-w-full w-full"
                                size="sm"
                                .value=${String(this.tonicPc)}
                                .options=${tonicOpts}
                                @gl-change=${(
                                  e: CustomEvent<{ value: string }>,
                                ) => {
                                  this.tonicPc = Number(e.detail.value);
                                }}
                              ></gl-pop-select>
                            </div>
                            <div class="form-item-container flex flex-col gap-1">
                              <span class="form-label">${t("synth.scale")}</span>
                              <gl-pop-select
                                class="max-w-full w-full"
                                size="sm"
                                .value=${this.scaleMode}
                                .options=${[
                                  {
                                    value: "major",
                                    label: t("synth.scaleMajor"),
                                  },
                                  {
                                    value: "minor",
                                    label: t("synth.scaleMinor"),
                                  },
                                ]}
                                @gl-change=${(
                                  e: CustomEvent<{ value: string }>,
                                ) => {
                                  this.scaleMode = e.detail.value as ScaleMode;
                                }}
                              ></gl-pop-select>
                            </div>
                          `
                        : nothing}
                      ${this.#rangeField(
                        t("synth.bpm"),
                        this.bpm,
                        60,
                        180,
                        (n) => {
                          this.bpm = n;
                        },
                      )}
                    </sonic-form-layout>
                  `
                : nothing}
            </sonic-fieldset>
          </aside>

          <div class="min-w-0 flex flex-col gap-4">
            <sonic-fieldset
              label=${t("synth.roles")}
              description=${t("synth.rolesHint")}
            >
              <div class="flex items-center gap-1">
                <gl-pop-select
                  class="min-w-0 w-full flex-1"
                  size="sm"
                  .value=${this.openCardId}
                  .options=${this.cards.map((card) => ({
                    value: card.id,
                    label: `${t(ROLE_LABEL[card.role] as "synth.role.pivot")} · ${card.quantity}`,
                  }))}
                  placeholder=${t("synth.pickRole")}
                  @gl-change=${(e: CustomEvent<{ value: string }>) => {
                    set(synthFormKey.openCardId, e.detail.value);
                  }}
                ></gl-pop-select>
                ${this.mode !== "variations" && this.cards.length > 1
                  ? html`
                      <sonic-button
                        type="default"
                        size="xs"
                        shape="circle"
                        data-aria-label=${t("synth.removeRole")}
                        title=${t("synth.removeRole")}
                        @click=${() => this.#removeCard(this.openCardId)}
                      >
                        ${glIcon("trash-2")}
                      </sonic-button>
                    `
                  : nothing}
              </div>

              ${this.mode === "family" || this.mode === "song"
                ? html`
                    <sonic-divider></sonic-divider>
                    <sonic-form-actions>
                      <gl-pop-select
                        size="sm"
                        .value=${this.addRole}
                        .options=${audioSynth.familyRoles.map((r) => ({
                          value: r,
                          label: t(ROLE_LABEL[r] as "synth.role.kick"),
                        }))}
                        @gl-change=${(e: CustomEvent<{ value: string }>) => {
                          this.addRole = e.detail.value as SynthRoleId;
                        }}
                      ></gl-pop-select>
                      <sonic-button
                        type="default"
                        size="sm"
                        @click=${() => this.#addFamilyRole()}
                      >
                        ${glIcon("plus", { slot: "prefix" })}
                        ${t("synth.addRole")}
                      </sonic-button>
                    </sonic-form-actions>
                  `
                : nothing}
            </sonic-fieldset>

            ${open
              ? this.#renderCardDetail(open)
              : html`<sonic-alert status="info" label=${t("synth.roles")}
                  >${t("synth.pickRole")}</sonic-alert
                >`}
          </div>
        </div>

        <footer
          class="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-col gap-2 border-t border-neutral-200 bg-neutral-0/95 px-4 py-3 backdrop-blur"
        >
          <p class="form-description m-0">
            ${tf("synth.summary", {
              n: String(this.#totalCount()),
              engines: this.#enginesSummary(),
            })}
            ${this.mode === "family"
              ? html` · ${this.cards.length} ${t("synth.rolesCount")}`
              : nothing}
          </p>
          ${this.statusMsg
            ? html`<sonic-alert status="error" label="Erreur"
                >${this.statusMsg}</sonic-alert
              >`
            : nothing}
          <sonic-form-actions>
            <sonic-button
              type="primary"
              size="md"
              ?disabled=${this.busy}
              ?loading=${this.busy}
              @click=${() => void this.#generate()}
            >
              ${this.busy
                ? this.progress || t("synth.generating")
                : t("synth.generate")}
            </sonic-button>
          </sonic-form-actions>
        </footer>
      </div>
    `;
  }

  #engineSection(
    card: SynthRoleCard,
    label: string,
    keys: readonly string[],
    pivots: Record<string, number>,
    ranges: Record<string, { min: number; max: number }>,
    labels: Record<string, string>,
    usePivotUi: boolean,
    kind: EngineKind,
  ) {
    return html`
      <sonic-fieldset variant="ghost" label=${label}>
        <sonic-form-layout>
          ${keys.map((key) =>
            this.#paramRow(
              card,
              key,
              pivots[key]!,
              ranges[key]!,
              labels[key]!,
              usePivotUi,
              kind,
            ),
          )}
        </sonic-form-layout>
      </sonic-fieldset>
    `;
  }

  #renderCardDetail(card: SynthRoleCard) {
    const usePivotUi = card.usePivot && !this.fromLibrary;
    const machineSpec = audioSynth.machines.specFor(card.role);
    const showMachine = Boolean(machineSpec) && card.role !== "pivot";
    const roleOwnsDsp = audioSynth.usesRoleSynth(card.role);
    // Free engines = Variations / pivot / arp only — role cards bake via machine DSP.
    const showEngines =
      !roleOwnsDsp && (!showMachine || this.roleEngineUi === "1");
    return html`
      <div formDataProvider=${synthRoleFormKey.path}>
        <sonic-fieldset
          label=${`${t(ROLE_LABEL[card.role] as "synth.role.pivot")} — ${t("synth.roleEdit")}`}
        >
          <sonic-form-layout>
            ${this.#rangeField(
              t("synth.quantity"),
              Number(this.roleQtyStr) || card.quantity,
              1,
              40,
              (n) => set(synthRoleFormKey.quantity, String(n)),
            )}
            ${this.#rangeField(
              t("synth.randomness"),
              Number(this.roleRandStr) || Math.round(card.randomness * 100),
              0,
              100,
              (n) => set(synthRoleFormKey.randomness, String(n)),
            )}
          </sonic-form-layout>

          ${showMachine && machineSpec
            ? html`
                <sonic-divider></sonic-divider>
                <span class="form-label">${t("synth.machine")}</span>
                <sonic-form-layout>
                  ${machineSpec.knobs
                    .filter((knob) => !audioSynth.machines.isFilterKnob(knob.id))
                    .map((knob) => {
                      const val = card.machine[knob.id] ?? knob.default;
                      return this.#rangeField(
                        t(`synth.machine.${knob.id}` as "synth.machine.body"),
                        Math.round(val * 100),
                        0,
                        100,
                        (n) => {
                          this.#onMachineKnob(card.id, knob.id, {
                            target: { value: String(n) },
                          } as unknown as Event);
                        },
                      );
                    })}
                </sonic-form-layout>
                ${roleOwnsDsp
                  ? html`
                      <sonic-divider></sonic-divider>
                      <span class="form-label">${t("synth.machine.filter")}</span>
                      <div class="mb-3 flex flex-wrap gap-2">
                        ${audioSynth.machines.filterTypes.map((type) => {
                          const current = audioSynth.machines.filterTypeFromNorm(
                            card.machine.filtType ?? 0.1,
                          );
                          const active = current === type;
                          return html`
                            <sonic-button
                              type="primary"
                              variant="outline"
                              size="sm"
                              @click=${() =>
                                this.#onMachineFilterType(card.id, type)}
                            >
                              ${active ? this.#checkIcon() : nothing}
                              ${t(
                                `synth.machine.filter.${type}` as "synth.machine.filter.lowpass",
                              )}
                            </sonic-button>
                          `;
                        })}
                      </div>
                      <sonic-form-layout>
                        ${machineSpec.knobs
                          .filter(
                            (knob) =>
                              audioSynth.machines.isFilterKnob(knob.id) &&
                              knob.id !== "filtType",
                          )
                          .map((knob) => {
                            const val = card.machine[knob.id] ?? knob.default;
                            return this.#rangeField(
                              t(
                                `synth.machine.${knob.id}` as "synth.machine.filtEnv",
                              ),
                              Math.round(val * 100),
                              0,
                              100,
                              (n) =>
                                this.#setMachineKnob(card.id, knob.id, n / 100),
                            );
                          })}
                      </sonic-form-layout>
                    `
                  : nothing}
                ${roleOwnsDsp
                  ? nothing
                  : html`
                      <sonic-switch unique name="engineUi" value="1">
                        ${t("synth.advanced")}
                      </sonic-switch>
                    `}
              `
            : nothing}
          ${showEngines
            ? html`
                <sonic-divider></sonic-divider>
                <span class="form-label">${t("synth.engines")}</span>
                <div class="mb-3 flex flex-wrap gap-2">
                  ${audioSynth.engines.map(
                    (id) => html`
                      <sonic-button
                        name="engines"
                        value=${id}
                        type="primary"
                        variant="outline"
                        size="sm"
                        ?disabled=${!LIVE.has(id)}
                      >
                        ${this.#checkIcon()}
                        ${t(ENGINE_LABEL[id] as "synth.engine.subtractive")}
                      </sonic-button>
                    `,
                  )}
                </div>
                ${card.engines.includes("subtractive")
                  ? this.#engineSection(
                      card,
                      t("synth.section.subtractive"),
                      audioSynth.keys,
                      card.pivot,
                      card.ranges,
                      SUB_LABEL,
                      usePivotUi,
                      "sub",
                    )
                  : nothing}
                ${card.engines.includes("fm")
                  ? this.#engineSection(
                      card,
                      t("synth.section.fm"),
                      audioSynth.keysFm,
                      card.pivotFm,
                      card.rangesFm,
                      FM_LABEL,
                      usePivotUi,
                      "fm",
                    )
                  : nothing}
                ${card.engines.includes("noise")
                  ? this.#engineSection(
                      card,
                      t("synth.section.noise"),
                      audioSynth.keysNoise,
                      card.pivotNoise,
                      card.rangesNoise,
                      NOISE_LABEL,
                      usePivotUi,
                      "noise",
                    )
                  : nothing}
                ${card.engines.includes("granular")
                  ? this.#engineSection(
                      card,
                      t("synth.section.granular"),
                      audioSynth.keysGranular,
                      card.pivotGranular,
                      card.rangesGranular,
                      GRANULAR_LABEL,
                      usePivotUi,
                      "granular",
                    )
                  : nothing}
                ${card.engines.includes("additive")
                  ? this.#engineSection(
                      card,
                      t("synth.section.additive"),
                      audioSynth.keysAdditive,
                      card.pivotAdditive,
                      card.rangesAdditive,
                      ADDITIVE_LABEL,
                      usePivotUi,
                      "additive",
                    )
                  : nothing}
                ${card.engines.includes("physical")
                  ? this.#engineSection(
                      card,
                      t("synth.section.physical"),
                      audioSynth.keysPhysical,
                      card.pivotPhysical,
                      card.rangesPhysical,
                      PHYSICAL_LABEL,
                      usePivotUi,
                      "physical",
                    )
                  : nothing}
                ${card.engines.includes("voice")
                  ? this.#engineSection(
                      card,
                      t("synth.section.voice"),
                      audioSynth.keysVoice,
                      card.pivotVoice,
                      card.rangesVoice,
                      VOICE_LABEL,
                      usePivotUi,
                      "voice",
                    )
                  : nothing}
              `
            : nothing}

          <sonic-form-actions>
            <sonic-button
              type="default"
              size="sm"
              @click=${() => void this.#previewCard(card)}
            >
              ${glIcon("play", { slot: "prefix" })} ${t("synth.preview")}
            </sonic-button>
          </sonic-form-actions>
        </sonic-fieldset>
      </div>
    `;
  }

  #renderValidate() {
    return html`
      <div
        class="box-border mx-auto flex w-full max-w-[90rem] flex-col gap-4"
        formDataProvider=${synthValidateFormKey.path}
      >
        <header class="flex flex-wrap items-center justify-between gap-2">
          <h1 class="font-display m-0 text-2xl">${t("synth.validateTitle")}</h1>
          <sonic-button
            type="default"
            size="sm"
            @click=${() => {
              this.#stopPlay();
              this.phase = "edit";
            }}
          >
            ${t("synth.backEdit")}
          </sonic-button>
        </header>

        <sonic-form-actions>
          <sonic-button
            type="default"
            size="sm"
            @click=${() => {
              set(
                synthValidateFormKey.selected,
                this.drafts.map((_, i) => String(i)),
              );
            }}
            >${t("synth.selectAll")}</sonic-button
          >
          <sonic-button
            type="default"
            size="sm"
            @click=${() => set(synthValidateFormKey.selected, [])}
            >${t("synth.selectNone")}</sonic-button
          >
        </sonic-form-actions>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          ${this.drafts.map(
            (d, i) => html`
              <sonic-fieldset variant="ghost">
                <div class="flex items-start gap-2">
                  <sonic-checkbox name="selected" value=${String(i)} size="sm">
                    #${i + 1}
                    ${d.meta.role && d.meta.role !== "pivot"
                      ? html` · ${d.meta.role}`
                      : nothing}
                    · ${d.durationMs} ms
                    ${d.meta.fundHz != null
                      ? html` · ${Math.round(d.meta.fundHz)} Hz`
                      : nothing}
                    · ${d.meta.roleSynth
                      ? t("synth.roleSynth")
                      : d.meta.engines.join("+")}
                  </sonic-checkbox>
                  <sonic-button
                    type="default"
                    size="xs"
                    shape="circle"
                    @click=${() => void this.#playPcm(d.pcm, d.sampleRate)}
                  >
                    ${glIcon("play")}
                  </sonic-button>
                </div>
                <canvas
                  class="gl-synth-wave mt-2"
                  data-wave=${String(i)}
                ></canvas>
              </sonic-fieldset>
            `,
          )}
        </div>

        ${this.statusMsg
          ? html`<sonic-alert status="error" label="Erreur"
              >${this.statusMsg}</sonic-alert
            >`
          : nothing}

        <sonic-form-actions>
          <sonic-button
            type="primary"
            size="md"
            ?disabled=${this.busy || this.validateSelected.length === 0}
            ?loading=${this.busy}
            @click=${() => void this.#saveSelected()}
          >
            ${t("synth.addToLibrary")}
          </sonic-button>
        </sonic-form-actions>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "gl-synth-page": GlSynthPage;
  }
}

