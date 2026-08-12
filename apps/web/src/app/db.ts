import Dexie, { type Table } from "dexie";
import type {
  Clip,
  EditOperation,
  Project,
  Sample,
  SampleAnalysis,
  Session,
  Track,
  SyncPolicy,
  VoicePolicy,
} from "@glane/core-model";
import {
  DEFAULT_TRACK_COUNT,
  DEFAULT_TRACK_FX,
  STORAGE_PREFIX,
  createEntityId,
  nowIso,
} from "@glane/core-model";
import { normalizeThemeId, type AppThemeId } from "./theme.js";
import { resolveBrowserLocale, type AppLocale } from "./i18n/locale.js";

/** How « Traiter un fichier » segments audio (live mic always hunts). */
export type FileProcessMode = "hunt" | "song" | "whole";

export type UserPrefs = {
  id: string;
  voicePolicy: VoicePolicy;
  syncPolicy: SyncPolicy;
  /** Prefer Wi‑Fi/ethernet before flushing (default true). */
  wifiOnly: boolean;
  theme: AppThemeId;
  locale: AppLocale;
  haptics: boolean;
  /** Active workspace (library + arrangement). */
  currentProjectId?: string;
  /** Soft compressor + makeup on the live capture path. */
  captureAutoGain?: boolean;
  /**
   * Internal attack sensitivity 0–100 (higher = opens sooner).
   * Auto-tuned toward targetCapturesPerMin; maps to openFloorFactor.
   */
  attackSensitivity?: number;
  /** Desired live captures per minute (2–60). */
  targetCapturesPerMin?: number;
  /**
   * File import mode: event hunt, tempo grid slices, or whole file.
   * Live mic ignores this (always hunt).
   */
  fileProcessMode?: FileProcessMode;
  /** Preferred MediaDeviceInfo.deviceId for capture (empty = browser default). */
  captureAudioDeviceId?: string;
  /**
   * T2 YAMNet semantic tags after polish (ADR-0020). Default on.
   * Set false to skip model download / inference.
   */
  mlYamnet?: boolean;
  /**
   * T2 CLAP embeddings after polish (search / similar). Default **off**
   * (large first download); enable in capture settings. Similar/search can
   * still load on demand.
   */
  mlClap?: boolean;
};

export type ProcessJobStatus = "pending" | "running" | "done" | "error";

export type ProcessJob = {
  id: string;
  sampleId: string;
  kind: "oneshot" | "texture";
  status: ProcessJobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export class GlaneDb extends Dexie {
  sessions!: Table<Session, string>;
  samples!: Table<Sample, string>;
  analyses!: Table<SampleAnalysis, string>;
  projects!: Table<Project, string>;
  tracks!: Table<Track, string>;
  clips!: Table<Clip, string>;
  ops!: Table<EditOperation, string>;
  prefs!: Table<UserPrefs, string>;
  processJobs!: Table<ProcessJob, string>;

  constructor() {
    super(`${STORAGE_PREFIX}-db`);
    this.version(1).stores({
      sessions: "id, status, startedAt, deletedAt",
      samples: "id, sessionId, class, favorite, deletedAt, name",
      analyses: "sampleId",
      projects: "id, updatedAt, deletedAt",
      tracks: "id, projectId, index",
      clips: "id, trackId, sampleId",
      ops: "id, clientSeq, entityId, createdAt",
      prefs: "id",
    });
    this.version(2).stores({
      sessions: "id, status, startedAt, deletedAt",
      samples: "id, sessionId, class, favorite, deletedAt, name",
      analyses: "sampleId",
      projects: "id, updatedAt, deletedAt",
      tracks: "id, projectId, index",
      clips: "id, trackId, sampleId",
      ops: "id, clientSeq, entityId, createdAt, syncedAt",
      prefs: "id",
    });
    this.version(3).stores({
      sessions: "id, status, startedAt, deletedAt, title",
      samples: "id, sessionId, class, favorite, deletedAt, name, captureName, *tags",
      analyses: "sampleId",
      projects: "id, updatedAt, deletedAt",
      tracks: "id, projectId, index",
      clips: "id, trackId, sampleId",
      ops: "id, clientSeq, entityId, createdAt, syncedAt",
      prefs: "id",
    });
    this.version(4).stores({
      sessions: "id, status, startedAt, deletedAt, title",
      samples: "id, sessionId, class, favorite, deletedAt, name, captureName, *tags",
      analyses: "sampleId",
      projects: "id, updatedAt, deletedAt",
      tracks: "id, projectId, index",
      clips: "id, trackId, sampleId",
      ops: "id, clientSeq, entityId, createdAt, syncedAt",
      prefs: "id",
      processJobs: "id, sampleId, status, createdAt",
    });
    this.version(5)
      .stores({
        sessions: "id, status, startedAt, deletedAt, title, projectId",
        samples:
          "id, sessionId, projectId, class, favorite, deletedAt, name, captureName, *tags",
        analyses: "sampleId",
        projects: "id, updatedAt, deletedAt",
        tracks: "id, projectId, index",
        clips: "id, trackId, sampleId",
        ops: "id, clientSeq, entityId, createdAt, syncedAt",
        prefs: "id",
        processJobs: "id, sampleId, status, createdAt",
      })
      .upgrade(async (tx) => {
        const projects = tx.table("projects");
        const tracksTbl = tx.table("tracks");
        const sessions = tx.table("sessions");
        const samples = tx.table("samples");
        const prefsTbl = tx.table("prefs");

        let active = (await projects.toArray()) as Project[];
        active = active
          .filter((p) => !p.deletedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

        let projectId = active[0]?.id;
        if (!projectId) {
          projectId = createEntityId();
          const now = nowIso();
          await projects.put({
            id: projectId,
            title: "Projet 1",
            bpm: 120,
            timeSignature: [4, 4],
            bars: 16,
            masterGainDb: 0,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          } satisfies Project);
          const trackRows: Track[] = [];
          for (let i = 0; i < DEFAULT_TRACK_COUNT; i++) {
            trackRows.push({
              id: createEntityId(),
              projectId,
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
          await tracksTbl.bulkPut(trackRows);
        }

        await sessions.toCollection().modify((s: Session & { projectId?: string }) => {
          if (!s.projectId) s.projectId = projectId!;
        });
        await samples.toCollection().modify((s: Sample & { projectId?: string }) => {
          if (!s.projectId) s.projectId = projectId!;
        });

        const pref = (await prefsTbl.get("default")) as UserPrefs | undefined;
        if (pref && !pref.currentProjectId) {
          await prefsTbl.put({ ...pref, currentProjectId: projectId });
        }
      });
  }
}

export const db = new GlaneDb();

export async function ensurePrefs(): Promise<UserPrefs> {
  const existing = await db.prefs.get("default");
  if (!existing) {
    return createDefaultPrefs();
  }
  let prefs = existing;
  let dirty = false;
  if (prefs.wifiOnly === undefined) {
    prefs = { ...prefs, wifiOnly: true as const };
    dirty = true;
  }
  if (prefs.captureAutoGain === undefined) {
    prefs = { ...prefs, captureAutoGain: false };
    dirty = true;
  }
  if (prefs.attackSensitivity === undefined) {
    prefs = { ...prefs, attackSensitivity: DEFAULT_ATTACK_SENSITIVITY };
    dirty = true;
  }
  if (prefs.targetCapturesPerMin === undefined) {
    prefs = { ...prefs, targetCapturesPerMin: DEFAULT_TARGET_CAPTURES_PER_MIN };
    dirty = true;
  }
  if (prefs.mlYamnet === undefined) {
    prefs = { ...prefs, mlYamnet: true };
    dirty = true;
  }
  if (prefs.mlClap === undefined) {
    prefs = { ...prefs, mlClap: false };
    dirty = true;
  }
  if (prefs.fileProcessMode === undefined) {
    prefs = { ...prefs, fileProcessMode: "hunt" };
    dirty = true;
  }
  const theme = normalizeThemeId(prefs.theme);
  if (theme !== prefs.theme) {
    prefs = { ...prefs, theme };
    dirty = true;
  }
  if (dirty) await db.prefs.put(prefs);
  return prefs;
}

/** Seed for auto-rate regulator (0–100). */
export const DEFAULT_ATTACK_SENSITIVITY = 35;

/** Default density: ~one event every 5 s. */
export const DEFAULT_TARGET_CAPTURES_PER_MIN = 12;

async function createDefaultPrefs(): Promise<UserPrefs> {
  const prefs: UserPrefs = {
    id: "default",
    voicePolicy: "exclude",
    syncPolicy: "local_only",
    wifiOnly: true,
    theme: "nord",
    locale: resolveBrowserLocale(),
    haptics: true,
    captureAutoGain: false,
    attackSensitivity: DEFAULT_ATTACK_SENSITIVITY,
    targetCapturesPerMin: DEFAULT_TARGET_CAPTURES_PER_MIN,
    fileProcessMode: "hunt",
    mlYamnet: true,
    mlClap: false,
  };
  await db.prefs.put(prefs);
  return prefs;
}
