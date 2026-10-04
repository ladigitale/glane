import {
  APP_NAME,
  createEntityId,
  normalizeTrack,
  nowIso,
  DEFAULT_TRACK_COUNT,
  DEFAULT_TRACK_FX,
  type Clip,
  type EditOperation,
  type Project,
  type Sample,
  type Track,
} from "@glane/core-model";
import {
  AGENT_PROTOCOL_VERSION,
  compileScore,
  decompileArrangement,
  filterLibrary,
  formatLibraryTable,
  librarySummary,
  shortIdLength,
  type AgentLibraryRow,
  type BridgeMethod,
  type BridgeMethodMap,
  type BridgeProject,
} from "@glane/agent";
import { db, type AgentSnapshot } from "../db.js";
import { projectWorkspace } from "../project-workspace.js";
import { navigate } from "../router.js";
import { applyOverlapFades } from "../seq-schedule.js";
import { resolveExprRole } from "../generative.js";
import { parseStemFromTags, resolveYamnetSlugs } from "../generative-cues.js";
import { resolveSamplePitchHz } from "../process-queue.js";
import { sequencer, waitForSequencer } from "./seq-link.js";

const SNAPSHOTS_PER_PROJECT = 10;

type Params<M extends BridgeMethod> = BridgeMethodMap[M]["params"];
type Result<M extends BridgeMethod> = BridgeMethodMap[M]["result"];
type Handlers = { [M in BridgeMethod]: (p: Params<M>) => Promise<Result<M>> };

async function currentProject(): Promise<Project> {
  const p = await projectWorkspace.ensure();
  if (!p) throw new Error("Aucun projet dans Glane : crée-en un depuis l'app.");
  return p;
}

async function projectTracks(projectId: string): Promise<Track[]> {
  const rows = await db.tracks.where("projectId").equals(projectId).sortBy("index");
  return rows.map(normalizeTrack);
}

async function projectSamples(projectId: string): Promise<Sample[]> {
  const rows = await db.samples.where("projectId").equals(projectId).toArray();
  return rows.filter((s) => !s.deletedAt);
}

async function projectClips(tracks: readonly Track[]): Promise<Clip[]> {
  if (tracks.length === 0) return [];
  return db.clips.where("trackId").anyOf(tracks.map((t) => t.id)).toArray();
}

async function describeProject(p: Project, currentId: string | null): Promise<BridgeProject> {
  const tracks = await projectTracks(p.id);
  const [samples, clips] = await Promise.all([
    projectSamples(p.id),
    projectClips(tracks),
  ]);
  return {
    id: p.id,
    title: p.title,
    current: p.id === currentId,
    bpm: p.bpm,
    bars: p.bars,
    timeSignature: p.timeSignature,
    samples: samples.length,
    clips: clips.length,
  };
}

/** Library rows with the same role inference the built-in generator uses. */
export async function libraryRows(projectId: string): Promise<AgentLibraryRow[]> {
  const samples = await projectSamples(projectId);
  const analyses = await db.analyses.bulkGet(samples.map((s) => s.id));
  const sessions = new Map(
    (await db.sessions.where("projectId").equals(projectId).toArray()).map((s) => [
      s.id,
      s.title,
    ]),
  );
  return samples.map((s, i) => {
    const a = analyses[i] ?? undefined;
    const features = a?.features as Record<string, unknown> | undefined;
    const pitchHz = resolveSamplePitchHz(a);
    const stem = parseStemFromTags(s.tags);
    const role = resolveExprRole({
      id: s.id,
      durationMs: s.durationMs,
      class: s.class,
      favorite: s.favorite,
      loopScore: s.loopScore ?? a?.loopScore,
      loopStartMs: s.loopStartMs,
      loopEndMs: s.loopEndMs,
      pitchHz,
      noteName: a?.noteName,
      harmonicity: a?.harmonicity,
      pitchConfidence: a?.pitchConfidence,
      pitchDriftCents: a?.pitchDriftCents,
      centroidHz: a?.centroidHz,
      transientDensity: a?.transientDensity,
      analysisBpm: a?.bpm,
      lufs: a?.lufs,
      peakDbtp: a?.peakDbtp,
      classScores: s.classScores as Record<string, number> | undefined,
      forceRole: s.forceRole,
      tags: s.tags,
      subclass: s.subclass,
      confidence: s.confidence,
      interestScore: s.interestScore,
      rating: s.rating,
      parentSampleId: s.parentSampleId,
      stem,
      yamnet: resolveYamnetSlugs(s.tags, features),
    });
    return {
      id: s.id,
      name: s.userName?.trim() || s.name,
      class: s.class,
      role,
      durationMs: s.durationMs,
      loopStartMs: s.loopStartMs,
      loopEndMs: s.loopEndMs,
      loopScore: s.loopScore ?? a?.loopScore,
      bpm: a?.bpm,
      note: a?.noteName,
      pitchHz,
      pitchConfidence: a?.pitchConfidence,
      harmonicity: a?.harmonicity,
      centroidHz: a?.centroidHz,
      transientDensity: a?.transientDensity,
      lufs: a?.lufs,
      peakDbtp: a?.peakDbtp,
      rating: s.rating,
      favorite: s.favorite,
      interest: s.interestScore,
      stem: stem ?? undefined,
      capture: s.captureName ?? sessions.get(s.sessionId) ?? undefined,
      tags: s.tags ?? [],
    } satisfies AgentLibraryRow;
  });
}

/** Make sure the project has the standard track count (agent scores address them by index). */
async function ensureTracks(project: Project): Promise<Track[]> {
  const tracks = await projectTracks(project.id);
  if (tracks.length >= DEFAULT_TRACK_COUNT) return tracks;
  const added: Track[] = [];
  for (let i = tracks.length; i < DEFAULT_TRACK_COUNT; i++) {
    added.push({
      id: createEntityId(),
      projectId: project.id,
      index: i,
      name: `Piste ${i + 1}`,
      gainDb: 0,
      pan: 0,
      mute: false,
      solo: false,
      heightPx: 56,
      fx: { ...DEFAULT_TRACK_FX },
    });
  }
  await db.tracks.bulkPut(added);
  return [...tracks, ...added];
}

function op(
  entityType: string,
  entityId: string,
  kind: string,
  payload: unknown,
  seq: number,
): EditOperation {
  return {
    id: createEntityId(),
    entityType,
    entityId,
    op: kind,
    payload: payload as Record<string, unknown>,
    clientSeq: seq,
    clientId: "agent",
    createdAt: nowIso(),
  };
}

async function snapshot(project: Project, tracks: Track[], clips: Clip[], reason: string) {
  const snap: AgentSnapshot = {
    id: createEntityId(),
    projectId: project.id,
    createdAt: nowIso(),
    reason,
    project,
    tracks,
    clips,
  };
  await db.agentSnapshots.put(snap);
  const all = await db.agentSnapshots.where("projectId").equals(project.id).sortBy("createdAt");
  const extra = all.length - SNAPSHOTS_PER_PROJECT;
  if (extra > 0) await db.agentSnapshots.bulkDelete(all.slice(0, extra).map((s) => s.id));
  return snap.id;
}

async function showProject(projectId: string): Promise<void> {
  if (location.pathname !== `/project/${projectId}`) {
    navigate({ name: "project", id: projectId });
  }
  await waitForSequencer(projectId);
}

async function refreshSequencer(projectId: string, open: boolean) {
  const live = sequencer();
  if (live?.projectId() === projectId) {
    live.stop();
    await live.reloadFromDb();
    return live;
  }
  if (!open) return null;
  await showProject(projectId);
  return sequencer();
}

async function playFrom(projectId: string, bar?: number) {
  let live = sequencer();
  if (live?.projectId() !== projectId) {
    await showProject(projectId);
    live = sequencer();
  }
  if (!live) return { ok: false, playing: false, note: "Séquenceur introuvable." };
  const r = await live.play(bar);
  return {
    ok: r.playing,
    playing: r.playing,
    ...(r.audio === "suspended"
      ? {
          note: "Le navigateur bloque l'audio tant qu'on n'a pas touché la page : appuie une fois sur Play dans Glane.",
        }
      : {}),
  };
}

export const agentHandlers: Handlers = {
  async status() {
    const currentId = await projectWorkspace.currentId();
    const p = currentId ? await db.projects.get(currentId) : undefined;
    return {
      app: APP_NAME,
      protocol: AGENT_PROTOCOL_VERSION,
      route: location.pathname,
      visible: document.visibilityState === "visible",
      audio: sequencer()?.audioState() ?? "none",
      project: p && !p.deletedAt ? await describeProject(p, currentId) : null,
    };
  },

  async "projects.list"() {
    const currentId = await projectWorkspace.currentId();
    const all = await projectWorkspace.listActive();
    return { projects: await Promise.all(all.map((p) => describeProject(p, currentId))) };
  },

  async "projects.select"({ projectId }) {
    const p = await projectWorkspace.switchTo(projectId);
    if (location.pathname.startsWith("/project")) await showProject(p.id);
    return { project: await describeProject(p, p.id) };
  },

  async "library.list"(params) {
    const project = await currentProject();
    const rows = await libraryRows(project.id);
    const idLen = shortIdLength(rows.map((r) => r.id));
    const { total, rows: page } = filterLibrary(rows, params);
    const offset = params.offset ?? 0;
    const base = {
      projectId: project.id,
      total,
      returned: page.length,
      offset,
      ...(offset === 0 ? { summary: librarySummary(rows) } : {}),
    };
    if (params.format === "json") {
      return { ...base, rows: page.map((r) => ({ ...r, id: r.id.slice(0, idLen) })) };
    }
    return { ...base, table: formatLibraryTable(page, idLen) };
  },

  async "arrangement.get"() {
    const project = await currentProject();
    const tracks = await projectTracks(project.id);
    const clips = await projectClips(tracks);
    const ids = (await projectSamples(project.id)).map((s) => s.id);
    const idLen = shortIdLength(ids);
    return {
      projectId: project.id,
      score: decompileArrangement(project, tracks, clips, {
        sampleRef: (id) => id.slice(0, idLen),
      }),
    };
  },

  async "arrangement.write"({ score, play, open }) {
    const project = await currentProject();
    const samples = await projectSamples(project.id);
    const compiled = compileScore(score, {
      samples: samples.map((s) => ({
        id: s.id,
        durationMs: s.durationMs,
        loopStartMs: s.loopStartMs,
        loopEndMs: s.loopEndMs,
      })),
    });
    if (!compiled.ok) {
      return { ok: false, errors: compiled.errors, warnings: compiled.warnings };
    }
    const v = compiled.value;
    const tracks = await ensureTracks(project);
    const oldClips = await projectClips(tracks);
    const snapshotId = await snapshot(project, tracks, oldClips, "arrangement.write");

    const nextTracks: Track[] = tracks.map((t) => {
      const c = v.tracks[t.index];
      if (!c) return t;
      return {
        ...t,
        name: c.name,
        gainDb: c.gainDb,
        pan: c.pan,
        mute: c.mute,
        solo: false,
        fx: c.fx,
        sendA: c.sendA,
        sendB: c.sendB,
      };
    });
    const byIndex = new Map(nextTracks.map((t) => [t.index, t]));
    let clips: Clip[] = v.clips.map(({ trackIndex, ...c }) => ({
      ...c,
      id: createEntityId(),
      trackId: byIndex.get(trackIndex)!.id,
      sampleVersionId: createEntityId(),
    }));
    for (const t of nextTracks) clips = applyOverlapFades(clips, t.id, v.project.bpm);

    const nextProject: Project = {
      ...project,
      ...v.project,
      title: v.project.title ?? project.title,
      automation: v.project.automation,
      formSections: v.project.formSections,
      updatedAt: nowIso(),
      revision: project.revision + 1,
    };

    let seq = Date.now();
    await db.transaction("rw", [db.clips, db.tracks, db.projects, db.ops], async () => {
      await db.clips.bulkDelete(oldClips.map((c) => c.id));
      await db.tracks.bulkPut(nextTracks);
      await db.projects.put(nextProject);
      await db.clips.bulkPut(clips);
      await db.ops.bulkAdd([
        ...oldClips.map((c) => op("clip", c.id, "delete", c, seq++)),
        ...nextTracks.map((t) => op("track", t.id, "update", t, seq++)),
        op("project", nextProject.id, "update", nextProject, seq++),
        ...clips.map((c) => op("clip", c.id, "create", c, seq++)),
      ]);
    });

    await refreshSequencer(project.id, open !== false || play === true);
    const played = play ? await playFrom(project.id) : null;
    return {
      ok: true,
      projectId: project.id,
      warnings: v.warnings,
      stats: v.stats,
      snapshotId,
      playing: played?.playing ?? false,
      ...(played?.note ? { note: played.note } : {}),
    };
  },

  async "arrangement.undo"() {
    const project = await currentProject();
    const snaps = await db.agentSnapshots.where("projectId").equals(project.id).sortBy("createdAt");
    const last = snaps.at(-1);
    if (!last) return { ok: false, note: "Aucune écriture de l'agent à annuler sur ce projet." };
    const tracks = await projectTracks(project.id);
    const current = await projectClips(tracks);
    await db.transaction("rw", [db.clips, db.tracks, db.projects, db.agentSnapshots], async () => {
      await db.clips.bulkDelete(current.map((c) => c.id));
      await db.tracks.bulkPut(last.tracks);
      await db.projects.put({
        ...last.project,
        updatedAt: nowIso(),
        revision: project.revision + 1,
      });
      await db.clips.bulkPut(last.clips);
      await db.agentSnapshots.delete(last.id);
    });
    await refreshSequencer(project.id, false);
    return { ok: true, restoredAt: last.createdAt };
  },

  async transport({ action, bar }) {
    const project = await currentProject();
    if (action === "stop") {
      sequencer()?.stop();
      return { ok: true, playing: false };
    }
    return playFrom(project.id, bar);
  },
};
