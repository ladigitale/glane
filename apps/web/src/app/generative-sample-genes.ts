import { detectOnsetTimesSec } from "@glane/audio-dsp";
import {
  bpmCompatible,
  geneFromOnsetSeconds,
  type RhythmGene,
} from "@glane/composer";
import type { Sample } from "@glane/core-model";
import { loadSampleAudio } from "./load-sample-audio.js";

const MAX_GENES = 6;
const MAX_DECODE = 10;

export type SampleGeneSource = Pick<
  Sample,
  "id" | "durationMs" | "class" | "loopScore"
> & {
  analysisBpm?: number;
};

function candidateRank(s: SampleGeneSource): number {
  let score = 0;
  if (s.class === "rhythmic" || s.class === "percussive") score += 3;
  if ((s.loopScore ?? 0) > 0.55) score += 2;
  if (s.analysisBpm && s.analysisBpm > 0) score += 1;
  const dur = s.durationMs;
  if (dur >= 800 && dur <= 12_000) score += 1;
  return score;
}

/**
 * Decode a few library loops → RhythmGene[] for composer DNA.
 * Skips BPM-incompatible / silent / too-short clips.
 */
export async function collectSampleGenes(opts: {
  samples: readonly SampleGeneSource[];
  projectBpm: number;
  loadAudio?: (
    sample: SampleGeneSource,
  ) => Promise<{
    pcm: Float32Array;
    sampleRate: number;
    channelCount: number;
  } | null>;
}): Promise<RhythmGene[]> {
  const load = opts.loadAudio ?? (async (s) => loadSampleAudio(s as Sample));
  const ranked = [...opts.samples]
    .filter((s) => candidateRank(s) > 0)
    .sort((a, b) => candidateRank(b) - candidateRank(a))
    .slice(0, MAX_DECODE);

  const genes: RhythmGene[] = [];
  for (const s of ranked) {
    if (genes.length >= MAX_GENES) break;
    if (
      s.analysisBpm &&
      s.analysisBpm > 0 &&
      !bpmCompatible(s.analysisBpm, opts.projectBpm)
    ) {
      continue;
    }
    const audio = await load(s);
    if (!audio || audio.pcm.length < 512) continue;
    const onsets = detectOnsetTimesSec(
      audio.pcm,
      audio.sampleRate,
      audio.channelCount,
    );
    if (onsets.length < 2) continue;
    const gene = geneFromOnsetSeconds({
      onsetSec: onsets,
      bpm: opts.projectBpm,
    });
    if (!gene || gene.onsets.length < 2) continue;
    genes.push(gene);
  }
  return genes;
}
