import { PPQ, type Session } from "@glane/core-model";
import { db } from "./db.js";
import { isStubSession, isSynthSample } from "./sample-actions.js";
import { ticksToMs } from "./seq-schedule.js";

export type HubStats = {
  sessionCount: number;
  sampleCount: number;
  synthSampleCount: number;
  clipCount: number;
  arrangementDurationMs: number;
  bars: number;
};

function isCompletedCaptureSession(session: Session): boolean {
  if (session.deletedAt || isStubSession(session)) return false;
  return session.status === "ready";
}

export async function loadHubStats(projectId: string): Promise<HubStats> {
  const [sessions, samples, project, tracks] = await Promise.all([
    db.sessions.where("projectId").equals(projectId).toArray(),
    db.samples.where("projectId").equals(projectId).toArray(),
    db.projects.get(projectId),
    db.tracks.where("projectId").equals(projectId).toArray(),
  ]);

  const activeSamples = samples.filter((s) => !s.deletedAt);
  const sessionCount = sessions.filter(isCompletedCaptureSession).length;
  const synthSampleCount = activeSamples.filter(isSynthSample).length;

  const clipCounts = await Promise.all(
    tracks.map((t) => db.clips.where("trackId").equals(t.id).count()),
  );
  const clipCount = clipCounts.reduce((sum, n) => sum + n, 0);

  const bars = project?.bars ?? 16;
  const bpm = project?.bpm ?? 120;
  const beatsPerBar = project?.timeSignature[0] ?? 4;
  const seqLenTick = bars * beatsPerBar * PPQ;
  const arrangementDurationMs = ticksToMs(seqLenTick, bpm);

  return {
    sessionCount,
    sampleCount: activeSamples.length,
    synthSampleCount,
    clipCount,
    arrangementDurationMs,
    bars,
  };
}
