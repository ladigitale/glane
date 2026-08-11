import {
  createEntityId,
  nowIso,
  type Sample,
  type Session,
} from "@glane/core-model";
import { sampleOpfs } from "@glane/audio-io";
import { db } from "./db.js";
import { loadSampleAudio } from "./load-sample-audio.js";

/** Marker on stub sessions that hold samples shared into a project. */
const IMPORT_SESSION_NOTES = "glane:import";
const IMPORT_SESSION_TITLE = "Importés";

/** Marker on stub sessions that hold sequencer mix bounces. */
const EXPORT_SESSION_NOTES = "glane:export";
const EXPORT_SESSION_TITLE = "Exports";

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
    channelCount: 1,
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

  await sampleOpfs.savePcm(id, audio.pcm, audio.sampleRate);

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
      Math.round((audio.pcm.length / audio.sampleRate) * 1000),
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

function isImportableAudio(file: File): boolean {
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

function audioBufferToMonoPcm(buf: AudioBuffer): Float32Array {
  const frames = buf.length;
  const out = new Float32Array(frames);
  if (buf.numberOfChannels === 1) {
    out.set(buf.getChannelData(0));
    return out;
  }
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) out[i]! += ch[i]!;
  }
  const inv = 1 / buf.numberOfChannels;
  for (let i = 0; i < frames; i++) out[i]! *= inv;
  return out;
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
      const buffer = await decodeAudioFile(file);
      const pcm = audioBufferToMonoPcm(buffer);
      if (pcm.length === 0) {
        failed++;
        continue;
      }
      session ??= await ensureImportSession(projectId, buffer.sampleRate);
      const id = createEntityId();
      const now = nowIso();
      const durationMs = Math.max(
        1,
        Math.round((pcm.length / buffer.sampleRate) * 1000),
      );
      const label = stripAudioExt(file.name);
      await sampleOpfs.savePcm(id, pcm, buffer.sampleRate, 1);
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

/** Persist a bounced mix as a new sample in the project library (mono PCM). */
export async function saveBounceToLibrary(
  projectId: string,
  buffer: AudioBuffer,
  name: string,
): Promise<Sample> {
  const pcm = audioBufferToMonoPcm(buffer);
  if (pcm.length === 0) {
    throw new Error("empty_bounce");
  }
  const sampleRate = buffer.sampleRate;
  const session = await ensureExportSession(projectId, sampleRate);
  const id = createEntityId();
  const now = nowIso();
  const label = name.trim() || "Export";
  const durationMs = Math.max(1, Math.round((pcm.length / sampleRate) * 1000));

  await sampleOpfs.savePcm(id, pcm, sampleRate, 1);

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
