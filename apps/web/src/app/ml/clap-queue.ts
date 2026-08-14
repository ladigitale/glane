import {
  CLAP_FEATURES_KEY,
  ML_TAG,
  rankByVector,
} from "@glane/audio-ml";
import { nowIso } from "@glane/core-model";
import { toMonoPcm } from "@glane/audio-dsp";
import { sampleOpfs } from "@glane/audio-io";
import { db, ensurePrefs } from "../db.js";
import {
  CLAP_STATUS_EVENT,
  clapFeatureFromAnalysis,
  embedAudioPcm,
  embedTextQuery,
  preloadClapAudio,
  type ClapStatusDetail,
} from "./clap-runtime.js";
import { mlOptsFromPrefs } from "./ml-prefs.js";

export const SAMPLE_CLAP_EVENT = "glane:sample-clap";
export { CLAP_STATUS_EVENT, type ClapStatusDetail } from "./clap-runtime.js";

function emitClapStatus(detail: ClapStatusDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLAP_STATUS_EVENT, { detail }));
}

const pending = new Set<string>();
/** Serialize embeds — avoid parallel model runs / RAM spikes. */
let embedChain: Promise<unknown> = Promise.resolve();

/**
 * T2 CLAP embedding after polish (ADR-0020). Opt-in via prefs.mlClap (default off).
 */
export async function enqueueClapEmbed(
  sampleId: string,
  opts?: { force?: boolean; replace?: boolean },
): Promise<void> {
  const run = async (): Promise<void> => {
    pending.add(sampleId);
    try {
      const prefs = await ensurePrefs();
      if (!opts?.force && prefs.mlClap !== true) return;

      const sample = await db.samples.get(sampleId);
      if (!sample || sample.deletedAt) return;
      if (!opts?.force && !(sample.tags ?? []).includes("processing:done")) {
        return;
      }

      const existing = await db.analyses.get(sampleId);
      if (
        !opts?.replace &&
        clapFeatureFromAnalysis(existing?.features as Record<string, unknown>)
      ) {
        return;
      }

      const audio = await sampleOpfs.loadPcm(sampleId);
      if (!audio || audio.pcm.length === 0) {
        if (opts?.force) throw new Error("audio manquant");
        return;
      }

      const feat = await embedAudioPcm(
        toMonoPcm(audio.pcm, audio.channelCount ?? 1),
        audio.sampleRate,
        sampleId,
      );
      const prev = await db.analyses.get(sampleId);
      await db.analyses.put({
        sampleId,
        ...prev,
        features: {
          ...(prev?.features ?? {}),
          [CLAP_FEATURES_KEY]: feat,
        },
      });

      const fresh = await db.samples.get(sampleId);
      if (fresh) {
        const tags = fresh.tags ?? [];
        if (!tags.includes(ML_TAG.clap)) {
          await db.samples.update(sampleId, {
            tags: [...tags, ML_TAG.clap],
            updatedAt: nowIso(),
          });
        }
      }

      window.dispatchEvent(
        new CustomEvent(SAMPLE_CLAP_EVENT, { detail: { sampleId } }),
      );
    } catch (e) {
      if (opts?.force) throw e;
    } finally {
      pending.delete(sampleId);
    }
  };

  const next = embedChain.then(run, run);
  embedChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Ensure embedding exists (for similar-search on demand). */
export async function ensureClapEmbedding(
  sampleId: string,
): Promise<boolean> {
  const existing = await db.analyses.get(sampleId);
  if (clapFeatureFromAnalysis(existing?.features as Record<string, unknown>)) {
    return true;
  }
  try {
    await enqueueClapEmbed(sampleId, { force: true });
  } catch {
    return false;
  }
  const again = await db.analyses.get(sampleId);
  return !!clapFeatureFromAnalysis(again?.features as Record<string, unknown>);
}

/** Index processed samples that still lack a CLAP embedding (after opt-in). */
export async function backfillClapEmbeddings(): Promise<void> {
  const prefs = await ensurePrefs();
  if (prefs.mlClap !== true) return;
  emitClapStatus({ phase: "loading-model", ratio: 0 });
  try {
    await preloadClapAudio();
  } catch (e) {
    emitClapStatus({
      phase: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
  const samples = await db.samples.toArray();
  const ids = samples
    .filter((s) => !s.deletedAt && (s.tags ?? []).includes("processing:done"))
    .map((s) => s.id);
  let i = 0;
  for (const id of ids) {
    i += 1;
    emitClapStatus({
      phase: "embedding",
      ratio: i / Math.max(1, ids.length),
      sampleId: id,
      message: `${i}/${ids.length}`,
    });
    await enqueueClapEmbed(id);
  }
  emitClapStatus({ phase: "idle" });
}

export async function rankLibraryByText(
  query: string,
  sampleIds: string[],
  opts?: { minScore?: number; limit?: number },
): Promise<{ id: string; score: number }[]> {
  const q = query.trim();
  if (q.length < 2 || sampleIds.length === 0) return [];

  const prefs = await ensurePrefs();
  const ml = mlOptsFromPrefs(prefs);
  const minScore = opts?.minScore ?? ml.clapMinScore;
  const limit = opts?.limit ?? Math.max(40, ml.clapLimit);

  const textVec = await embedTextQuery(q);
  const items: { id: string; vector: number[] }[] = [];
  for (const id of sampleIds) {
    const row = await db.analyses.get(id);
    const feat = clapFeatureFromAnalysis(
      row?.features as Record<string, unknown>,
    );
    if (feat) items.push({ id, vector: feat.vector });
  }
  if (items.length === 0) return [];
  return rankByVector(textVec, items, { minScore, limit });
}

export async function rankSimilarSamples(
  sampleId: string,
  candidateIds: string[],
  opts?: { minScore?: number; limit?: number },
): Promise<{ id: string; score: number }[]> {
  const others = candidateIds.filter((id) => id !== sampleId);
  const total = others.length + 1;
  emitClapStatus({
    phase: "embedding",
    ratio: 0,
    sampleId,
    message: `1/${total}`,
  });
  await enqueueClapEmbed(sampleId, { force: true });

  let i = 1;
  for (const id of others) {
    i += 1;
    emitClapStatus({
      phase: "embedding",
      ratio: i / total,
      sampleId: id,
      message: `${i}/${total}`,
    });
    await ensureClapEmbedding(id);
  }

  const self = await db.analyses.get(sampleId);
  const selfFeat = clapFeatureFromAnalysis(
    self?.features as Record<string, unknown>,
  );
  if (!selfFeat) return [];

  const prefs = await ensurePrefs();
  const ml = mlOptsFromPrefs(prefs);
  const minScore = opts?.minScore ?? Math.max(ml.clapMinScore, 0.18);
  const limit = opts?.limit ?? ml.clapLimit;

  const items: { id: string; vector: number[] }[] = [];
  for (const id of others) {
    const row = await db.analyses.get(id);
    const feat = clapFeatureFromAnalysis(
      row?.features as Record<string, unknown>,
    );
    if (feat) items.push({ id, vector: feat.vector });
  }
  emitClapStatus({ phase: "idle" });
  return rankByVector(selfFeat.vector, items, { minScore, limit });
}
