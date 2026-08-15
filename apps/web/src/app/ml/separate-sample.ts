import {
  DEMUCS_INSTRUMENTAL_STEMS,
  INSTRUMENTAL_STEM,
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
import { db, ensurePrefs } from "../db.js";
import { loadSampleAudio } from "../load-sample-audio.js";
import { demucsClient } from "./demucs-client.js";
import { mlOptsFromPrefs } from "./ml-prefs.js";

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

function mixMonoPlanes(planes: Float32Array[]): Float32Array {
  let len = 0;
  for (const p of planes) if (p.length > len) len = p.length;
  const out = new Float32Array(len);
  for (const p of planes) {
    for (let i = 0; i < p.length; i++) out[i]! += p[i]!;
  }
  return out;
}

function emitStemsEvent(sampleId: string, childIds: string[]): void {
  window.dispatchEvent(
    new CustomEvent(SAMPLE_STEMS_EVENT, {
      detail: { sampleId, childIds },
    }),
  );
}

async function markRunning(sampleId: string, prevTags: string[]): Promise<void> {
  await db.samples.update(sampleId, {
    tags: [
      ...prevTags.filter((t) => t !== ML_TAG.demucsRunning),
      ML_TAG.demucsRunning,
    ],
    updatedAt: nowIso(),
  });
}

async function clearRunning(sampleId: string): Promise<void> {
  const fresh = await db.samples.get(sampleId);
  if (!fresh) return;
  await db.samples.update(sampleId, {
    tags: (fresh.tags ?? []).filter((t) => t !== ML_TAG.demucsRunning),
    updatedAt: nowIso(),
  });
}

/**
 * Split a library sample into Demucs stems (child samples + OPFS PCM).
 * Stem subset follows capture prefs (`mlDemucsStems`).
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

  await markRunning(sampleId, source.tags ?? []);

  try {
    const prefs = await ensurePrefs();
    const stemNames = mlOptsFromPrefs(prefs).demucsStems;

    opts?.onProgress?.({ phase: "loading", ratio: 0 });

    const { stems, sampleRate } = await demucsClient.separate(
      audio.pcm,
      audio.sampleRate,
      {
        channelCount: audio.channelCount,
        stems: stemNames,
        onDownload: (loaded, total) => {
          const ratio = total > 0 ? loaded / total : 0;
          opts?.onProgress?.({ phase: "loading", ratio });
        },
        onProgress: (ratio) =>
          opts?.onProgress?.({ phase: "running", ratio }),
      },
    );

    const created: Sample[] = [];
    const now = nowIso();
    const baseLabel = source.userName ?? source.name;

    for (const name of stemNames) {
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

    emitStemsEvent(sampleId, created.map((c) => c.id));
    return created;
  } catch (e) {
    await clearRunning(sampleId);
    throw e;
  }
}

async function findInstrumentalChildren(parentId: string): Promise<Sample[]> {
  const all = await db.samples.toArray();
  return all.filter(
    (s) =>
      !s.deletedAt &&
      s.parentSampleId === parentId &&
      (s.tags ?? []).includes(stemTag(INSTRUMENTAL_STEM)),
  );
}

/** Reuse drums/bass/other children from a prior full separate when present. */
async function tryMixExistingStems(
  parentId: string,
): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
  const all = await db.samples.toArray();
  const children = all.filter(
    (s) => !s.deletedAt && s.parentSampleId === parentId,
  );
  const byStem = new Map<DemucsStemName, Sample>();
  for (const c of children) {
    for (const name of DEMUCS_INSTRUMENTAL_STEMS) {
      if ((c.tags ?? []).includes(stemTag(name))) byStem.set(name, c);
    }
  }
  if (byStem.size < DEMUCS_INSTRUMENTAL_STEMS.length) return null;

  const planes: Float32Array[] = [];
  let sampleRate = 0;
  for (const name of DEMUCS_INSTRUMENTAL_STEMS) {
    const child = byStem.get(name)!;
    const audio = await loadSampleAudio(child);
    if (!audio || audio.pcm.length === 0) return null;
    planes.push(audio.pcm);
    sampleRate = audio.sampleRate;
  }
  return { pcm: mixMonoPlanes(planes), sampleRate };
}

/**
 * Produce one instrumental child (drums+bass+other, no vocals).
 * Reuses existing stem children when available; otherwise runs Demucs
 * on the three non-vocal specialists only.
 */
export async function removeVocalsFromSample(
  sampleId: string,
  opts?: { onProgress?: (p: SeparateSampleProgress) => void },
): Promise<Sample> {
  const source = await db.samples.get(sampleId);
  if (!source || source.deletedAt) {
    throw new Error("Sample introuvable");
  }
  if ((source.tags ?? []).includes(ML_TAG.demucsRunning)) {
    throw new Error("Séparation déjà en cours");
  }
  if ((source.tags ?? []).some((tag) => tag.startsWith("stem:"))) {
    throw new Error("Déjà un stem");
  }
  const existing = await findInstrumentalChildren(sampleId);
  if (existing[0] || (source.tags ?? []).includes(ML_TAG.novocals)) {
    throw new Error("Vocals déjà retirés");
  }

  await markRunning(sampleId, source.tags ?? []);

  try {
    opts?.onProgress?.({ phase: "loading", ratio: 0 });

    let pcm: Float32Array;
    let sampleRate: number;

    const reused = await tryMixExistingStems(sampleId);
    if (reused) {
      pcm = reused.pcm;
      sampleRate = reused.sampleRate;
      opts?.onProgress?.({ phase: "running", ratio: 1 });
    } else {
      const audio = await loadSampleAudio(source);
      if (!audio || audio.pcm.length === 0) {
        throw new Error("PCM manquant");
      }
      const { stems, sampleRate: sr } = await demucsClient.separate(
        audio.pcm,
        audio.sampleRate,
        {
          channelCount: audio.channelCount,
          stems: [...DEMUCS_INSTRUMENTAL_STEMS],
          onDownload: (loaded, total) => {
            const ratio = total > 0 ? loaded / total : 0;
            opts?.onProgress?.({ phase: "loading", ratio });
          },
          onProgress: (ratio) =>
            opts?.onProgress?.({ phase: "running", ratio }),
        },
      );
      sampleRate = sr;
      pcm = mixMonoPlanes(
        DEMUCS_INSTRUMENTAL_STEMS.map((name) => stems[name]),
      );
    }

    pcm = normalizePeak(pcm);
    const id = createEntityId();
    await sampleOpfs.savePcm(id, pcm, sampleRate, 1);
    const now = nowIso();
    const baseLabel = source.userName ?? source.name;
    const label = `${baseLabel} · ${INSTRUMENTAL_STEM}`;
    const durationMs = Math.max(
      1,
      Math.round((pcm.length / sampleRate) * 1000),
    );
    const child: Sample = {
      ...source,
      id,
      name: label,
      userName: label,
      subclass: INSTRUMENTAL_STEM,
      class: "texture",
      confidence: 0.7,
      tags: [
        ML_TAG.demucs,
        stemTag(INSTRUMENTAL_STEM),
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
            (t) =>
              t !== ML_TAG.demucsRunning && t !== ML_TAG.novocals,
          ),
          ML_TAG.novocals,
        ],
        updatedAt: nowIso(),
        revision: (fresh.revision ?? 0) + 1,
      });
    }

    emitStemsEvent(sampleId, [child.id]);
    return child;
  } catch (e) {
    await clearRunning(sampleId);
    throw e;
  }
}
