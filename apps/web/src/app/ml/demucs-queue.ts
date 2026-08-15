import { ML_TAG } from "@glane/audio-ml";
import { db } from "../db.js";
import {
  SAMPLE_STEMS_EVENT,
  removeVocalsFromSample,
  separateSampleIntoStems,
  type SeparateSampleProgress,
} from "./separate-sample.js";

export { SAMPLE_STEMS_EVENT };

export const DEMUCS_QUEUE_EVENT = "glane:demucs-queue";

export type DemucsJobMode = "stems" | "novocals";

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
  currentMode: DemucsJobMode | null;
  phase: "idle" | "loading" | "running";
  ratio: number;
  lastError?: string;
  /** Last successfully created child ids (novocals / stems). */
  lastChildIds?: string[];
};

type DemucsJob = { sampleId: string; mode: DemucsJobMode };

type Listener = (snap: DemucsQueueSnapshot) => void;

function jobKey(j: DemucsJob): string {
  return `${j.mode}:${j.sampleId}`;
}

function isStemChild(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => tag.startsWith("stem:"));
}

function alreadySeparated(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.demucs);
}

function alreadyNoVocals(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.novocals);
}

function isRunning(tags: string[] | undefined): boolean {
  return (tags ?? []).includes(ML_TAG.demucsRunning);
}

/**
 * Serialized Demucs queue (one job at a time — RAM).
 * Fire-and-forget enqueue; UI listens to {@link DEMUCS_QUEUE_EVENT}.
 */
export const demucsQueue = (() => {
  const listeners = new Set<Listener>();
  const pending: DemucsJob[] = [];
  const pendingSet = new Set<string>();
  let pumping = false;
  let current: DemucsJob | null = null;
  let waveTotal = 0;
  let waveDone = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let phase: DemucsQueueSnapshot["phase"] = "idle";
  let ratio = 0;
  let lastError: string | undefined;
  let lastChildIds: string[] | undefined;

  function snapshot(): DemucsQueueSnapshot {
    return {
      remaining: pending.length + (current ? 1 : 0),
      waveTotal,
      waveDone,
      ok,
      skipped,
      failed,
      currentSampleId: current?.sampleId ?? null,
      currentMode: current?.mode ?? null,
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
        new CustomEvent(DEMUCS_QUEUE_EVENT, { detail: snap }),
      );
    }
  }

  function shouldSkip(job: DemucsJob, tags: string[] | undefined): boolean {
    if (isStemChild(tags) || isRunning(tags)) return true;
    if (job.mode === "stems") return alreadySeparated(tags);
    return alreadyNoVocals(tags);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length > 0) {
        const job = pending.shift()!;
        pendingSet.delete(jobKey(job));
        current = job;
        phase = "loading";
        ratio = 0;
        lastError = undefined;
        lastChildIds = undefined;
        emit();

        const sample = await db.samples.get(job.sampleId);
        if (!sample || sample.deletedAt || shouldSkip(job, sample.tags)) {
          skipped++;
          waveDone++;
          current = null;
          phase = pending.length ? "loading" : "idle";
          ratio = 0;
          emit();
          continue;
        }

        try {
          const onProgress = (p: SeparateSampleProgress) => {
            phase = p.phase;
            ratio = p.ratio;
            emit();
          };
          if (job.mode === "novocals") {
            const child = await removeVocalsFromSample(job.sampleId, {
              onProgress,
            });
            lastChildIds = [child.id];
          } else {
            const created = await separateSampleIntoStems(job.sampleId, {
              onProgress,
            });
            lastChildIds = created.map((c) => c.id);
          }
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

    /**
     * Queue one or many samples. Runs sequentially.
     * Skips stem children, already-done for the mode, and in-flight.
     */
    enqueue(
      sampleIds: string | string[],
      opts?: { mode?: DemucsJobMode },
    ): void {
      const mode: DemucsJobMode = opts?.mode ?? "stems";
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
        const job: DemucsJob = { sampleId: id, mode };
        const key = jobKey(job);
        if (pendingSet.has(key) || (current && jobKey(current) === key)) {
          continue;
        }
        pendingSet.add(key);
        pending.push(job);
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

    /** Enqueue then resolve when every listed id+mode is no longer pending/running. */
    enqueueAndWait(
      sampleIds: string | string[],
      opts?: { mode?: DemucsJobMode },
    ): Promise<DemucsQueueSnapshot> {
      const mode: DemucsJobMode = opts?.mode ?? "stems";
      const ids = (Array.isArray(sampleIds) ? sampleIds : [sampleIds]).filter(
        Boolean,
      );
      const targets = new Set(ids.map((id) => jobKey({ sampleId: id, mode })));
      this.enqueue(ids, { mode });
      return new Promise((resolve) => {
        const check = (s: DemucsQueueSnapshot): void => {
          for (const key of targets) {
            if (pendingSet.has(key)) return;
            if (current && jobKey(current) === key) return;
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
  demucsQueue.enqueue(sampleIds, { mode: "stems" });
}

export function enqueueDemucsRemoveVocals(
  sampleIds: string | string[],
): void {
  demucsQueue.enqueue(sampleIds, { mode: "novocals" });
}
