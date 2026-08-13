import { sessionOpfs } from "@glane/audio-io";
import { durationMsFromPcm } from "@glane/audio-dsp";
import { db } from "./db.js";
import { nowIso } from "@glane/core-model";

/** On cold start: finalize OPFS masters left open after a tab crash. */
export async function bootRecoverSessions(): Promise<string[]> {
  const sessions = await db.sessions.toArray();
  const meta = new Map(
    sessions.map((s) => [
      s.id,
      { sampleRate: s.sampleRate, channelCount: s.channelCount },
    ]),
  );
  const recovered = await sessionOpfs.recoverAll(meta);
  for (const id of recovered) {
    const s = await db.sessions.get(id);
    if (!s) continue;
    const pcm = await sessionOpfs.loadPcm(id);
    const ch = pcm?.channelCount ?? s.channelCount ?? 1;
    const durationMs = pcm
      ? durationMsFromPcm(pcm.pcm, pcm.sampleRate, ch)
      : s.durationMs;
    await db.sessions.put({
      ...s,
      status: "ready",
      endedAt: s.endedAt ?? nowIso(),
      durationMs,
      updatedAt: nowIso(),
      gapMarkers: [
        ...s.gapMarkers,
        {
          atMs: durationMs,
          reason: "unknown",
          durationMs: 0,
        },
      ],
    });
  }
  return recovered;
}
