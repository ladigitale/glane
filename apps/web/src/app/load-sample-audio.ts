import { sampleOpfs, sessionOpfs } from "@glane/audio-io";
import type { Sample } from "@glane/core-model";

/** Prefer per-sample OPFS clip; fall back to legacy session master + offset.
 * Polish is handled by processQueue (not on load). */
export async function loadSampleAudio(sample: Sample): Promise<{
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
} | null> {
  const own = await sampleOpfs.loadPcm(sample.id);
  if (own && own.pcm.length > 0) {
    return {
      pcm: own.pcm,
      sampleRate: own.sampleRate,
      channelCount: own.channelCount ?? 1,
    };
  }
  const session = await sessionOpfs.loadPcm(sample.sessionId);
  if (!session) return null;
  const ch = Math.max(1, session.channelCount ?? 1);
  const startFrame = Math.floor(
    (sample.sourceOffsetMs / 1000) * session.sampleRate,
  );
  const lenFrames = Math.max(
    1,
    Math.floor((sample.durationMs / 1000) * session.sampleRate),
  );
  const start = Math.max(0, startFrame * ch);
  const end = Math.min(session.pcm.length, (startFrame + lenFrames) * ch);
  const slice = session.pcm.subarray(start, end);
  if (slice.length === 0) return null;
  return {
    pcm: new Float32Array(slice),
    sampleRate: session.sampleRate,
    channelCount: ch,
  };
}
