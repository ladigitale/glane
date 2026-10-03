import { buildMotif } from "./melody.js";
import { defaultProgressions } from "./harmony.js";
import { generateRhythmGenes } from "./rhythm.js";
import { chooseRhythmGenes } from "./sample-gene.js";
import type { StyleGeneratorProfile } from "./styles/profiles.js";
import type {
  ComposeSettings,
  ModeId,
  Motif,
  Progression,
  RhythmGene,
  Rng,
  SongDNA,
} from "./types.js";

export type DnaBuild = {
  rhythmGenes: RhythmGene[];
  hook: Motif;
  verseMotif: Motif;
  progressions: {
    home: Progression;
    lift: Progression;
    away: Progression;
  };
  warning?: string;
};

/**
 * Song DNA: rhythm genes, motifs, progressions (addressed RNG under `dna/*`).
 */
export function buildSongDna(opts: {
  rng: Rng;
  mode: ModeId;
  density: number;
  sampleGenes?: readonly RhythmGene[];
  grooveFromSamples?: ComposeSettings["grooveFromSamples"];
}): DnaBuild {
  const progressions = defaultProgressions(opts.rng, "dna/prog", opts.mode);
  const generatedGenes = generateRhythmGenes(
    opts.rng,
    "dna/rhythm",
    opts.density,
  );
  const genePick = chooseRhythmGenes({
    generated: generatedGenes,
    sampleGenes: opts.sampleGenes ?? [],
    mode: opts.grooveFromSamples ?? "auto",
    rng: opts.rng,
    path: "dna/sampleGenes",
  });
  const rhythmGenes = genePick.genes;
  const g0 = rhythmGenes[0] ?? {
    steps: 16,
    onsets: [0, 4, 8, 12],
    accents: [1, 0.4, 0.7, 0.4],
  };
  const g1 = rhythmGenes[1] ?? g0;
  const hook = buildMotif(opts.rng, "dna/hook", g0, "hook");
  const verseMotif = buildMotif(opts.rng, "dna/verse", g1, "verse");
  return {
    rhythmGenes,
    hook,
    verseMotif,
    progressions,
    warning: genePick.warning,
  };
}

/** Assemble Score.dna after mix (signature / groove feel from profile). */
export function assembleSongDna(opts: {
  settings: ComposeSettings;
  style: SongDNA["style"];
  keyPc: number;
  mode: ModeId;
  profile: StyleGeneratorProfile;
  dna: DnaBuild;
  signatureFx?: SongDNA["signatureFx"];
}): SongDNA {
  return {
    seed: opts.settings.seed,
    style: opts.style,
    keyPc: opts.keyPc,
    mode: opts.mode,
    bpm: 120,
    meter: [4, 4],
    groove: {
      swing: opts.settings.swing,
      feel: opts.profile.grooveFeel,
      humanizeMs: opts.settings.humanize * 20,
    },
    rhythmGenes: opts.dna.rhythmGenes,
    hook: opts.dna.hook,
    verseMotif: opts.dna.verseMotif,
    progressions: opts.dna.progressions,
    sampleGenes:
      opts.settings.sampleGenes && opts.settings.sampleGenes.length > 0
        ? [...opts.settings.sampleGenes]
        : undefined,
    signatureFx: opts.signatureFx,
    tuningOffsetCents: 0,
  };
}
