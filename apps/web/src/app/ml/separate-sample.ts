import {
  DEMUCS_STEMS,
  ML_TAG,
  stemTag,
  type DemucsStemName,
} from "@glane/audio-ml";
import {
  createEntityId,
  nowIso,
  type Sample,
  type SampleClass,
} from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import { normalizePeak } from "@glane/audio-dsp";
import { db } from "../db.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { demucsClient } from "./demucs-client.js";

export const SAMPLE_STEMS_EVENT = "glane:sample-stems";

const STEM_CLASS: Record<DemucsStemName, SampleClass> = {
  drums: "percussive",
  bass: "tonal",
  other: "texture",
  vocals: "voice",
};

export type SeparateSampleProgress = {
  phase: "loading" | "running";
  /** 0–1 while running / downloading */
  ratio: number;
};

/**
 * Split a library sample into 4 Demucs stems (child samples + OPFS PCM).
 */
export async function separateSampleIntoStems(
  sampleId: string,
  opts?: { onProgress?: (p: SeparateSampleProgress) => void },
): Promise<Sample[]> {
  const source = await db.samples.get(sampleId);
  if (!source || source.deletedAt) {
    throw new Error("Sample introuvable");
  }
  if ((source.tags ?? []).includes(ML_TAG.demucsRunning)) {
    throw new Error("Séparation déjà en cours");
  }

  const audio = await loadSampleAudio(source);
  if (!audio || audio.pcm.length === 0) {
    throw new Error("PCM manquant");
  }

  const prevTags = source.tags ?? [];
  await db.samples.update(sampleId, {
    tags: [
      ...prevTags.filter((t) => t !== ML_TAG.demucsRunning),
      ML_TAG.demucsRunning,
    ],
    updatedAt: nowIso(),
  });

  try {
    opts?.onProgress?.({ phase: "loading", ratio: 0 });
    await demucsClient.preload({
      onDownload: (loaded, total) => {
        const ratio = total > 0 ? loaded / total : 0;
        opts?.onProgress?.({ phase: "loading", ratio });
      },
    });
    opts?.onProgress?.({ phase: "running", ratio: 0 });

    const { stems, sampleRate } = await demucsClient.separate(
      audio.pcm,
      audio.sampleRate,
      {
        onProgress: (ratio) =>
          opts?.onProgress?.({ phase: "running", ratio }),
      },
    );

    const created: Sample[] = [];
    const now = nowIso();
    const baseLabel = source.userName ?? source.name;

    for (const name of DEMUCS_STEMS) {
      const id = createEntityId();
      const pcm = normalizePeak(stems[name]);
      await sampleOpfs.savePcm(id, pcm, sampleRate, 1);
      const durationMs = Math.max(
        1,
        Math.round((pcm.length / sampleRate) * 1000),
      );
      const label = `${baseLabel} · ${name}`;
      const child: Sample = {
        ...source,
        id,
        name: label,
        userName: label,
        subclass: name,
        class: STEM_CLASS[name],
        confidence: 0.7,
        tags: [
          ML_TAG.demucs,
          stemTag(name),
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
      created.push(child);
    }

    const fresh = await db.samples.get(sampleId);
    if (fresh) {
      await db.samples.update(sampleId, {
        tags: [
          ...(fresh.tags ?? []).filter(
            (t) => t !== ML_TAG.demucsRunning && t !== ML_TAG.demucs,
          ),
          ML_TAG.demucs,
        ],
        updatedAt: nowIso(),
        revision: (fresh.revision ?? 0) + 1,
      });
    }

    window.dispatchEvent(
      new CustomEvent(SAMPLE_STEMS_EVENT, {
        detail: { sampleId, childIds: created.map((c) => c.id) },
      }),
    );
    return created;
  } catch (e) {
    const fresh = await db.samples.get(sampleId);
    if (fresh) {
      await db.samples.update(sampleId, {
        tags: (fresh.tags ?? []).filter((t) => t !== ML_TAG.demucsRunning),
        updatedAt: nowIso(),
      });
    }
    throw e;
  }
}
