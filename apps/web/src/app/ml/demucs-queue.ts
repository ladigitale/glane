import { ML_TAG } from "@glane/audio-ml";
import { db } from "../db.js";
import {
  SAMPLE_STEMS_EVENT,
  separateSampleIntoStems,
  type SeparateSampleProgress,
} from "./separate-sample.js";

export { SAMPLE_STEMS_EVENT };

export const DEMUCS_QUEUE_EVENT = "glane:demucs-queue";

export type DemucsQueueSnapshot = {
  remaining: number;
  /** Jobs in the current wave (enqueue while idle resets). */
  waveTotal: number;
  /** Finished in wave (ok + skip + fail). */
  waveDone: number;
  ok: number;
  skipped: number;
  failed: number;
  currentSampleId: string | null;
  phase: "idle" | "loading" | "running";
  ratio: number;
  lastError?: string;
};

type Listener = (snap: DemucsQueueSnapshot) => void;

function isStemChild(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => tag.startsWith("stem:"));
}

function alreadySeparated(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.demucs);
}

function isRunning(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.demucsRunning);
}

/**
 * Serialized Demucs stem separation queue (one job at a time — RAM).
 * Fire-and-forget enqueue; UI listens to {@link DEMUCS_QUEUE_EVENT}.
 */
export const demucsQueue = (() => {
  const listeners = new Set<Listener>();
  const pending: string[] = [];
  const pendingSet = new Set<string>();
  let pumping = false;
  let currentSampleId: string | null = null;
  let waveTotal = 0;
  let waveDone = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let phase: DemucsQueueSnapshot["phase"] = "idle";
  let ratio = 0;
  let lastError: string | undefined;

  function snapshot(): DemucsQueueSnapshot {
    return {
      remaining: pending.length + (currentSampleId ? 1 : 0),
      waveTotal,
      waveDone,
      ok,
      skipped,
      failed,
      currentSampleId,
      phase,
      ratio,
      lastError,
    };
  }

  function emit(): void {
    const snap = snapshot();
    for (const l of listeners) l(snap);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DEMUCS_QUEUE_EVENT, { detail: snap }),
      );
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length > 0) {
        const sampleId = pending.shift()!;
        pendingSet.delete(sampleId);
        currentSampleId = sampleId;
        phase = "loading";
        ratio = 0;
        lastError = undefined;
        emit();

        const sample = await db.samples.get(sampleId);
        if (
          !sample ||
          sample.deletedAt ||
          isStemChild(sample.tags) ||
          isRunning(sample.tags) ||
          alreadySeparated(sample.tags)
        ) {
          skipped++;
          waveDone++;
          currentSampleId = null;
          phase = pending.length ? "loading" : "idle";
          ratio = 0;
          emit();
          continue;
        }

        try {
          await separateSampleIntoStems(sampleId, {
            onProgress: (p: SeparateSampleProgress) => {
              phase = p.phase;
              ratio = p.ratio;
              emit();
            },
          });
          ok++;
        } catch (e) {
          failed++;
          lastError = e instanceof Error ? e.message : String(e);
        }
        waveDone++;
        currentSampleId = null;
        ratio = 0;
        phase = pending.length ? "loading" : "idle";
        emit();
      }
    } finally {
      pumping = false;
      currentSampleId = null;
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

    /**
     * Queue one or many samples. Runs sequentially.
     * Skips stem children, already-separated, and in-flight.
     */
    enqueue(sampleIds: string | string[]): void {
      const ids = Array.isArray(sampleIds) ? sampleIds : [sampleIds];
      const wasIdle = !pumping && pending.length === 0 && !currentSampleId;
      if (wasIdle) {
        waveTotal = 0;
        waveDone = 0;
        ok = 0;
        skipped = 0;
        failed = 0;
        lastError = undefined;
      }

      let added = 0;
      for (const id of ids) {
        if (!id || pendingSet.has(id) || id === currentSampleId) continue;
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

    /** Enqueue then resolve when every listed id is no longer pending/running. */
    enqueueAndWait(
      sampleIds: string | string[],
    ): Promise<DemucsQueueSnapshot> {
      const targets = new Set(
        (Array.isArray(sampleIds) ? sampleIds : [sampleIds]).filter(Boolean),
      );
      this.enqueue([...targets]);
      return new Promise((resolve) => {
        const check = (s: DemucsQueueSnapshot): void => {
          for (const id of targets) {
            if (pendingSet.has(id) || id === currentSampleId) return;
          }
          unsub();
          resolve(s);
        };
        const unsub = this.subscribe(check);
      });
    },
  };
})();

export function enqueueDemucsSeparate(sampleIds: string | string[]): void {
  demucsQueue.enqueue(sampleIds);
}
