import {
  DEFAULT_TRACK_COUNT,
  DEFAULT_TRACK_FX,
  createEntityId,
  nowIso,
  type Project,
  type Track,
} from "@glane/core-model";
import { db, ensurePrefs } from "./db.js";
import {
  cloneSample,
  deleteSample,
  ensureImportSession,
} from "./sample-actions.js";
import { seqUiState } from "./seq-ui-state.js";
import { synthUiState } from "./synth-ui-state.js";

export const PROJECT_CHANGE_EVENT = "glane:project-change";

function notifyProjectChange(): void {
  window.dispatchEvent(new Event(PROJECT_CHANGE_EVENT));
}

async function setCurrentId(id: string, notify: boolean): Promise<void> {
  const prefs = await ensurePrefs();
  if (prefs.currentProjectId === id) return;
  prefs.currentProjectId = id;
  await db.prefs.put(prefs);
  if (notify) notifyProjectChange();
}

async function createBlankProject(title: string): Promise<Project> {
  const id = createEntityId();
  const now = nowIso();
  const project: Project = {
    id,
    title,
    bpm: 120,
    timeSignature: [4, 4],
    bars: 16,
    masterGainDb: 0,
    preampGainDb: 0,
    masterFx: [
      { ...DEFAULT_TRACK_FX },
      { ...DEFAULT_TRACK_FX },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.projects.put(project);
  const tracks: Track[] = [];
  for (let i = 0; i < DEFAULT_TRACK_COUNT; i++) {
    tracks.push({
      id: createEntityId(),
      projectId: id,
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
  await db.tracks.bulkPut(tracks);
  return project;
}

/** Current workspace: library + arrangement scoped by projectId. */
export const projectWorkspace = {
  async listActive(): Promise<Project[]> {
    const all = await db.projects.orderBy("updatedAt").reverse().toArray();
    return all.filter((p) => !p.deletedAt);
  },

  /** Active project if any — never auto-creates. */
  async ensure(): Promise<Project | null> {
    const prefs = await ensurePrefs();
    if (prefs.currentProjectId) {
      const cur = await db.projects.get(prefs.currentProjectId);
      if (cur && !cur.deletedAt) return cur;
    }
    const list = await projectWorkspace.listActive();
    if (list[0]) {
      await setCurrentId(list[0].id, false);
      return list[0];
    }
    if (prefs.currentProjectId) {
      prefs.currentProjectId = "";
      await db.prefs.put(prefs);
    }
    return null;
  },

  async currentId(): Promise<string | null> {
    return (await projectWorkspace.ensure())?.id ?? null;
  },

  async switchTo(id: string): Promise<Project> {
    const p = await db.projects.get(id);
    if (!p || p.deletedAt) {
      throw new Error(`project not found: ${id}`);
    }
    await setCurrentId(id, true);
    return p;
  },

  async create(title?: string): Promise<Project> {
    const n = (await db.projects.count()) + 1;
    const project = await createBlankProject(
      title?.trim() || `Projet ${n}`,
    );
    await setCurrentId(project.id, true);
    return project;
  },

  async rename(id: string, title: string): Promise<void> {
    const p = await db.projects.get(id);
    if (!p || p.deletedAt) return;
    const next = title.trim();
    if (!next || next === p.title) return;
    const updated: Project = {
      ...p,
      title: next,
      updatedAt: nowIso(),
      revision: p.revision + 1,
    };
    await db.projects.put(updated);
    notifyProjectChange();
  },

  /** Deep-copy project: meta, tracks, sessions, samples (OPFS), clips. Switches to the copy. */
  async duplicate(id: string, title?: string): Promise<Project> {
    const src = await db.projects.get(id);
    if (!src || src.deletedAt) {
      throw new Error(`project not found: ${id}`);
    }

    const now = nowIso();
    const newId = createEntityId();
    const copyTitle =
      title?.trim() ||
      (/\(copie\)$/i.test(src.title) ? src.title : `${src.title} (copie)`);
    const project: Project = {
      ...src,
      id: newId,
      title: copyTitle,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: undefined,
    };
    await db.projects.put(project);

    const tracks = await db.tracks.where("projectId").equals(id).toArray();
    const trackMap = new Map<string, string>();
    const newTracks: Track[] = tracks.map((tr) => {
      const nid = createEntityId();
      trackMap.set(tr.id, nid);
      return { ...tr, id: nid, projectId: newId };
    });
    if (newTracks.length > 0) await db.tracks.bulkPut(newTracks);

    const sessions = (
      await db.sessions.where("projectId").equals(id).toArray()
    ).filter((s) => !s.deletedAt);
    const sessionMap = new Map<string, string>();
    for (const sess of sessions) {
      const nid = createEntityId();
      sessionMap.set(sess.id, nid);
      await db.sessions.put({
        ...sess,
        id: nid,
        projectId: newId,
        createdAt: now,
        updatedAt: now,
        revision: 0,
        deletedAt: undefined,
      });
    }

    const samples = (
      await db.samples.where("projectId").equals(id).toArray()
    ).filter((s) => !s.deletedAt);
    const sampleMap = new Map<string, string>();
    let importSessionId: string | undefined;
    for (const s of samples) {
      let sessionId = sessionMap.get(s.sessionId);
      if (!sessionId) {
        if (!importSessionId) {
          importSessionId = (await ensureImportSession(newId)).id;
        }
        sessionId = importSessionId;
      }
      const cloned = await cloneSample(s, {
        projectId: newId,
        sessionId,
      });
      if (cloned) sampleMap.set(s.id, cloned.id);
    }

    for (const tr of tracks) {
      const newTrackId = trackMap.get(tr.id);
      if (!newTrackId) continue;
      const clips = await db.clips.where("trackId").equals(tr.id).toArray();
      if (clips.length === 0) continue;
      await db.clips.bulkPut(
        clips.map((c) => ({
          ...c,
          id: createEntityId(),
          trackId: newTrackId,
          sampleVersionId: createEntityId(),
          sampleId: c.sampleId ? sampleMap.get(c.sampleId) : undefined,
        })),
      );
    }

    await setCurrentId(newId, true);
    return project;
  },

  /** Soft-delete project + cascade library/arrangement; switches to another workspace if any. */
  async remove(id: string): Promise<Project | null> {
    const p = await db.projects.get(id);
    if (!p || p.deletedAt) return projectWorkspace.ensure();

    const now = nowIso();
    await db.projects.put({
      ...p,
      deletedAt: now,
      updatedAt: now,
      revision: p.revision + 1,
    });

    const samples = await db.samples.where("projectId").equals(id).toArray();
    for (const s of samples) {
      if (!s.deletedAt) await deleteSample(s.id);
    }

    const sessions = await db.sessions.where("projectId").equals(id).toArray();
    for (const s of sessions) {
      if (s.deletedAt) continue;
      await db.sessions.update(s.id, {
        deletedAt: now,
        updatedAt: now,
        revision: s.revision + 1,
      });
    }

    const tracks = await db.tracks.where("projectId").equals(id).toArray();
    for (const tr of tracks) {
      const clips = await db.clips.where("trackId").equals(tr.id).toArray();
      if (clips.length > 0) {
        await db.clips.bulkDelete(clips.map((c) => c.id));
      }
      await db.tracks.delete(tr.id);
    }

    const prefs = await ensurePrefs();
    if (prefs.currentProjectId === id) {
      prefs.currentProjectId = "";
      await db.prefs.put(prefs);
    }

    seqUiState.clear(id);
    synthUiState.clear(id);

    const next = await projectWorkspace.ensure();
    notifyProjectChange();
    return next;
  },
} as const;
