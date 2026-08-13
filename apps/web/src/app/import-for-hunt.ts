/**
 * Offline file → library samples (hunt / song-slice / whole).
 */
import {
  createEntityId,
  nowIso,
  type Sample,
  type SampleClass,
  type Session,
} from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import {
  DSP_THRESHOLDS,
  EventHunter,
  durationMsFromPcm,
  frameCount,
  sliceFrames,
  songSlice,
  toMonoPcm,
  type Extraction,
} from "@glane/audio-dsp";
import {
  DEFAULT_TARGET_CAPTURES_PER_MIN,
  db,
  type FileProcessMode,
} from "./db.js";
import { processQueue } from "./process-queue.js";
import {
  decodeAudioFileToPcm,
  isImportableAudio,
} from "./sample-actions.js";

export const FILE_HUNT_NOTES = "glane:file-hunt";
export const FILE_SONG_NOTES = "glane:file-song";
export const FILE_WHOLE_NOTES = "glane:file-whole";
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
  /** Overrides prefs when set. */
  mode?: FileProcessMode;
  signal?: AbortSignal;
  onProgress?: (p: ImportForHuntProgress) => void;
  /** Fired after each persisted sample (UI feed). */
  onSample?: (sample: Sample) => void;
};

export class ImportTempoError extends Error {
  constructor() {
    super("tempo_undetected");
    this.name = "ImportTempoError";
  }
}

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

function sessionNotesForMode(mode: FileProcessMode): string {
  if (mode === "song") return FILE_SONG_NOTES;
  if (mode === "whole") return FILE_WHOLE_NOTES;
  return FILE_HUNT_NOTES;
}

async function persistSample(opts: {
  pcm: Float32Array;
  session: Session;
  captureName: string;
  class: SampleClass;
  tags: string[];
  confidence: number;
  kind: "oneshot" | "texture";
  sourceOffsetMs: number;
  loopProposed?: boolean;
  loopStartMs?: number;
  loopEndMs?: number;
  loopXfadeMs?: number;
  loopScore?: number;
  nameExtra?: string;
}): Promise<Sample> {
  const id = createEntityId();
  await sampleOpfs.savePcm(
    id,
    opts.pcm,
    opts.session.sampleRate,
    opts.session.channelCount,
  );

  const durationMs = Math.max(
    1,
    durationMsFromPcm(
      opts.pcm,
      opts.session.sampleRate,
      opts.session.channelCount,
    ),
  );
  const tags = [...opts.tags];
  if (!tags.includes(FILE_TAG)) tags.push(FILE_TAG);

  const sample: Sample = {
    id,
    sessionId: opts.session.id,
    projectId: opts.session.projectId,
    captureName: opts.captureName,
    sourceOffsetMs: opts.sourceOffsetMs,
    durationMs,
    class: opts.class,
    tags,
    confidence: opts.confidence,
    name:
      opts.nameExtra ??
      `${opts.captureName} · ${opts.kind} · ${durationMs}ms`,
    favorite: false,
    originVersion: DSP_THRESHOLDS.version,
    loopStartMs: opts.loopStartMs,
    loopEndMs: opts.loopEndMs,
    loopXfadeMs: opts.loopXfadeMs,
    loopScore: opts.loopScore,
    loopProposed: opts.loopProposed,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 0,
  };
  await db.samples.put(sample);
  void processQueue.enqueue(id, opts.kind);
  return sample;
}

async function persistExtraction(opts: {
  extraction: Extraction;
  session: Session;
  captureName: string;
  excludeVoice: boolean;
}): Promise<Sample | "skipped-voice" | null> {
  const { extraction, session, captureName, excludeVoice } = opts;
  if (extraction.class === "voice" && excludeVoice) return "skipped-voice";

  return persistSample({
    pcm: extraction.pcm,
    session,
    captureName,
    class: extraction.class,
    tags: [...extraction.tags],
    confidence: extraction.confidence,
    kind: extraction.kind,
    sourceOffsetMs: 0,
    loopProposed: extraction.loopProposed,
    loopStartMs: extraction.loopStartMs,
    loopEndMs: extraction.loopEndMs,
    loopXfadeMs: extraction.loopXfadeMs,
    loopScore: extraction.loopScore,
  });
}

async function createFileSession(opts: {
  projectId: string;
  captureName: string;
  sampleRate: number;
  channelCount: number;
  mode: FileProcessMode;
}): Promise<Session> {
  const now = nowIso();
  const session: Session = {
    id: createEntityId(),
    projectId: opts.projectId,
    startedAt: now,
    endedAt: null,
    durationMs: 0,
    sampleRate: opts.sampleRate,
    channelCount: opts.channelCount,
    title: opts.captureName,
    notes: sessionNotesForMode(opts.mode),
    status: "processing",
    gapMarkers: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  await db.sessions.put(session);
  return session;
}

async function finishSession(
  session: Session,
  opts: {
    durationMs: number;
    status: Session["status"];
    dominantBpm?: number | null;
  },
): Promise<void> {
  const ended = nowIso();
  await db.sessions.put({
    ...session,
    endedAt: ended,
    durationMs: opts.durationMs,
    status: opts.status,
    dominantBpm: opts.dominantBpm ?? session.dominantBpm,
    updatedAt: ended,
  });
}

async function processHunt(
  opts: ImportForHuntOpts & {
    pcm: Float32Array;
    sampleRate: number;
    session: Session;
    captureName: string;
    excludeVoice: boolean;
  },
): Promise<ImportForHuntResult> {
  const {
    pcm,
    sampleRate,
    session,
    captureName,
    excludeVoice,
    signal,
    onProgress,
    onSample,
  } = opts;

  const hunter = new EventHunter(sampleRate, {
    openFloorFactor: opts.openFloorFactor,
    channelCount: session.channelCount,
  });

  const hop = DSP_THRESHOLDS.live.envelopeHop * session.channelCount;
  const chunk = Math.max(hop * 4, Math.floor(sampleRate * 0.1 * session.channelCount));
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

  onProgress?.({ phase: "hunt", ratio: 0, extracted: 0 });

  while (offset < pcm.length) {
    throwIfAborted(signal);
    const end = Math.min(pcm.length, offset + chunk);
    const delta = pcm.subarray(offset, end);
    const nowMs =
      (offset / (sampleRate * Math.max(1, session.channelCount))) * 1000;
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

  await finishSession(session, {
    durationMs: Math.max(
      1,
      durationMsFromPcm(pcm, sampleRate, session.channelCount),
    ),
    status: "ready",
  });

  onProgress?.({ phase: "done", ratio: 1, extracted: samples.length });
  return {
    sessionId: session.id,
    extracted: samples.length,
    skippedVoice,
    samples,
  };
}

async function processSong(
  opts: ImportForHuntOpts & {
    pcm: Float32Array;
    sampleRate: number;
    session: Session;
    captureName: string;
    targetPerMin: number;
  },
): Promise<ImportForHuntResult> {
  const {
    pcm,
    sampleRate,
    session,
    captureName,
    targetPerMin,
    signal,
    onProgress,
    onSample,
  } = opts;

  onProgress?.({ phase: "hunt", ratio: 0, extracted: 0 });
  throwIfAborted(signal);

  const ch = session.channelCount;
  const mono = toMonoPcm(pcm, ch);
  const sliced = songSlice.sliceSong(mono, sampleRate, { targetPerMin });
  if (!sliced) throw new ImportTempoError();

  const samples: Sample[] = [];
  const bpmTag = `bpm:${Math.round(sliced.bpm)}`;
  const gridTag = `grid:${sliced.beatsPerSlice}`;

  for (let i = 0; i < sliced.slices.length; i++) {
    throwIfAborted(signal);
    const slice = sliced.slices[i]!;
    const slicePcm = sliceFrames(pcm, ch, slice.start, slice.end);
    const durationMs = Math.max(
      1,
      durationMsFromPcm(slicePcm, sampleRate, ch),
    );
    const sourceOffsetMs = Math.round((slice.start / sampleRate) * 1000);
    const saved = await persistSample({
      pcm: slicePcm,
      session,
      captureName,
      class: "rhythmic",
      tags: ["song-slice", bpmTag, gridTag],
      confidence: 0.85,
      kind: "texture",
      sourceOffsetMs,
      loopProposed: true,
      loopStartMs: 0,
      loopEndMs: durationMs,
      loopXfadeMs: 40,
      loopScore: 0.7,
      nameExtra: `${captureName} · slice ${i + 1}/${sliced.slices.length} · ${durationMs}ms`,
    });
    samples.push(saved);
    onSample?.(saved);
    if (i % 4 === 3) {
      onProgress?.({
        phase: "hunt",
        ratio: (i + 1) / sliced.slices.length,
        extracted: samples.length,
      });
      await yieldToUi();
    }
  }

  await finishSession(session, {
    durationMs: Math.max(1, durationMsFromPcm(pcm, sampleRate, ch)),
    status: "ready",
    dominantBpm: sliced.bpm,
  });

  onProgress?.({ phase: "done", ratio: 1, extracted: samples.length });
  return {
    sessionId: session.id,
    extracted: samples.length,
    skippedVoice: 0,
    samples,
  };
}

async function processWhole(
  opts: ImportForHuntOpts & {
    pcm: Float32Array;
    sampleRate: number;
    session: Session;
    captureName: string;
  },
): Promise<ImportForHuntResult> {
  const { pcm, sampleRate, session, captureName, signal, onProgress, onSample } =
    opts;

  onProgress?.({ phase: "hunt", ratio: 0.2, extracted: 0 });
  throwIfAborted(signal);

  const ch = session.channelCount;
  const mono = toMonoPcm(pcm, ch);
  const tempo = songSlice.detectTempo(mono, sampleRate);
  const tags = ["file-whole"];
  if (tempo) tags.push(`bpm:${Math.round(tempo.bpm)}`);

  const durationMs = Math.max(1, durationMsFromPcm(pcm, sampleRate, ch));
  const copy = new Float32Array(pcm.length);
  copy.set(pcm);

  const saved = await persistSample({
    pcm: copy,
    session,
    captureName,
    class: "texture",
    tags,
    confidence: tempo?.confidence ?? 0.5,
    kind: "texture",
    sourceOffsetMs: 0,
    nameExtra: `${captureName} · whole · ${durationMs}ms`,
  });

  await finishSession(session, {
    durationMs,
    status: "ready",
    dominantBpm: tempo?.bpm ?? null,
  });

  onSample?.(saved);
  onProgress?.({ phase: "done", ratio: 1, extracted: 1 });
  return {
    sessionId: session.id,
    extracted: 1,
    skippedVoice: 0,
    samples: [saved],
  };
}

async function processFile(opts: ImportForHuntOpts): Promise<ImportForHuntResult> {
  const { file, projectId, signal, onProgress } = opts;
  if (!isImportableAudio(file)) {
    throw new Error("unsupported_format");
  }

  onProgress?.({ phase: "decode", ratio: 0, extracted: 0 });
  throwIfAborted(signal);
  const { pcm, sampleRate, channelCount } = await decodeAudioFileToPcm(file);
  throwIfAborted(signal);

  if (pcm.length === 0) throw new Error("empty_audio");
  const durationSec = frameCount(pcm, channelCount) / sampleRate;
  if (durationSec > MAX_DURATION_SEC) {
    throw new Error("too_long");
  }

  const prefs = await db.prefs.get("default");
  const mode: FileProcessMode =
    opts.mode ?? prefs?.fileProcessMode ?? "hunt";
  const targetPerMin =
    prefs?.targetCapturesPerMin ?? DEFAULT_TARGET_CAPTURES_PER_MIN;
  const excludeVoice = !prefs || prefs.voicePolicy === "exclude";

  const captureName =
    (opts.captureName ?? "").trim() || stripAudioExt(file.name) || "Fichier";

  const session = await createFileSession({
    projectId,
    captureName,
    sampleRate,
    channelCount,
    mode,
  });

  let offset = 0;
  try {
    if (mode === "song") {
      return await processSong({
        ...opts,
        pcm,
        sampleRate,
        session,
        captureName,
        targetPerMin,
      });
    }
    if (mode === "whole") {
      return await processWhole({
        ...opts,
        pcm,
        sampleRate,
        session,
        captureName,
      });
    }
    return await processHunt({
      ...opts,
      pcm,
      sampleRate,
      session,
      captureName,
      excludeVoice,
    });
  } catch (err) {
    const ended = nowIso();
    const aborted = err instanceof DOMException && err.name === "AbortError";
    await db.sessions.put({
      ...session,
      endedAt: ended,
      durationMs: Math.round(durationSec * 1000),
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
