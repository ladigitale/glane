import {
  asSampleIndex,
  asTick,
  msToSamples,
  normalizeTrackFx,
  ticksToSamples,
  PPQ,
  type Clip,
  type Track,
  type TrackFx,
} from "@glane/core-model";
import type { ScheduledClip, TrackInsertConfig } from "@glane/audio-engine";
import { clipOverlapTicks } from "@glane/gestures";

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Track rotary linear gain (AudioRoom-style): 0 silence … 1 unity … 2 ≈ +6 dB. */
export const TRACK_GAIN_LIN_MAX = 2;
const TRACK_GAIN_SILENCE_DB = -80;

export function gainDbToLin(db: number): number {
  if (!Number.isFinite(db) || db <= TRACK_GAIN_SILENCE_DB) return 0;
  return Math.min(TRACK_GAIN_LIN_MAX, dbToGain(db));
}

export function linToGainDb(lin: number): number {
  const v = Math.min(TRACK_GAIN_LIN_MAX, Math.max(0, lin));
  if (v <= 1e-4) return TRACK_GAIN_SILENCE_DB;
  return (20 * Math.log10(v));
}

/** Magnetic snaps at 0 / 1 / 2 (AudioRoom). */
export function snapTrackGainLin(lin: number): number {
  let v = Math.min(TRACK_GAIN_LIN_MAX, Math.max(0, lin));
  if (v < 0.05) return 0;
  if (v > 0.95 && v < 1.05) return 1;
  if (v > 1.9) return 2;
  return v;
}

const ROTARY_T0 = Math.PI / 4;
const ROTARY_T1 = (7 * Math.PI) / 4;
const ROTARY_SPAN = ROTARY_T1 - ROTARY_T0;

/** Angle (rad) for display; fine curve below unity. */
export function trackGainLinToAngle(lin: number): number {
  let v = snapTrackGainLin(lin);
  if (v > 0 && v < 1) v = Math.sqrt(v);
  return ROTARY_T0 + (ROTARY_SPAN * v) / TRACK_GAIN_LIN_MAX;
}

export function trackGainAngleToLin(angle: number): number {
  let r = angle;
  if (r < 0) r += Math.PI * 2;
  // Dead zone between T1 and T0 (short arc through 0) → clamp to nearest end
  if (r > ROTARY_T1 || r < ROTARY_T0) {
    const d0 = Math.min(
      Math.abs(r - ROTARY_T0),
      Math.abs(r - ROTARY_T0 - Math.PI * 2),
    );
    const d1 = Math.min(
      Math.abs(r - ROTARY_T1),
      Math.abs(r - ROTARY_T1 + Math.PI * 2),
    );
    r = d0 <= d1 ? ROTARY_T0 : ROTARY_T1;
  }
  let result = ((r - ROTARY_T0) * TRACK_GAIN_LIN_MAX) / ROTARY_SPAN;
  if (result < 1) result = result * result;
  return snapTrackGainLin(result);
}

export function ticksToMs(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm) * 1000;
}

/** Pairwise overlap regions on a track (for xfade painting). */
export function trackXfadeZones(
  clips: Array<{ id: string; startTick: number; lengthTick: number }>,
): Array<{ key: string; startTick: number; lengthTick: number }> {
  const sorted = [...clips].sort((a, b) => a.startTick - b.startTick);
  const out: Array<{ key: string; startTick: number; lengthTick: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.startTick >= a.startTick + a.lengthTick) break;
      const ov = clipOverlapTicks(a, b);
      if (ov) {
        out.push({
          key: `${a.id}:${b.id}`,
          startTick: ov.startTick,
          lengthTick: ov.lengthTick,
        });
      }
    }
  }
  return out;
}

/**
 * Raise clip fades to cover overlap windows (earlier → fadeOut, later → fadeIn).
 * Preserves existing / manual fades; only increases when an overlap needs more.
 */
export function applyOverlapFades(
  clips: Clip[],
  trackId: string,
  bpm: number,
  defaultMs = 5,
): Clip[] {
  const onTrack = clips.filter((c) => c.trackId === trackId);
  const fadeIn = new Map<string, number>();
  const fadeOut = new Map<string, number>();
  for (const c of onTrack) {
    fadeIn.set(c.id, c.fadeInMs);
    fadeOut.set(c.id, c.fadeOutMs);
  }
  for (let i = 0; i < onTrack.length; i++) {
    for (let j = i + 1; j < onTrack.length; j++) {
      const a = onTrack[i]!;
      const b = onTrack[j]!;
      const ov = clipOverlapTicks(a, b);
      if (!ov) continue;
      const ms = Math.max(defaultMs, Math.round(ticksToMs(ov.lengthTick, bpm)));
      const earlier = a.startTick <= b.startTick ? a : b;
      const later = earlier === a ? b : a;
      fadeOut.set(earlier.id, Math.max(fadeOut.get(earlier.id) ?? 0, ms));
      fadeIn.set(later.id, Math.max(fadeIn.get(later.id) ?? 0, ms));
    }
  }
  return clips.map((c) => {
    if (c.trackId !== trackId) return c;
    return {
      ...c,
      fadeInMs: fadeIn.get(c.id) ?? c.fadeInMs,
      fadeOutMs: fadeOut.get(c.id) ?? c.fadeOutMs,
    };
  });
}

/** Tracks audible (not muted). Solo is unused for now. */
export function audibleTrackIds(tracks: Track[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tracks) {
    if (t.mute) continue;
    ids.add(t.id);
  }
  return ids;
}

export function clipToScheduled(
  clip: Clip,
  buffer: AudioBuffer,
  bpm: number,
  sampleRate: number,
  trackFx?: TrackFx,
): ScheduledClip {
  const startSample = ticksToSamples(asTick(clip.startTick), bpm, sampleRate);
  const durationSamples = ticksToSamples(
    asTick(clip.lengthTick),
    bpm,
    sampleRate,
  );
  const offsetSamples = msToSamples(clip.contentOffsetMs, sampleRate);
  let fadeInMs = clip.fadeInMs;
  let fadeOutMs = clip.fadeOutMs;
  let decayMs = 0;
  let sustain = 1;
  // Track ADSR raises one-shot fades; loops keep clip fades only (no re-trigger).
  if (trackFx && !clip.loopEnabled) {
    const fx = normalizeTrackFx(trackFx);
    fadeInMs = Math.max(fadeInMs, fx.attackMs);
    fadeOutMs = Math.max(fadeOutMs, fx.releaseMs);
    decayMs = fx.decayMs;
    sustain = fx.sustain;
  }
  const scheduled: ScheduledClip = {
    id: clip.id,
    trackId: clip.trackId,
    buffer,
    startSample,
    durationSamples,
    offsetSamples,
    gain: dbToGain(clip.gainDb),
    fadeInMs,
    fadeOutMs,
    decayMs,
    sustain,
    playbackRate: Math.pow(2, (clip.pitchSemitones ?? 0) / 12),
    loop: clip.loopEnabled,
  };
  if (
    clip.loopEnabled &&
    clip.loopLengthMs != null &&
    clip.loopLengthMs > 0 &&
    Number.isFinite(clip.loopLengthMs)
  ) {
    const startSec = Math.max(
      0,
      Math.min(buffer.duration - 0.001, clip.contentOffsetMs / 1000),
    );
    const endSec = Math.min(
      buffer.duration,
      startSec + clip.loopLengthMs / 1000,
    );
    scheduled.loopStartSec = startSec;
    scheduled.loopEndSec = Math.max(startSec + 0.001, endSec);
  }
  return scheduled;
}

/** Track bus config for TransportEngine (preamp / gain / pan / FX insert). */
export function trackToInsertConfig(
  tr: Track,
  bpm = 120,
  preampDb = 0,
): TrackInsertConfig {
  return {
    id: tr.id,
    gain: gainDbToLin(tr.gainDb),
    preamp: gainDbToLin(preampDb),
    pan: Number.isFinite(tr.pan) ? tr.pan : 0,
    fx: normalizeTrackFx(tr.fx),
    bpm,
  };
}
