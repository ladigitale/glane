import { createEntityId, nowIso, type SampleAnalysis } from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import {
  characterizePcm,
  hzToNoteName,
  type ClipCharacterization,
  type ProcessWorkerResponse,
} from "@glane/audio-dsp";
import { db, type ProcessJob } from "./db.js";
import {
  cullExcessProcessedSamples,
  pruneSessionByInterest,
} from "./sample-interest-cull.js";
import { enqueueYamnetEnrich } from "./ml/enrich-queue.js";
import { enqueueClapEmbed } from "./ml/clap-queue.js";
import { buildAutoSampleName } from "./sample-auto-name.js";

export type { ProcessJob, ProcessJobStatus } from "./db.js";

export const SAMPLE_PROCESSED_EVENT = "glane:sample-processed";
/** Row-level refresh (processing tags, metadata) — prefer over sonic-queue remount. */
export const SAMPLE_UPDATED_EVENT = "glane:sample-updated";

const PROCESSING_TAGS = [
  "processing:pending",
  "processing:running",
  "processing:done",
  "processing:error",
] as const;

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

export function isProcessingBusy(tags: readonly string[] | undefined): boolean {
  const t = tags ?? [];
  return (
    t.includes("processing:pending") || t.includes("processing:running")
  );
}

export function isProcessingError(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).includes("processing:error");
}

function stripProcessingTags(tags: readonly string[]): string[] {
  return tags.filter(
    (t) => !(PROCESSING_TAGS as readonly string[]).includes(t),
  );
}

/** Authored fund from synth bake — DSP pitch on multi-engine mixes often drifts. */
function authoredSynthFundHz(
  features: SampleAnalysis["features"],
): number | null {
  const synth = features?.synth;
  if (!synth || typeof synth !== "object") return null;
  const fund = (synth as { fundHz?: unknown }).fundHz;
  return typeof fund === "number" && fund > 20 && fund < 5000 ? fund : null;
}

/** Prefer synth-authored fund over DSP re-estimate when present. */
export function resolveSamplePitchHz(
  analysis: Pick<SampleAnalysis, "pitchHz" | "features"> | undefined,
): number | undefined {
  if (!analysis) return undefined;
  const synth = authoredSynthFundHz(analysis.features);
  if (synth != null) return synth;
  return analysis.pitchHz;
}

async function persistCharacterization(
  sampleId: string,
  analysis: ClipCharacterization,
  loopScore?: number,
): Promise<void> {
  const existing = await db.analyses.get(sampleId);
  const row: SampleAnalysis = {
    sampleId,
    lufs: analysis.lufs,
    peakDbtp: analysis.peakDbtp,
    centroidHz: analysis.centroidHz,
    harmonicity: analysis.harmonicity,
    transientDensity: analysis.transientDensity,
    features: existing?.features,
  };
  const synthFund = authoredSynthFundHz(existing?.features);
  if (synthFund != null) {
    row.pitchHz = synthFund;
    row.noteName = hzToNoteName(synthFund);
  } else if (analysis.pitchHz != null) {
    row.pitchHz = analysis.pitchHz;
    if (analysis.noteName) row.noteName = analysis.noteName;
  } else {
    if (existing?.pitchHz != null) row.pitchHz = existing.pitchHz;
    if (existing?.noteName) row.noteName = existing.noteName;
  }
  if (analysis.bpm != null) row.bpm = analysis.bpm;
  const loop = loopScore ?? existing?.loopScore;
  if (loop != null) row.loopScore = loop;
  await db.analyses.put(row);
}

function inferKind(sample: {
  class?: string;
  tags?: string[];
  name?: string;
}): ProcessJob["kind"] {
  if (sample.class === "texture" || sample.class === "noise") return "texture";
  if ((sample.tags ?? []).includes("texture")) return "texture";
  if ((sample.tags ?? []).includes("song-slice")) return "texture";
  if ((sample.tags ?? []).includes("whole") || (sample.tags ?? []).includes("file-whole")) {
    return "texture";
  }
  return "oneshot";
}

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
  /** After polish, re-run YAMNet / CLAP even if tags already exist. */
  const forceMl = new Set<string>();

  function emit(): void {
    void snapshot().then((s) => {
      for (const l of listeners) l(s);
    });
  }

  function notifySampleUpdated(sampleId: string): void {
    window.dispatchEvent(
      new CustomEvent(SAMPLE_UPDATED_EVENT, { detail: { sampleId } }),
    );
  }

  function notifyProcessed(sampleId: string): void {
    notifySampleUpdated(sampleId);
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

  async function setSampleProcessingTag(
    sampleId: string,
    status: "pending" | "running" | "done" | "error",
  ): Promise<void> {
    const sample = await db.samples.get(sampleId);
    if (!sample) return;
    await db.samples.update(sampleId, {
      tags: [...stripProcessingTags(sample.tags ?? []), `processing:${status}`],
      updatedAt: nowIso(),
    });
    notifySampleUpdated(sampleId);
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
      const sid = currentSampleId;
      void (async () => {
        if (sid) {
          const job = await db.processJobs
            .where("sampleId")
            .equals(sid)
            .filter((j) => j.status === "running")
            .first();
          if (job) {
            const { error: _drop, ...rest } = job;
            await db.processJobs.put({
              ...rest,
              status: "error",
              error: "worker crash",
              updatedAt: nowIso(),
            });
            await setSampleProcessingTag(sid, "error");
          }
        }
        pumping = false;
        currentSampleId = null;
        emit();
        void pump();
      })();
    };
    return worker;
  }

  async function failJob(job: ProcessJob, message: string): Promise<void> {
    const { error: _drop, ...rest } = job;
    await db.processJobs.put({
      ...rest,
      status: "error",
      error: message,
      updatedAt: nowIso(),
    });
    await setSampleProcessingTag(job.sampleId, "error");
    pumping = false;
    currentSampleId = null;
    emit();
    void pump();
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
      await failJob(job, msg.message);
      return;
    }

    const existing = await sampleOpfs.loadPcm(msg.sampleId);
    const sr = existing?.sampleRate ?? 48_000;
    const channelCount = existing?.channelCount ?? 1;
    await sampleOpfs.savePcm(msg.sampleId, msg.pcm, sr, channelCount);

    const sample = await db.samples.get(msg.sampleId);
    if (sample) {
      const prevTags = stripProcessingTags(sample.tags ?? []);
      const tags = [
        ...prevTags,
        ...msg.tags.filter((t) => !prevTags.includes(t)),
      ];
      const name = buildAutoSampleName({
        captureName: sample.captureName,
        class: sample.class,
        subclass: sample.subclass,
        noteName: msg.analysis.noteName,
        bpm: msg.analysis.bpm,
        durationMs: msg.durationMs,
        loopProposed: msg.loopProposed,
        tags,
      });
      await db.samples.update(msg.sampleId, {
        tags,
        name,
        durationMs: msg.durationMs,
        loopProposed: msg.loopProposed,
        loopStartMs: msg.loopStartMs,
        loopEndMs: msg.loopEndMs,
        loopXfadeMs: msg.loopXfadeMs,
        loopScore: msg.loopScore,
        interestScore: msg.interestScore,
        updatedAt: nowIso(),
        revision: (sample.revision ?? 0) + 1,
      });
      await persistCharacterization(
        msg.sampleId,
        msg.analysis,
        msg.loopScore,
      );
      void cullExcessProcessedSamples(sample.sessionId)
        .then((r) => {
          if (r.culledIds.length > 0) emit();
        })
        .catch(() => undefined);
      const force = forceMl.delete(msg.sampleId);
      void enqueueYamnetEnrich(msg.sampleId, { force }).catch(() => undefined);
      void enqueueClapEmbed(msg.sampleId, {
        replace: force,
      }).catch(() => undefined);
    } else {
      forceMl.delete(msg.sampleId);
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
      await failJob(job, "PCM manquant");
      return;
    }

    await setSampleProcessingTag(job.sampleId, "running");

    const w = ensureWorker();
    const copy = new Float32Array(audio.pcm);
    w.postMessage(
      {
        type: "process",
        jobId: job.id,
        sampleId: job.sampleId,
        kind: job.kind,
        sampleRate: audio.sampleRate,
        channelCount: audio.channelCount,
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

  /** Align sample tags with jobs stuck in error (e.g. after older builds). */
  async function syncErrorTags(): Promise<void> {
    const errors = await db.processJobs.where("status").equals("error").toArray();
    for (const j of errors) {
      const sample = await db.samples.get(j.sampleId);
      if (!sample || sample.deletedAt) continue;
      const tags = sample.tags ?? [];
      if (tags.includes("processing:done") || tags.includes("processing:error")) {
        continue;
      }
      if (
        tags.includes("processing:pending") ||
        tags.includes("processing:running") ||
        !tags.some((t) => t.startsWith("processing:"))
      ) {
        await setSampleProcessingTag(j.sampleId, "error");
      }
    }
  }

  async function requeueSample(sampleId: string): Promise<boolean> {
    const sample = await db.samples.get(sampleId);
    if (!sample || sample.deletedAt) return false;

    const jobs = await db.processJobs
      .where("sampleId")
      .equals(sampleId)
      .toArray();
    const open = jobs.find(
      (j) => j.status === "pending" || j.status === "running",
    );
    if (open) {
      await setSampleProcessingTag(sampleId, open.status === "running" ? "running" : "pending");
      emit();
      if (started) void pump();
      return true;
    }

    const errorJobs = jobs
      .filter((j) => j.status === "error")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const newest = errorJobs[0];
    const kind = newest?.kind ?? inferKind(sample);

    if (errorJobs.length > 1) {
      await db.processJobs.bulkDelete(errorJobs.slice(1).map((j) => j.id));
    }

    if (newest) {
      const { error: _drop, ...rest } = newest;
      await db.processJobs.put({
        ...rest,
        status: "pending",
        updatedAt: nowIso(),
      });
    } else {
      await putPendingJob(sampleId, kind);
    }

    await setSampleProcessingTag(sampleId, "pending");
    emit();
    if (started) void pump();
    return true;
  }

  async function reanalyzeOne(sampleId: string): Promise<boolean> {
    const sample = await db.samples.get(sampleId);
    if (!sample || sample.deletedAt) return false;

    const tags = sample.tags ?? [];
    const needsPolish =
      isProcessingError(tags) ||
      isProcessingBusy(tags) ||
      !tags.includes("processing:done");
    if (needsPolish) {
      forceMl.add(sampleId);
      return requeueSample(sampleId);
    }

    const audio = await sampleOpfs.loadPcm(sampleId);
    if (!audio || audio.pcm.length === 0) return false;
    await persistCharacterization(
      sampleId,
      characterizePcm(audio.pcm, audio.sampleRate, audio.channelCount),
      sample.loopScore,
    );
    void enqueueYamnetEnrich(sampleId, { force: true }).catch(() => undefined);
    void enqueueClapEmbed(sampleId, { replace: true }).catch(() => undefined);
    notifyProcessed(sampleId);
    emit();
    return true;
  }

  /** Cull over-quota hunt sessions that still have open polish jobs. */
  async function pruneOpenJobsByInterest(): Promise<void> {
    const open = await db.processJobs
      .where("status")
      .anyOf(["pending", "running"])
      .toArray();
    const sessions = new Set<string>();
    for (const j of open) {
      const s = await db.samples.get(j.sampleId);
      if (s && !s.deletedAt) sessions.add(s.sessionId);
    }
    for (const sessionId of sessions) {
      await pruneSessionByInterest(sessionId);
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
      await syncErrorTags();
      await repairMissingPeakNorm();
      // Drop over-quota hunt captures before polishing (incl. pre-score backlog).
      await pruneOpenJobsByInterest();
      emit();
      void pump();
    },

    /** Recompute banner after jobs were removed outside the queue (cull/delete). */
    refresh(): void {
      emit();
    },

    async enqueue(
      sampleId: string,
      kind: ProcessJob["kind"],
    ): Promise<ProcessJob | null> {
      const sample = await db.samples.get(sampleId);
      if (!sample || sample.deletedAt) return null;
      const job = await putPendingJob(sampleId, kind);
      emit();
      if (started) void pump();
      return job;
    },

    /** Re-queue one sample after a polish error or stuck unfinished state. */
    async retrySample(sampleId: string): Promise<boolean> {
      return requeueSample(sampleId);
    },

    /**
     * Full T2 pass: polish if missing/errored, always (re)compute analysis
     * + YAMNet tags (CLAP if enabled). Already-polished audio is not recropped.
     */
    async reanalyzeSample(sampleId: string): Promise<boolean> {
      return reanalyzeOne(sampleId);
    },

    async reanalyzeSamples(sampleIds: readonly string[]): Promise<number> {
      let n = 0;
      for (const id of sampleIds) {
        if (await reanalyzeOne(id)) n++;
        await new Promise((r) => setTimeout(r, 0));
      }
      return n;
    },

    /**
     * Re-queue all polish jobs in error, plus samples tagged unfinished
     * without an open job (pending/running/error).
     */
    async retryUnfinished(): Promise<number> {
      const seen = new Set<string>();
      let n = 0;

      const errors = await db.processJobs
        .where("status")
        .equals("error")
        .toArray();
      for (const j of errors) {
        if (seen.has(j.sampleId)) continue;
        seen.add(j.sampleId);
        if (await requeueSample(j.sampleId)) n++;
      }

      const samples = await db.samples.toArray();
      for (const s of samples) {
        if (s.deletedAt || seen.has(s.id)) continue;
        const tags = s.tags ?? [];
        if (tags.includes("processing:done")) continue;
        const unfinished =
          tags.includes("processing:error") ||
          tags.includes("processing:pending") ||
          tags.includes("processing:running");
        if (!unfinished) continue;
        const open = await db.processJobs
          .where("sampleId")
          .equals(s.id)
          .filter((j) => j.status === "pending" || j.status === "running")
          .first();
        if (open) continue;
        seen.add(s.id);
        if (await requeueSample(s.id)) n++;
      }

      return n;
    },

    snapshot,
  };
})();
