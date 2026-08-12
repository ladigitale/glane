export {
  ML_TAG,
  YAMNET_TAG_PREFIX,
  CLAP_TAG_PREFIX,
  STEM_TAG_PREFIX,
  stripMlTags,
  isMlStatusTag,
  isStemTag,
} from "./tags.js";
export type {
  AudioClassifierPort,
  AudioLabelScore,
  EnrichOptions,
  EnrichResult,
} from "./types.js";
export { enrichFromLabels, enrichWithClassifier } from "./enrich.js";
export {
  mapLabelToClass,
  pickClassHint,
  slugifyLabel,
  yamnetTag,
} from "./yamnet/map.js";
export { resampleLinear, centerWindow } from "./resample.js";
export {
  cosineSimilarity,
  CLAP_FEATURES_KEY,
  type ClapEmbeddingFeatures,
} from "./clap/similarity.js";
export { rankByVector, type RankedId } from "./clap/rank.js";
export {
  DEMUCS_SAMPLE_RATE,
  DEMUCS_N_SAMPLES,
  DEMUCS_OVERLAP,
  DEMUCS_STRIDE,
  DEMUCS_STEMS,
  ML_DEMUCS_TAG,
  stemTag,
  makeTransitionWindow,
  monoToStereo,
  stereoToMono,
  type DemucsStemName,
} from "./separate/demucs-math.js";
export {
  separateOverlapAdd,
  type DemucsChunkInfer,
  type SeparateProgress,
  type StemPair,
} from "./separate/overlap-add.js";
