import type { ExprRole, TrackFx } from "@glane/core-model";
import type { MusicStyleId } from "./styles/ids.js";

export type Path = string;
export type Rng = (path: Path) => number;

export type ModeId =
  | "ionian"
  | "aeolian"
  | "dorian"
  | "mixolydian"
  | "phrygian"
  | "lydian"
  | "harmMinor"
  | "pentaMaj"
  | "pentaMin"
  | "blues";

export type SectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "break"
  | "build"
  | "drop"
  | "outro";

export type FormFamily =
  | "verse-chorus"
  | "aaba"
  | "build-drop"
  | "arch"
  | "rondo"
  | "loop-evolve";

export type EnergyShape = "rise" | "arch" | "waves" | "plateau";

export type VoiceRelation = "independent" | "lock" | "respond" | "kinship";

export type RhythmGene = {
  steps: number;
  onsets: number[];
  accents: number[];
};

export type Motif = {
  rhythm: RhythmGene;
  contour: number[];
  lengthBeats: number;
};

export type Progression = {
  id: string;
  slots: Array<{ degree: number; quality: string; durBeats: number }>;
};

export type SignatureFxKind =
  | "dubEcho"
  | "gatedVerb"
  | "chorusWash"
  | "tremoloPulse"
  | "tapeWobble";

export type SongDNA = {
  seed: number;
  style: MusicStyleId;
  keyPc: number;
  mode: ModeId;
  bpm: number;
  meter: [number, number];
  groove: {
    swing: number;
    feel: "straight" | "shuffle" | "half-time";
    humanizeMs: number;
  };
  rhythmGenes: RhythmGene[];
  hook: Motif;
  verseMotif: Motif;
  progressions: { home: Progression; lift: Progression; away: Progression };
  sampleGenes?: RhythmGene[];
  signatureFx?: SignatureFxKind;
  tuningOffsetCents: number;
};

export type Section = {
  id: string;
  kind: SectionKind;
  startBar: number;
  bars: 2 | 4 | 8 | 16;
  phrase: "sentence" | "period" | "loop";
  energy: number;
  occurrence: number;
  region: number;
  transitionIn?: "riser" | "drop-cut" | "fill" | "none";
};

export type ChordSlot = {
  bar: number;
  beat: number;
  durBeats: number;
  degree: number;
  quality: string;
  tonesPc: number[];
  voicingMidi: number[];
  function: "T" | "SD" | "D";
  cadence?: "half" | "authentic" | "plagal" | "deceptive";
};

export type NoteEventTag =
  | "hook"
  | "cadence"
  | "pickup"
  | "fill"
  | "variation"
  | "riser"
  | "ghost";

export type NoteEvent = {
  tick: number;
  durTick: number;
  midi: number | null;
  vel: number;
  accent: boolean;
  tag?: NoteEventTag;
};

export type TrackPart = {
  trackIndex: number;
  role: ExprRole;
  layerTier: number;
  events: NoteEvent[];
  relation?: VoiceRelation;
};

export type ModSource =
  | "energy"
  | "sectionRamp"
  | "phraseRamp"
  | "barInPhrase"
  | "beatStrength"
  | "accent"
  | "velocity"
  | "lfoBars"
  | "holdPerPhrase"
  | "occurrence"
  | "sampleEnvelope";

export type EventParam =
  | "gainDb"
  | "lengthScale"
  | "fadeOutMs"
  | "fadeInMs"
  | "fadeCurve"
  | "offsetMs"
  | "roundRobin"
  | "pitchCents"
  | "pan"
  | "lpHz"
  | "sendA"
  | "sendB"
  | "reverse";

export type ModRoute = {
  source: ModSource;
  dest: EventParam;
  depth: number;
  curve?: "lin" | "exp" | "step";
  roles?: ExprRole[];
  period?: number;
};

export type AutomationTarget =
  | {
      scope: "track";
      trackIndex: number;
      param:
        | "gainDb"
        | "pan"
        | "hpHz"
        | "lpHz"
        | "sendA"
        | "sendB"
        | "fxMix"
        | "fxFeedback"
        | "fxDecay"
        | "fxRateHz"
        | "fxDepth"
        | "attackMs"
        | "decayMs"
        | "sustain"
        | "releaseMs";
    }
  | {
      scope: "bus";
      bus: "A" | "B";
      param: "returnDb" | "decay" | "feedback" | "damping" | "delayBeats";
    }
  | {
      scope: "master";
      param: "gainDb" | "hpHz" | "lpHz" | "fx0Mix" | "fx1Mix" | "width";
    };

export type AutoPoint = {
  tick: number;
  value: number;
  curve: "step" | "lin" | "exp" | "s";
};

export type AutomationLane = {
  target: AutomationTarget;
  points: AutoPoint[];
  gesture?: string;
};

export type GestureKind =
  | "fadeIn"
  | "fadeOut"
  | "build"
  | "drop"
  | "breakdown"
  | "swell"
  | "duck"
  | "dubThrow"
  | "filterSweep"
  | "tapeStop"
  | "stutterOut"
  | "spaceBloom"
  | "dryPunch";

export type Gesture = {
  kind: GestureKind;
  fromTick: number;
  toTick: number;
  tracks: number[] | "all" | "nonKick";
  amount: number;
  path: Path;
};

export type TrackMixPlan = {
  trackIndex: number;
  role: ExprRole;
  levelDb: number;
  pan: number;
  widthRole: "center" | "pairL" | "pairR" | "wide";
  depth: number;
  insert: TrackFx;
  sendA: number;
  sendB: number;
};

export type SpacePlan = {
  A: TrackFx;
  B: TrackFx;
  signature?: {
    kind: SignatureFxKind;
    tracks: number[];
  };
};

export type MasterPlan = {
  preampGainDb: number;
  masterGainDb: number;
  fx: [TrackFx, TrackFx];
  targetLufs: number;
  ceilingDbtp: number;
};

export type Score = {
  dna: SongDNA;
  sections: Section[];
  harmony: ChordSlot[];
  parts: TrackPart[];
  layerMatrix: boolean[][];
  modRoutes: ModRoute[];
  gestures: Gesture[];
  automation: AutomationLane[];
  mix: { tracks: TrackMixPlan[]; spaces: SpacePlan; master: MasterPlan };
  warnings: string[];
};

export type ComposeSettings = {
  seed: number;
  style: MusicStyleId | "auto";
  targetBars: number;
  formFamily: FormFamily | "auto";
  energyShape: EnergyShape | "auto";
  energy: number;
  density: number;
  drumsVsTexture: number;
  variation: number;
  life: number;
  space: number;
  swing: number;
  humanize: number;
  keyPc: number | "auto";
  mode: ModeId | "auto";
  tuningRef: "440" | "library" | "auto";
  targetLufs: number;
  lockPitch?: boolean;
  locks?: Array<{ path: Path; salt: string }>;
};

export type ComposeResult = {
  score: Score;
  resolved: ComposeSettings;
};
