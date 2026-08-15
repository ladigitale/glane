import {
  DENOISED_STEM,
  ML_TAG,
  stemTag,
} from "@glane/audio-ml";
import {
  createEntityId,
  nowIso,
  type Sample,
} from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import { normalizePeak } from "@glane/audio-dsp";
import { db } from "../db.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { denoiseClient } from "./denoise-client.js";

export const SAMPLE_DENOISE_EVENT = "glane:sample-denoise";

export type DenoiseSampleProgress = {
  phase: "loading" | "running";
  ratio: number;
};

function emitDenoiseEvent(sampleId: string, childId: string): void {
  window.dispatchEvent(
    new CustomEvent(SAMPLE_DENOISE_EVENT, {
      detail: { sampleId, childIds: [childId] },
    }),
  );
}

async function markRunning(sampleId: string, prevTags: string[]): Promise<void> {
  await db.samples.update(sampleId, {
    tags: [
      ...prevTags.filter((t) => t !== ML_TAG.denoiseRunning),
      ML_TAG.denoiseRunning,
    ],
    updatedAt: nowIso(),
  });
}

async function clearRunning(sampleId: string): Promise<void> {
  const fresh = await db.samples.get(sampleId);
  if (!fresh) return;
  await db.samples.update(sampleId, {
    tags: (fresh.tags ?? []).filter((t) => t !== ML_TAG.denoiseRunning),
    updatedAt: nowIso(),
  });
}

async function findDenoisedChild(parentId: string): Promise<Sample | undefined> {
  const all = await db.samples.toArray();
  return all.find(
    (s) =>
      !s.deletedAt &&
      s.parentSampleId === parentId &&
      (s.tags ?? []).includes(stemTag(DENOISED_STEM)),
  );
}

/**
 * Produce one RNNoise-denoised child sample (mono, peak-normalized).
 */
export async function denoiseSample(
  sampleId: string,
  opts?: { onProgress?: (p: DenoiseSampleProgress) => void },
): Promise<Sample> {
  const source = await db.samples.get(sampleId);
  if (!source || source.deletedAt) {
    throw new Error("Sample introuvable");
  }
  if ((source.tags ?? []).includes(ML_TAG.denoiseRunning)) {
    throw new Error("Débruitage déjà en cours");
  }
  if ((source.tags ?? []).includes(stemTag(DENOISED_STEM))) {
    throw new Error("Déjà un son débruité");
  }
  const existing = await findDenoisedChild(sampleId);
  if (existing || (source.tags ?? []).includes(ML_TAG.denoise)) {
    throw new Error("Déjà débruité");
  }

  const audio = await loadSampleAudio(source);
  if (!audio || audio.pcm.length === 0) {
    throw new Error("PCM manquant");
  }

  await markRunning(sampleId, source.tags ?? []);

  try {
    opts?.onProgress?.({ phase: "loading", ratio: 0 });
    const { pcm: raw, sampleRate } = await denoiseClient.denoise(
      audio.pcm,
      audio.sampleRate,
      {
        channelCount: audio.channelCount,
        onProgress: (ratio) =>
          opts?.onProgress?.({ phase: "running", ratio }),
      },
    );
    const pcm = normalizePeak(raw);
    const id = createEntityId();
    await sampleOpfs.savePcm(id, pcm, sampleRate, 1);
    const now = nowIso();
    const baseLabel = source.userName ?? source.name;
    const label = `${baseLabel} · ${DENOISED_STEM}`;
    const durationMs = Math.max(
      1,
      Math.round((pcm.length / sampleRate) * 1000),
    );
    const child: Sample = {
      ...source,
      id,
      name: label,
      userName: label,
      subclass: DENOISED_STEM,
      confidence: 0.7,
      tags: [
        ML_TAG.denoise,
        stemTag(DENOISED_STEM),
        "processing:done",
        "peak-norm",
      ],
      parentSampleId: source.id,
      favorite: false,
      sourceOffsetMs: 0,
      durationMs,
      loopProposed: false,
      loopStartMs: undefined,
      loopEndMs: undefined,
      loopXfadeMs: undefined,
      loopScore: undefined,
      interestScore: undefined,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      deletedAt: undefined,
    };
    await db.samples.put(child);

    const fresh = await db.samples.get(sampleId);
    if (fresh) {
      await db.samples.update(sampleId, {
        tags: [
          ...(fresh.tags ?? []).filter(
            (t) => t !== ML_TAG.denoiseRunning && t !== ML_TAG.denoise,
          ),
          ML_TAG.denoise,
        ],
        updatedAt: nowIso(),
        revision: (fresh.revision ?? 0) + 1,
      });
    }

    emitDenoiseEvent(sampleId, child.id);
    return child;
  } catch (e) {
    await clearRunning(sampleId);
    throw e;
  }
}
