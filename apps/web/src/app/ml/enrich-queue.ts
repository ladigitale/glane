import { sampleOpfs } from "@glane/audio-io";
import { toMonoPcm } from "@glane/audio-dsp";
import {
  enrichWithClassifier,
  ML_TAG,
  stripMlTags,
} from "@glane/audio-ml";
import type { SampleClass } from "@glane/core-model";
import { nowIso } from "@glane/core-model";
import { db, ensurePrefs } from "../db.js";
import { mlOptsFromPrefs } from "./ml-prefs.js";
import { getYamnetClassifier } from "./yamnet-mediapipe.js";

export const SAMPLE_ML_EVENT = "glane:sample-ml";

const pending = new Set<string>();

/**
 * T2 YAMNet enrichment after polish (ADR-0020). Non-blocking; fail-soft.
 */
export async function enqueueYamnetEnrich(sampleId: string): Promise<void> {
  if (pending.has(sampleId)) return;
  pending.add(sampleId);
  try {
    const prefs = await ensurePrefs();
    if (prefs.mlYamnet === false) return;
    const ml = mlOptsFromPrefs(prefs);

    const sample = await db.samples.get(sampleId);
    if (!sample || sample.deletedAt) return;
    const tags = sample.tags ?? [];
    if (tags.includes(ML_TAG.done) || tags.includes(ML_TAG.yamnet)) return;
    if (!tags.includes("processing:done")) return;

    await db.samples.update(sampleId, {
      tags: [...stripMlTags(tags), ML_TAG.running],
      updatedAt: nowIso(),
    });

    const audio = await sampleOpfs.loadPcm(sampleId);
    if (!audio || audio.pcm.length === 0) {
      await markSkipped(sampleId);
      return;
    }

    try {
      const classifier = await getYamnetClassifier();
      const result = await enrichWithClassifier(
        sample.tags ?? [],
        toMonoPcm(audio.pcm, audio.channelCount ?? 1),
        audio.sampleRate,
        classifier,
        { minScore: ml.yamnetMinScore, maxLabels: ml.yamnetMaxLabels },
      );

      const fresh = await db.samples.get(sampleId);
      if (!fresh || fresh.deletedAt) return;

      const patch: {
        tags: string[];
        updatedAt: string;
        revision: number;
        subclass?: string;
        class?: SampleClass;
        confidence?: number;
      } = {
        tags: result.tags.filter(
          (t) =>
            t !== "processing:pending" &&
            t !== "processing:running" &&
            t !== "processing:error",
        ),
        updatedAt: nowIso(),
        revision: (fresh.revision ?? 0) + 1,
      };

      if (result.subclass && !fresh.subclass) {
        patch.subclass = result.subclass;
      }
      if (
        ml.yamnetAutoClass &&
        result.classHint &&
        result.classHintConfidence != null &&
        result.classHintConfidence >= 0.35 &&
        (fresh.class === "unclassified" || (fresh.confidence ?? 0) < 0.45)
      ) {
        patch.class = result.classHint;
        patch.confidence = Math.max(
          fresh.confidence ?? 0,
          result.classHintConfidence,
        );
      }

      await db.samples.update(sampleId, patch);
      await upsertAnalysisLabels(sampleId, result.labels);
      window.dispatchEvent(
        new CustomEvent(SAMPLE_ML_EVENT, { detail: { sampleId } }),
      );
    } catch {
      await markSkipped(sampleId);
    }
  } finally {
    pending.delete(sampleId);
  }
}

async function markSkipped(sampleId: string): Promise<void> {
  const sample = await db.samples.get(sampleId);
  if (!sample) return;
  const tags = [...stripMlTags(sample.tags ?? []), ML_TAG.skipped];
  await db.samples.update(sampleId, {
    tags,
    updatedAt: nowIso(),
  });
}

async function upsertAnalysisLabels(
  sampleId: string,
  labels: ReadonlyArray<{ label: string; score: number }>,
): Promise<void> {
  const existing = await db.analyses.get(sampleId);
  const features = {
    ...(existing?.features ?? {}),
    yamnet: labels.map((l) => ({ label: l.label, score: l.score })),
  };
  await db.analyses.put({
    sampleId,
    ...existing,
    features,
  });
}
