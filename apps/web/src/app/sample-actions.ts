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

/** Stub session used when samples are shared into a project without their hunt. */
export async function ensureImportSession(
  projectId: string,
  sampleRate = 48_000,
): Promise<Session> {
  const all = await db.sessions.where("projectId").equals(projectId).toArray();
  const hit = all.find((s) => !s.deletedAt && s.notes === IMPORT_SESSION_NOTES);
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
    title: IMPORT_SESSION_TITLE,
    notes: IMPORT_SESSION_NOTES,
    status: "ready",
    gapMarkers: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  await db.sessions.put(session);
  return session;
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
