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
  clapFeatureFromAnalysis,
  embedAudioPcm,
  embedTextQuery,
} from "./clap-runtime.js";

export const SAMPLE_CLAP_EVENT = "glane:sample-clap";
export { CLAP_STATUS_EVENT, type ClapStatusDetail } from "./clap-runtime.js";

const pending = new Set<string>();
/** Serialize embeds — avoid parallel model runs / RAM spikes. */
let embedChain: Promise<unknown> = Promise.resolve();

/**
 * T2 CLAP embedding after polish (ADR-0020). Opt-in via prefs.mlClap (default off).
 */
export async function enqueueClapEmbed(
  sampleId: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (pending.has(sampleId)) return;

  const run = async (): Promise<void> => {
    if (pending.has(sampleId)) return;
    pending.add(sampleId);
    try {
      const prefs = await ensurePrefs();
      if (!opts?.force && prefs.mlClap !== true) return;

      const sample = await db.samples.get(sampleId);
      if (!sample || sample.deletedAt) return;
      if (!(sample.tags ?? []).includes("processing:done")) return;

      const existing = await db.analyses.get(sampleId);
      if (
        clapFeatureFromAnalysis(existing?.features as Record<string, unknown>)
      ) {
        return;
      }

      const audio = await sampleOpfs.loadPcm(sampleId);
      if (!audio || audio.pcm.length === 0) return;

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
    } catch {
      /* fail-soft */
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
  await enqueueClapEmbed(sampleId, { force: true });
  const again = await db.analyses.get(sampleId);
  return !!clapFeatureFromAnalysis(again?.features as Record<string, unknown>);
}

export async function rankLibraryByText(
  query: string,
  sampleIds: string[],
  opts?: { minScore?: number; limit?: number },
): Promise<{ id: string; score: number }[]> {
  const q = query.trim();
  if (q.length < 2 || sampleIds.length === 0) return [];

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
  return rankByVector(textVec, items, {
    minScore: opts?.minScore ?? 0.12,
    limit: opts?.limit ?? 50,
  });
}

export async function rankSimilarSamples(
  sampleId: string,
  candidateIds: string[],
  opts?: { minScore?: number; limit?: number },
): Promise<{ id: string; score: number }[]> {
  await ensureClapEmbedding(sampleId);
  const self = await db.analyses.get(sampleId);
  const selfFeat = clapFeatureFromAnalysis(
    self?.features as Record<string, unknown>,
  );
  if (!selfFeat) return [];

  const items: { id: string; vector: number[] }[] = [];
  for (const id of candidateIds) {
    if (id === sampleId) continue;
    const row = await db.analyses.get(id);
    const feat = clapFeatureFromAnalysis(
      row?.features as Record<string, unknown>,
    );
    if (feat) items.push({ id, vector: feat.vector });
  }
  return rankByVector(selfFeat.vector, items, {
    minScore: opts?.minScore ?? 0.2,
    limit: opts?.limit ?? 12,
  });
}
