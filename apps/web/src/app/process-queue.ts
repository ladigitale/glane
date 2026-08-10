import { createEntityId, nowIso } from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import type { ProcessWorkerResponse } from "@glane/audio-dsp";
import { db, type ProcessJob } from "./db.js";

export type { ProcessJob, ProcessJobStatus } from "./db.js";

export const SAMPLE_PROCESSED_EVENT = "glane:sample-processed";

export type ProcessQueueSnapshot = {
  pending: number;
  running: number;
  done: number;
  error: number;
  remaining: number;
  /** pending+running+done in DB that are not aged out — for banner. */
  backlog: number;
  currentSampleId: string | null;
};

type Listener = (snap: ProcessQueueSnapshot) => void;

/**
 * Persistent polish queue (Dexie). Survives F5 / navigation.
 * Capture writes raw PCM instantly; polish runs in a worker.
 */
export const processQueue = (() => {
  const listeners = new Set<Listener>();
  let worker: Worker | null = null;
  let pumping = false;
  let started = false;
  let currentSampleId: string | null = null;

  function emit(): void {
    void snapshot().then((s) => {
      for (const l of listeners) l(s);
    });
  }

  function notifyProcessed(sampleId: string): void {
    window.dispatchEvent(
      new CustomEvent(SAMPLE_PROCESSED_EVENT, { detail: { sampleId } }),
    );
  }

  async function snapshot(): Promise<ProcessQueueSnapshot> {
    const rows = await db.processJobs
      .where("status")
      .anyOf(["pending", "running", "done", "error"])
      .toArray();
    let pending = 0;
    let running = 0;
    let done = 0;
    let error = 0;
    for (const j of rows) {
      if (j.status === "pending") pending++;
      else if (j.status === "running") running++;
      else if (j.status === "done") done++;
      else if (j.status === "error") error++;
    }
    return {
      pending,
      running,
      done,
      error,
      remaining: pending + running,
      backlog: pending + running,
      currentSampleId,
    };
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL("./process-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (ev: MessageEvent<ProcessWorkerResponse>) => {
      void onWorkerMessage(ev.data);
    };
    worker.onerror = () => {
      pumping = false;
      currentSampleId = null;
      emit();
      void pump();
    };
    return worker;
  }

  async function onWorkerMessage(msg: ProcessWorkerResponse): Promise<void> {
    const job = await db.processJobs.get(msg.jobId);
    if (!job) {
      pumping = false;
      currentSampleId = null;
      void pump();
      return;
    }

    if (msg.type === "error") {
      await db.processJobs.put({
        ...job,
        status: "error",
        error: msg.message,
        updatedAt: nowIso(),
      });
      pumping = false;
      currentSampleId = null;
      emit();
      void pump();
      return;
    }

    const existing = await sampleOpfs.loadPcm(msg.sampleId);
    const sr = existing?.sampleRate ?? 48_000;
    await sampleOpfs.savePcm(msg.sampleId, msg.pcm, sr, 1);

    const sample = await db.samples.get(msg.sampleId);
    if (sample) {
      const prevTags = (sample.tags ?? []).filter(
        (t) =>
          t !== "processing:pending" &&
          t !== "processing:running" &&
          t !== "processing:done",
      );
      const tags = [
        ...prevTags,
        ...msg.tags.filter((t) => !prevTags.includes(t)),
      ];
      await db.samples.update(msg.sampleId, {
        tags,
        durationMs: msg.durationMs,
        loopProposed: msg.loopProposed,
        loopStartMs: msg.loopStartMs,
        loopEndMs: msg.loopEndMs,
        loopXfadeMs: msg.loopXfadeMs,
        loopScore: msg.loopScore,
        updatedAt: nowIso(),
        revision: (sample.revision ?? 0) + 1,
      });
    }

    await db.processJobs.put({
      ...job,
      status: "done",
      updatedAt: nowIso(),
    });
    pumping = false;
    currentSampleId = null;
    notifyProcessed(msg.sampleId);
    emit();
    void pump();
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    const open = await db.processJobs
      .where("status")
      .anyOf(["pending", "running"])
      .sortBy("createdAt");
    const job =
      open.find((j) => j.status === "pending") ??
      open.find((j) => j.status === "running");
    if (!job) {
      emit();
      return;
    }

    pumping = true;
    currentSampleId = job.sampleId;
    await db.processJobs.put({
      ...job,
      status: "running",
      updatedAt: nowIso(),
    });
    emit();

    const audio = await sampleOpfs.loadPcm(job.sampleId);
    if (!audio || audio.pcm.length === 0) {
      await db.processJobs.put({
        ...job,
        status: "error",
        error: "PCM manquant",
        updatedAt: nowIso(),
      });
      pumping = false;
      currentSampleId = null;
      emit();
      void pump();
      return;
    }

    const sample = await db.samples.get(job.sampleId);
    if (sample) {
      const tags = [
        ...(sample.tags ?? []).filter(
          (t) =>
            t !== "processing:pending" &&
            t !== "processing:done" &&
            t !== "processing:running",
        ),
        "processing:running",
      ];
      await db.samples.update(job.sampleId, {
        tags,
        updatedAt: nowIso(),
      });
    }

    const w = ensureWorker();
    const copy = new Float32Array(audio.pcm);
    w.postMessage(
      {
        type: "process",
        jobId: job.id,
        sampleId: job.sampleId,
        kind: job.kind,
        sampleRate: audio.sampleRate,
        pcm: copy,
      },
      [copy.buffer],
    );
  }

  async function putPendingJob(
    sampleId: string,
    kind: ProcessJob["kind"],
  ): Promise<ProcessJob> {
    const now = nowIso();
    const job: ProcessJob = {
      id: createEntityId(),
      sampleId,
      kind,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await db.processJobs.put(job);
    return job;
  }

  /** Peak-norm only (oneshot kind) for clips polished before texture peak-norm landed. */
  async function repairMissingPeakNorm(): Promise<void> {
    const samples = await db.samples.toArray();
    for (const s of samples) {
      if (s.deletedAt) continue;
      const tags = s.tags ?? [];
      if (!tags.includes("processing:done") || tags.includes("peak-norm")) {
        continue;
      }
      const open = await db.processJobs
        .where("sampleId")
        .equals(s.id)
        .filter((j) => j.status === "pending" || j.status === "running")
        .first();
      if (open) continue;
      await putPendingJob(s.id, "oneshot");
    }
  }

  return {
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      void snapshot().then(fn);
      return () => listeners.delete(fn);
    },

    async start(): Promise<void> {
      if (started) {
        void pump();
        return;
      }
      started = true;
      const stuck = await db.processJobs
        .where("status")
        .equals("running")
        .toArray();
      const now = nowIso();
      for (const j of stuck) {
        await db.processJobs.put({ ...j, status: "pending", updatedAt: now });
      }
      await repairMissingPeakNorm();
      emit();
      void pump();
    },

    async enqueue(
      sampleId: string,
      kind: ProcessJob["kind"],
    ): Promise<ProcessJob> {
      const job = await putPendingJob(sampleId, kind);
      emit();
      if (started) void pump();
      return job;
    },

    snapshot,
  };
})();
