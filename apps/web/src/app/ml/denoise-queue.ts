import { DENOISED_STEM, ML_TAG, stemTag } from "@glane/audio-ml";
import { db } from "../db.js";
import {
  denoiseSample,
  SAMPLE_DENOISE_EVENT,
  type DenoiseSampleProgress,
} from "./denoise-sample.js";

export { SAMPLE_DENOISE_EVENT };

export const DENOISE_QUEUE_EVENT = "glane:denoise-queue";

export type DenoiseQueueSnapshot = {
  remaining: number;
  waveTotal: number;
  waveDone: number;
  ok: number;
  skipped: number;
  failed: number;
  currentSampleId: string | null;
  phase: "idle" | "loading" | "running";
  ratio: number;
  lastError?: string;
  lastChildIds?: string[];
};

type Listener = (snap: DenoiseQueueSnapshot) => void;

function isDenoisedChild(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(stemTag(DENOISED_STEM));
}

function alreadyDenoised(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.denoise);
}

function isRunning(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.denoiseRunning);
}

/**
 * Serialized RNNoise denoise queue (one job at a time).
 */
export const denoiseQueue = (() => {
  const listeners = new Set<Listener>();
  const pending: string[] = [];
  const pendingSet = new Set<string>();
  let pumping = false;
  let current: string | null = null;
  let waveTotal = 0;
  let waveDone = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let phase: DenoiseQueueSnapshot["phase"] = "idle";
  let ratio = 0;
  let lastError: string | undefined;
  let lastChildIds: string[] | undefined;

  function snapshot(): DenoiseQueueSnapshot {
    return {
      remaining: pending.length + (current ? 1 : 0),
      waveTotal,
      waveDone,
      ok,
      skipped,
      failed,
      currentSampleId: current,
      phase,
      ratio,
      lastError,
      lastChildIds,
    };
  }

  function emit(): void {
    const snap = snapshot();
    for (const l of listeners) l(snap);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DENOISE_QUEUE_EVENT, { detail: snap }),
      );
    }
  }

  function shouldSkip(tags: string[] | undefined): boolean {
    return isDenoisedChild(tags) || isRunning(tags) || alreadyDenoised(tags);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length > 0) {
        const sampleId = pending.shift()!;
        pendingSet.delete(sampleId);
        current = sampleId;
        phase = "loading";
        ratio = 0;
        lastError = undefined;
        lastChildIds = undefined;
        emit();

        const sample = await db.samples.get(sampleId);
        if (!sample || sample.deletedAt || shouldSkip(sample.tags)) {
          skipped++;
          waveDone++;
          current = null;
          phase = pending.length ? "loading" : "idle";
          ratio = 0;
          emit();
          continue;
        }

        try {
          const onProgress = (p: DenoiseSampleProgress) => {
            phase = p.phase;
            ratio = p.ratio;
            emit();
          };
          const child = await denoiseSample(sampleId, { onProgress });
          lastChildIds = [child.id];
          ok++;
        } catch (e) {
          failed++;
          lastError = e instanceof Error ? e.message : String(e);
        }
        waveDone++;
        current = null;
        ratio = 0;
        phase = pending.length ? "loading" : "idle";
        emit();
      }
    } finally {
      pumping = false;
      current = null;
      phase = "idle";
      ratio = 0;
      emit();
    }
  }

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },

    getSnapshot: snapshot,

    enqueue(sampleIds: string | string[]): void {
      const ids = Array.isArray(sampleIds) ? sampleIds : [sampleIds];
      const wasIdle = !pumping && pending.length === 0 && !current;
      if (wasIdle) {
        waveTotal = 0;
        waveDone = 0;
        ok = 0;
        skipped = 0;
        failed = 0;
        lastError = undefined;
        lastChildIds = undefined;
      }

      let added = 0;
      for (const id of ids) {
        if (!id) continue;
        if (pendingSet.has(id) || current === id) continue;
        pendingSet.add(id);
        pending.push(id);
        added++;
      }
      if (added === 0) {
        emit();
        return;
      }
      waveTotal += added;
      emit();
      void pump();
    },

    enqueueAndWait(
      sampleIds: string | string[],
    ): Promise<DenoiseQueueSnapshot> {
      const ids = (Array.isArray(sampleIds) ? sampleIds : [sampleIds]).filter(
        Boolean,
      );
      const targets = new Set(ids);
      this.enqueue(ids);
      return new Promise((resolve) => {
        const check = (s: DenoiseQueueSnapshot): void => {
          for (const id of targets) {
            if (pendingSet.has(id)) return;
            if (current === id) return;
          }
          unsub();
          resolve(s);
        };
        const unsub = this.subscribe(check);
      });
    },
  };
})();

export function enqueueDenoise(sampleIds: string | string[]): void {
  denoiseQueue.enqueue(sampleIds);
}
