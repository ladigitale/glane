/**
 * Offline file → EventHunter → library samples (same polish path as live capture).
 */
import {
  createEntityId,
  nowIso,
  type Sample,
  type Session,
} from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import {
  DSP_THRESHOLDS,
  EventHunter,
  type Extraction,
} from "@glane/audio-dsp";
import { db } from "./db.js";
import { processQueue } from "./process-queue.js";
import {
  decodeAudioFileToMono,
  isImportableAudio,
} from "./sample-actions.js";

const FILE_HUNT_NOTES = "glane:file-hunt";
const FILE_TAG = "file";
/** Soft cap — full decode stays in RAM. */
const MAX_DURATION_SEC = 30 * 60;

export type ImportForHuntProgress = {
  phase: "decode" | "hunt" | "done";
  ratio: number;
  extracted: number;
};

export type ImportForHuntResult = {
  sessionId: string;
  extracted: number;
  skippedVoice: number;
  samples: Sample[];
};

export type ImportForHuntOpts = {
  file: File;
  projectId: string;
  /** Display name for session + sample labels. */
  captureName?: string;
  openFloorFactor?: number;
  signal?: AbortSignal;
  onProgress?: (p: ImportForHuntProgress) => void;
  /** Fired after each persisted sample (UI feed). */
  onSample?: (sample: Sample) => void;
};

function stripAudioExt(name: string): string {
  const base = name.replace(/\.(wav|wave|mp3)$/i, "").trim();
  return base || name;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new DOMException("Aborted", "AbortError");
    throw err;
  }
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function persistExtraction(opts: {
  extraction: Extraction;
  session: Session;
  captureName: string;
  excludeVoice: boolean;
}): Promise<Sample | "skipped-voice" | null> {
  const { extraction, session, captureName, excludeVoice } = opts;
  if (extraction.class === "voice" && excludeVoice) return "skipped-voice";

  const id = createEntityId();
  await sampleOpfs.savePcm(
    id,
    extraction.pcm,
    session.sampleRate,
    session.channelCount,
  );

  const durationMs = Math.round(
    (extraction.pcm.length / session.sampleRate) * 1000,
  );
  const tags = [...extraction.tags];
  if (!tags.includes(FILE_TAG)) tags.push(FILE_TAG);

  const sample: Sample = {
    id,
    sessionId: session.id,
    projectId: session.projectId,
    captureName,
    sourceOffsetMs: 0,
    durationMs,
    class: extraction.class,
    tags,
    confidence: extraction.confidence,
    name: `${captureName} · ${extraction.kind} · ${durationMs}ms`,
    favorite: false,
    originVersion: DSP_THRESHOLDS.version,
    loopStartMs: extraction.loopStartMs,
    loopEndMs: extraction.loopEndMs,
    loopXfadeMs: extraction.loopXfadeMs,
    loopScore: extraction.loopScore,
    loopProposed: extraction.loopProposed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 0,
  };
  await db.samples.put(sample);
  void processQueue.enqueue(id, extraction.kind);
  return sample;
}

async function processFile(opts: ImportForHuntOpts): Promise<ImportForHuntResult> {
  const { file, projectId, signal, onProgress, onSample } = opts;
  if (!isImportableAudio(file)) {
    throw new Error("unsupported_format");
  }

  onProgress?.({ phase: "decode", ratio: 0, extracted: 0 });
  throwIfAborted(signal);
  const { pcm, sampleRate } = await decodeAudioFileToMono(file);
  throwIfAborted(signal);

  if (pcm.length === 0) throw new Error("empty_audio");
  const durationSec = pcm.length / sampleRate;
  if (durationSec > MAX_DURATION_SEC) {
    throw new Error("too_long");
  }

  const captureName =
    (opts.captureName ?? "").trim() || stripAudioExt(file.name) || "Fichier";
  const now = nowIso();
  const session: Session = {
    id: createEntityId(),
    projectId,
    startedAt: now,
    endedAt: null,
    durationMs: 0,
    sampleRate,
    channelCount: 1,
    title: captureName,
    notes: FILE_HUNT_NOTES,
    status: "processing",
    gapMarkers: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  await db.sessions.put(session);

  const prefs = await db.prefs.get("default");
  const excludeVoice = !prefs || prefs.voicePolicy === "exclude";
  const hunter = new EventHunter(sampleRate, {
    openFloorFactor: opts.openFloorFactor,
  });

  const hop = DSP_THRESHOLDS.live.envelopeHop;
  const chunk = Math.max(hop * 4, Math.floor(sampleRate * 0.1));
  const samples: Sample[] = [];
  let skippedVoice = 0;
  let offset = 0;
  let sinceYield = 0;

  const handle = async (extraction: Extraction | null): Promise<void> => {
    if (!extraction) return;
    const saved = await persistExtraction({
      extraction,
      session,
      captureName,
      excludeVoice,
    });
    if (saved === "skipped-voice") {
      skippedVoice++;
      return;
    }
    if (saved) {
      samples.push(saved);
      onSample?.(saved);
    }
  };

  try {
    onProgress?.({ phase: "hunt", ratio: 0, extracted: 0 });

    while (offset < pcm.length) {
      throwIfAborted(signal);
      const end = Math.min(pcm.length, offset + chunk);
      const delta = pcm.subarray(offset, end);
      const nowMs = (offset / sampleRate) * 1000;
      const { extraction } = hunter.analyse(delta, nowMs);
      offset = end;
      await handle(extraction);

      sinceYield += chunk;
      if (sinceYield >= chunk * 8) {
        sinceYield = 0;
        onProgress?.({
          phase: "hunt",
          ratio: offset / pcm.length,
          extracted: samples.length,
        });
        await yieldToUi();
      }
    }

    throwIfAborted(signal);
    await handle(hunter.flush());

    const ended = nowIso();
    const durationMs = Math.round(durationSec * 1000);
    await db.sessions.put({
      ...session,
      endedAt: ended,
      durationMs,
      status: "ready",
      updatedAt: ended,
    });

    onProgress?.({ phase: "done", ratio: 1, extracted: samples.length });
    return {
      sessionId: session.id,
      extracted: samples.length,
      skippedVoice,
      samples,
    };
  } catch (err) {
    const ended = nowIso();
    const aborted = err instanceof DOMException && err.name === "AbortError";
    await db.sessions.put({
      ...session,
      endedAt: ended,
      durationMs: Math.round((offset / sampleRate) * 1000),
      status: aborted ? "ready" : "failed",
      updatedAt: ended,
    });
    throw err;
  }
}

export const importForHunt = {
  isImportableAudio,
  maxDurationSec: MAX_DURATION_SEC,
  processFile,
} as const;
