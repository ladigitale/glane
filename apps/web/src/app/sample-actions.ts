import {
  createEntityId,
  EXPR_ROLE_TAG_PREFIX,
  nowIso,
  type ExprRole,
  type Sample,
  type Session,
} from "@glane/core-model";
import {
  autoCropPcm,
  audioBufferToInterleaved,
  durationMsFromPcm,
  hzToNoteName,
  sliceFrames,
  toMonoPcm,
} from "@glane/audio-dsp";
import { sampleOpfs } from "@glane/audio-io";
import type { SynthMeta, SynthRoleId } from "@glane/audio-synth";
import { db } from "./db.js";
import { loadSampleAudio } from "./load-sample-audio.js";
import { processQueue } from "./process-queue.js";

/** Map synth card role → core ExprRole (pad → chord). */
function synthRoleToExpr(role: SynthRoleId | undefined): ExprRole | null {
  if (!role || role === "pivot") return null;
  if (role === "pad") return "chord";
  return role as ExprRole;
}

/** Marker on stub sessions that hold samples shared into a project. */
const IMPORT_SESSION_NOTES = "glane:import";
const IMPORT_SESSION_TITLE = "Importés";

/** Marker on stub sessions that hold sequencer mix bounces. */
const EXPORT_SESSION_NOTES = "glane:export";
const EXPORT_SESSION_TITLE = "Exports";

/** Marker on stub sessions that hold generated synth batches. */
const SYNTH_SESSION_NOTES = "glane:synth";
const SYNTH_SESSION_TITLE = "Synthèse";
export const SYNTH_TAG = "synth";
export const SYNTH_ORIGIN = "audio-synth";

const STUB_SESSION_NOTES = new Set([
  IMPORT_SESSION_NOTES,
  EXPORT_SESSION_NOTES,
  SYNTH_SESSION_NOTES,
]);

/** Import / export / synth stub — not a field capture hunt. */
export function isStubSession(session: Session): boolean {
  const notes = session.notes?.trim();
  return !!notes && STUB_SESSION_NOTES.has(notes);
}

/** Sample produced by the synth generator and kept in the library. */
export function isSynthSample(sample: Sample): boolean {
  if (sample.deletedAt) return false;
  return (
    sample.originVersion === SYNTH_ORIGIN || sample.tags?.includes(SYNTH_TAG)
  );
}

/** Soft-delete sample, drop OPFS clip, detach/remove clips that reference it. */
export async function deleteSample(sampleId: string): Promise<void> {
  const sample = await db.samples.get(sampleId);
  if (!sample || sample.deletedAt) return;

  await db.samples.update(sampleId, {
    deletedAt: nowIso(),
    updatedAt: nowIso(),
  });

  const clips = await db.clips.where("sampleId").equals(sampleId).toArray();
  for (const clip of clips) {
    await db.clips.delete(clip.id);
    await db.ops.add({
      id: createEntityId(),
      entityType: "clip",
      entityId: clip.id,
      op: "delete",
      payload: { reason: "sample_deleted", sampleId },
      clientSeq: Date.now(),
      clientId: "local",
      createdAt: nowIso(),
    });
  }

  await sampleOpfs.deletePcm(sampleId);

  const jobs = await db.processJobs.where("sampleId").equals(sampleId).toArray();
  if (jobs.length > 0) {
    await db.processJobs.bulkDelete(jobs.map((j) => j.id));
  }

  await db.ops.add({
    id: createEntityId(),
    entityType: "sample",
    entityId: sampleId,
    op: "delete",
    payload: { captureName: sample.captureName },
    clientSeq: Date.now(),
    clientId: "local",
    createdAt: nowIso(),
  });
}

export async function toggleFavorite(sampleId: string): Promise<Sample | null> {
  const sample = await db.samples.get(sampleId);
  if (!sample || sample.deletedAt) return null;
  const favorite = !sample.favorite;
  await db.samples.update(sampleId, { favorite, updatedAt: nowIso() });
  return { ...sample, favorite };
}

export async function renameSample(
  sampleId: string,
  userName: string,
): Promise<Sample | null> {
  const sample = await db.samples.get(sampleId);
  if (!sample || sample.deletedAt) return null;
  const name = userName.trim();
  await db.samples.update(sampleId, {
    userName: name || undefined,
    updatedAt: nowIso(),
  });
  return { ...sample, userName: name || undefined };
}

export async function deleteSamples(sampleIds: string[]): Promise<number> {
  let n = 0;
  for (const id of sampleIds) {
    const before = await db.samples.get(id);
    if (!before || before.deletedAt) continue;
    await deleteSample(id);
    n++;
  }
  return n;
}

export async function setFavoriteMany(
  sampleIds: string[],
  favorite: boolean,
): Promise<number> {
  const now = nowIso();
  let n = 0;
  for (const id of sampleIds) {
    const sample = await db.samples.get(id);
    if (!sample || sample.deletedAt) continue;
    await db.samples.update(id, { favorite, updatedAt: now });
    n++;
  }
  return n;
}

function displayName(sample: Sample): string {
  return sample.userName?.trim() || sample.name;
}

function withCopySuffix(label: string): string {
  const base = label.trim() || "Son";
  if (/\(copie\)$/i.test(base) || /\(copy\)$/i.test(base)) return base;
  return `${base} (copie)`;
}

async function ensureStubSession(
  projectId: string,
  notes: string,
  title: string,
  sampleRate = 48_000,
): Promise<Session> {
  const all = await db.sessions.where("projectId").equals(projectId).toArray();
  const hit = all.find((s) => !s.deletedAt && s.notes === notes);
  if (hit) return hit;

  const now = nowIso();
  const session: Session = {
    id: createEntityId(),
    projectId,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    sampleRate,
    channelCount: 2,
    title,
    notes,
    status: "ready",
    gapMarkers: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  await db.sessions.put(session);
  return session;
}

/** Stub session used when samples are shared into a project without their hunt. */
export async function ensureImportSession(
  projectId: string,
  sampleRate = 48_000,
): Promise<Session> {
  return ensureStubSession(
    projectId,
    IMPORT_SESSION_NOTES,
    IMPORT_SESSION_TITLE,
    sampleRate,
  );
}

/** Stub session for sequencer mix exports saved into the project library. */
export async function ensureExportSession(
  projectId: string,
  sampleRate = 48_000,
): Promise<Session> {
  return ensureStubSession(
    projectId,
    EXPORT_SESSION_NOTES,
    EXPORT_SESSION_TITLE,
    sampleRate,
  );
}

/** Stub session for generative synth batches. */
export async function ensureSynthSession(
  projectId: string,
  sampleRate = 48_000,
): Promise<Session> {
  return ensureStubSession(
    projectId,
    SYNTH_SESSION_NOTES,
    SYNTH_SESSION_TITLE,
    sampleRate,
  );
}

export type CloneSampleOpts = {
  projectId: string;
  sessionId: string;
  /** Append " (copie)" to display name (intra-project duplicate). */
  nameSuffix?: boolean;
  captureName?: string;
};

/** Clone sample row + OPFS PCM. Returns null if audio cannot be loaded. */
export async function cloneSample(
  source: Sample,
  opts: CloneSampleOpts,
): Promise<Sample | null> {
  if (source.deletedAt) return null;
  const audio = await loadSampleAudio(source);
  if (!audio || audio.pcm.length === 0) return null;

  const id = createEntityId();
  const now = nowIso();
  const label = displayName(source);
  const nextLabel = opts.nameSuffix ? withCopySuffix(label) : label;

  await sampleOpfs.savePcm(
    id,
    audio.pcm,
    audio.sampleRate,
    audio.channelCount ?? 1,
  );

  const cloned: Sample = {
    ...source,
    id,
    projectId: opts.projectId,
    sessionId: opts.sessionId,
    captureName: opts.captureName ?? source.captureName,
    name: nextLabel,
    userName: opts.nameSuffix ? nextLabel : source.userName,
    favorite: false,
    parentSampleId: source.id,
    originVersion: source.originVersion,
    sourceOffsetMs: 0,
    durationMs: Math.max(
      1,
      durationMsFromPcm(
        audio.pcm,
        audio.sampleRate,
        audio.channelCount ?? 1,
      ),
    ),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    deletedAt: undefined,
  };
  await db.samples.put(cloned);
  return cloned;
}

/** Duplicate a sample inside its project (new id + PCM + " (copie)" name). */
export async function duplicateSample(
  sampleId: string,
): Promise<Sample | null> {
  const source = await db.samples.get(sampleId);
  if (!source || source.deletedAt) return null;
  return cloneSample(source, {
    projectId: source.projectId,
    sessionId: source.sessionId,
    nameSuffix: true,
  });
}

/** Copy a sample into another project (Importés session + independent PCM). */
export async function copySampleToProject(
  sampleId: string,
  targetProjectId: string,
): Promise<Sample | null> {
  const source = await db.samples.get(sampleId);
  if (!source || source.deletedAt) return null;
  if (source.projectId === targetProjectId) {
    return duplicateSample(sampleId);
  }
  const session = await ensureImportSession(targetProjectId);
  return cloneSample(source, {
    projectId: targetProjectId,
    sessionId: session.id,
    captureName: IMPORT_SESSION_TITLE,
  });
}

export async function copySamplesToProject(
  sampleIds: string[],
  targetProjectId: string,
): Promise<number> {
  let n = 0;
  for (const id of sampleIds) {
    const cloned = await copySampleToProject(id, targetProjectId);
    if (cloned) n++;
  }
  return n;
}

export async function duplicateSamples(sampleIds: string[]): Promise<number> {
  let n = 0;
  for (const id of sampleIds) {
    const cloned = await duplicateSample(id);
    if (cloned) n++;
  }
  return n;
}

const IMPORT_ORIGIN = "import";
const IMPORT_TAG = "import";

function stripAudioExt(name: string): string {
  const base = name.replace(/\.(wav|wave|mp3)$/i, "").trim();
  return base || name;
}

export function isImportableAudio(file: File): boolean {
  const n = file.name.toLowerCase();
  if (/\.(wav|wave|mp3)$/.test(n)) return true;
  const t = file.type.toLowerCase();
  return (
    t === "audio/wav" ||
    t === "audio/wave" ||
    t === "audio/x-wav" ||
    t === "audio/mpeg" ||
    t === "audio/mp3"
  );
}

export function audioBufferToMonoPcm(buf: AudioBuffer): Float32Array {
  const { pcm, channelCount } = audioBufferToInterleaved(buf);
  return toMonoPcm(pcm, channelCount);
}

async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ab = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(ab.slice(0));
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Decode WAV/MP3 to interleaved PCM (stereo preserved when present). */
export async function decodeAudioFileToPcm(
  file: File,
): Promise<{ pcm: Float32Array; sampleRate: number; channelCount: number }> {
  const buffer = await decodeAudioFile(file);
  return audioBufferToInterleaved(buffer);
}

/** Decode WAV/MP3 to mono PCM for library import or offline hunt. */
export async function decodeAudioFileToMono(
  file: File,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const { pcm, sampleRate, channelCount } = await decodeAudioFileToPcm(file);
  return { pcm: toMonoPcm(pcm, channelCount), sampleRate };
}

export type ImportAudioResult = {
  imported: number;
  failed: number;
  samples: Sample[];
};

/** Decode WAV/MP3 files into the project Importés session (OPFS + Dexie). */
export async function importAudioFiles(
  files: Iterable<File>,
  projectId: string,
): Promise<ImportAudioResult> {
  const list = [...files].filter(isImportableAudio);
  const samples: Sample[] = [];
  let failed = 0;
  let session: Session | null = null;

  for (const file of list) {
    try {
      const { pcm, sampleRate, channelCount } = await decodeAudioFileToPcm(file);
      if (pcm.length === 0) {
        failed++;
        continue;
      }
      session ??= await ensureImportSession(projectId, sampleRate);
      const id = createEntityId();
      const now = nowIso();
      const durationMs = Math.max(
        1,
        durationMsFromPcm(pcm, sampleRate, channelCount),
      );
      const label = stripAudioExt(file.name);
      await sampleOpfs.savePcm(id, pcm, sampleRate, channelCount);
      const sample: Sample = {
        id,
        sessionId: session.id,
        projectId,
        captureName: IMPORT_SESSION_TITLE,
        sourceOffsetMs: 0,
        durationMs,
        class: "unclassified",
        tags: [IMPORT_TAG],
        confidence: 0,
        name: label,
        favorite: false,
        originVersion: IMPORT_ORIGIN,
        createdAt: now,
        updatedAt: now,
        revision: 0,
      };
      await db.samples.put(sample);
      samples.push(sample);
    } catch {
      failed++;
    }
  }

  return { imported: samples.length, failed, samples };
}

/** Persist a bounced mix as a new sample in the project library. */
export async function saveBounceToLibrary(
  projectId: string,
  buffer: AudioBuffer,
  name: string,
): Promise<Sample> {
  const { pcm, channelCount, sampleRate } = audioBufferToInterleaved(buffer);
  if (pcm.length === 0) {
    throw new Error("empty_bounce");
  }
  const session = await ensureExportSession(projectId, sampleRate);
  const id = createEntityId();
  const now = nowIso();
  const label = name.trim() || "Export";
  const durationMs = Math.max(
    1,
    durationMsFromPcm(pcm, sampleRate, channelCount),
  );

  await sampleOpfs.savePcm(id, pcm, sampleRate, channelCount);

  const sample: Sample = {
    id,
    sessionId: session.id,
    projectId,
    captureName: EXPORT_SESSION_TITLE,
    sourceOffsetMs: 0,
    durationMs,
    class: "texture",
    tags: ["export", "bounce"],
    confidence: 1,
    name: label,
    userName: label,
    favorite: false,
    originVersion: "seq-bounce",
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  await db.samples.put(sample);
  return sample;
}

export type SynthBatchItem = {
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
  durationMs: number;
  name: string;
  meta: SynthMeta;
};

/** Persist validated synth renders into the project library + polish queue. */
export async function saveSynthBatch(
  projectId: string,
  items: SynthBatchItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  const sampleRate = items[0]?.sampleRate ?? 48_000;
  const session = await ensureSynthSession(projectId, sampleRate);
  let n = 0;
  for (const item of items) {
    if (item.pcm.length === 0) continue;
    const id = createEntityId();
    const now = nowIso();
    const label = item.name.trim() || "Synth";
    const durationMs = Math.max(
      1,
      item.durationMs ||
        durationMsFromPcm(item.pcm, item.sampleRate, item.channelCount),
    );
    await sampleOpfs.savePcm(
      id,
      item.pcm,
      item.sampleRate,
      item.channelCount,
    );
    const tags = [
      SYNTH_TAG,
      `synth:mode:${item.meta.mode}`,
      ...(item.meta.roleSynth
        ? [`synth:role-synth`]
        : item.meta.engines.map((e) => `synth:${e}`)),
    ];
    if (
      !item.meta.roleSynth &&
      !item.meta.engines.includes(item.meta.engine)
    ) {
      tags.push(`synth:${item.meta.engine}`);
    }
    if (item.meta.referentId) {
      tags.push(`synth:ref:${item.meta.referentId}`);
    }
    const exprRole = synthRoleToExpr(item.meta.role);
    if (exprRole) {
      tags.push(`${EXPR_ROLE_TAG_PREFIX}${exprRole}`);
    }
    const sampleClass =
      item.meta.role === "kick" ||
      item.meta.role === "snare" ||
      item.meta.role === "hat" ||
      item.meta.role === "perc" ||
      durationMs < 600
        ? ("percussive" as const)
        : item.meta.role === "bass" ||
            item.meta.role === "lead" ||
            item.meta.role === "arp"
          ? ("tonal" as const)
          : ("texture" as const);
    const sample: Sample = {
      id,
      sessionId: session.id,
      projectId,
      captureName: SYNTH_SESSION_TITLE,
      sourceOffsetMs: 0,
      durationMs,
      class: sampleClass,
      tags,
      confidence: 1,
      name: label,
      userName: label,
      favorite: false,
      forceRole: exprRole ?? undefined,
      parentSampleId: item.meta.referentId,
      originVersion: SYNTH_ORIGIN,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    await db.samples.put(sample);
    await db.analyses.put({
      sampleId: id,
      pitchHz: item.meta.fundHz,
      noteName:
        item.meta.fundHz != null && item.meta.fundHz > 20
          ? hzToNoteName(item.meta.fundHz)
          : undefined,
      centroidHz: item.meta.cutoffHz,
      bpm: item.meta.bpm,
      features: { synth: item.meta },
    });
    void processQueue.enqueue(
      id,
      item.meta.role === "arp" || durationMs >= 800 ? "texture" : "oneshot",
    );
    n++;
  }
  return n;
}

export type AutoCropSamplesResult = {
  cropped: number;
  skipped: number;
};

/** Snap starts to louder delayed attacks + trim quiet tails (OPFS + Dexie). */
export async function autoCropSamples(
  ids: string[],
): Promise<AutoCropSamplesResult> {
  let cropped = 0;
  let skipped = 0;
  for (const id of ids) {
    const audio = await sampleOpfs.loadPcm(id);
    if (!audio || audio.pcm.length === 0) {
      skipped++;
      continue;
    }
    const result = autoCropPcm(
      toMonoPcm(audio.pcm, audio.channelCount),
      audio.sampleRate,
    );
    if (!result.cropped) {
      skipped++;
      continue;
    }
    const nextPcm = sliceFrames(
      audio.pcm,
      audio.channelCount,
      result.startSample,
      result.endSample,
    );
    await sampleOpfs.savePcm(
      id,
      nextPcm,
      audio.sampleRate,
      audio.channelCount,
    );
    const sample = await db.samples.get(id);
    if (sample) {
      const tags = [...(sample.tags ?? [])];
      if (result.attackCropped && !tags.includes("auto-crop-attack")) {
        tags.push("auto-crop-attack");
      }
      if (result.tailCropped && !tags.includes("auto-crop-tail")) {
        tags.push("auto-crop-tail");
      }
      await db.samples.update(id, {
        tags,
        durationMs: Math.max(
          1,
          durationMsFromPcm(nextPcm, audio.sampleRate, audio.channelCount),
        ),
        updatedAt: nowIso(),
        revision: (sample.revision ?? 0) + 1,
      });
    }
    cropped++;
  }
  return { cropped, skipped };
}
