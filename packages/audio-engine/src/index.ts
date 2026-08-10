import { asSampleIndex, type SampleIndex } from "@glane/core-model";
import {
  createTrackBus,
  disposeTrackBus,
  updateTrackBus,
  type TrackBus,
  type TrackInsertConfig,
} from "./track-insert";

export type { TrackBus, TrackInsertConfig } from "./track-insert";
export {
  bakeTrackFx,
  createTrackBus,
  disposeTrackBus,
  fxTailSamples,
  updateTrackBus,
  wireOfflineTrackBus,
} from "./track-insert";

export type Voice = {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  busy: boolean;
  clipId: string | null;
};

export type ScheduledClip = {
  id: string;
  /** Route voice through this track bus (gain / pan / FX). */
  trackId?: string;
  buffer: AudioBuffer;
  startSample: SampleIndex;
  durationSamples: SampleIndex;
  /** Offset into the buffer (slip / contentOffset). */
  offsetSamples?: SampleIndex;
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Playback rate (2^(semitones/12)). Default 1. */
  playbackRate?: number;
  /** Loop buffer to fill `durationSamples` (stops at clip end). */
  loop: boolean;
  /**
   * Editor / sustained audition: keep looping past clip duration until
   * transport stop (ignores duration on start; wrap does not re-arm).
   */
  loopSustain?: boolean;
  /** Buffer-relative loop points (seconds). Defaults to full buffer. */
  loopStartSec?: number;
  loopEndSec?: number;
};

const LOOKAHEAD_S = 0.15;
const TIMER_MS = 25;
const VOICE_POOL = 32;

/**
 * Single transport / scheduler (ADR-0005). Master clock = AudioContext.currentTime.
 */
export class TransportEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  #voices: Voice[] = [];
  #clips: ScheduledClip[] = [];
  #buses = new Map<string, TrackBus>();
  #playing = false;
  #loop = false;
  #loopStartSample = asSampleIndex(0);
  #loopEndSample = asSampleIndex(0);
  #originCtxTime = 0;
  #originSample = asSampleIndex(0);
  #timer: ReturnType<typeof setInterval> | null = null;
  #scheduledUntilSample = asSampleIndex(0);
  #muteInvalid = new Set<string>();
  #startedIds = new Set<string>();
  #lastPlayheadSample = asSampleIndex(0);

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (let i = 0; i < VOICE_POOL; i++) {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      this.#voices.push({ source: null, gain, busy: false, clipId: null });
    }
  }

  get playing(): boolean {
    return this.#playing;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Output latency compensation for playhead drawing. */
  get outputLatencySec(): number {
    const base = this.ctx.baseLatency ?? 0;
    const out =
      "outputLatency" in this.ctx
        ? ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ??
          0)
        : 0;
    return base + out;
  }

  /** Create / update per-track buses (gain, pan, light FX insert). */
  syncTrackBuses(configs: TrackInsertConfig[]): void {
    const keep = new Set(configs.map((c) => c.id));
    for (const [id, bus] of this.#buses) {
      if (!keep.has(id)) {
        disposeTrackBus(bus);
        this.#buses.delete(id);
      }
    }
    for (const config of configs) {
      const existing = this.#buses.get(config.id);
      if (existing) {
        updateTrackBus(existing, this.ctx, this.master, config);
      } else {
        this.#buses.set(
          config.id,
          createTrackBus(this.ctx, this.master, config),
        );
      }
    }
  }

  setTrackInsert(config: TrackInsertConfig): void {
    const existing = this.#buses.get(config.id);
    if (existing) {
      updateTrackBus(existing, this.ctx, this.master, config);
      return;
    }
    this.#buses.set(config.id, createTrackBus(this.ctx, this.master, config));
  }

  setClips(clips: ScheduledClip[]): void {
    this.#clips = clips;
    this.invalidate();
  }

  invalidate(): void {
    for (const v of this.#voices) {
      if (v.busy && v.clipId && this.#muteInvalid.has(v.clipId)) {
        this.#stopVoice(v);
      }
    }
    this.#scheduledUntilSample = this.playheadSample();
  }

  play(fromSample: SampleIndex = asSampleIndex(0)): void {
    void this.ctx.resume();
    this.#silenceAll();
    this.#originSample = fromSample;
    this.#originCtxTime = this.ctx.currentTime;
    this.#scheduledUntilSample = fromSample;
    this.#lastPlayheadSample = fromSample;
    this.#startedIds.clear();
    this.#playing = true;
    if (this.#timer == null) {
      this.#timer = setInterval(() => this.#schedule(), TIMER_MS);
    }
    this.#schedule();
  }

  /**
   * Move transport clock + re-arm clips from `fromSample`.
   * Silences current voices first — never stacks a second head.
   */
  seek(fromSample: SampleIndex): void {
    this.#silenceAll();
    this.#originSample = fromSample;
    this.#originCtxTime = this.ctx.currentTime;
    this.#scheduledUntilSample = fromSample;
    this.#lastPlayheadSample = fromSample;
    this.#startedIds.clear();
    if (this.#playing) this.#schedule();
  }

  stop(): void {
    this.#playing = false;
    if (this.#timer != null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#startedIds.clear();
    this.#silenceAll();
  }

  setLoop(enabled: boolean, start: SampleIndex, end: SampleIndex): void {
    this.#loop = enabled;
    this.#loopStartSample = start;
    this.#loopEndSample = end;
  }

  playheadSample(): SampleIndex {
    if (!this.#playing) return this.#originSample;
    const elapsed = this.ctx.currentTime - this.#originCtxTime;
    let s = this.#originSample + Math.floor(elapsed * this.sampleRate);
    if (this.#loop && this.#loopEndSample > this.#loopStartSample) {
      const len = this.#loopEndSample - this.#loopStartSample;
      const rel = (s - this.#loopStartSample) % len;
      s = this.#loopStartSample + (rel < 0 ? rel + len : rel);
    }
    return asSampleIndex(s);
  }

  /** Play a one-shot buffer immediately (library audition). */
  audition(buffer: AudioBuffer, fadeOutMs = 5): void {
    void this.ctx.resume();
    // One audition at a time — kill transport + other voices.
    this.stop();
    const v = this.#voices[0];
    if (!v) return;
    this.#stopVoice(v);
    this.#routeVoice(v, null);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(v.gain);
    v.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    v.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    const end = this.ctx.currentTime + buffer.duration;
    v.gain.gain.setValueAtTime(
      1,
      Math.max(this.ctx.currentTime, end - fadeOutMs / 1000),
    );
    v.gain.gain.linearRampToValueAtTime(0, end);
    src.start();
    v.source = src;
    v.busy = true;
    v.clipId = null;
    src.onended = () => {
      if (v.source !== src) return;
      v.busy = false;
      v.source = null;
    };
  }

  #silenceAll(): void {
    for (const v of this.#voices) this.#stopVoice(v);
  }

  #routeVoice(v: Voice, trackId: string | null | undefined): void {
    try {
      v.gain.disconnect();
    } catch {
      /* */
    }
    const bus = trackId ? this.#buses.get(trackId) : undefined;
    v.gain.connect(bus ? bus.input : this.master);
  }

  #schedule(): void {
    if (!this.#playing) return;
    const nowSample = this.playheadSample();
    // Transport loop wrap → re-arm clips that ended; sustain loops keep going
    if (
      this.#loop &&
      this.#loopEndSample > this.#loopStartSample &&
      nowSample + Math.floor(0.05 * this.sampleRate) < this.#lastPlayheadSample
    ) {
      const sustainIds = new Set(
        this.#clips.filter((c) => c.loopSustain).map((c) => c.id),
      );
      for (const id of [...this.#startedIds]) {
        if (!sustainIds.has(id)) this.#startedIds.delete(id);
      }
      this.#scheduledUntilSample = this.#loopStartSample;
      for (const v of this.#voices) {
        if (v.busy && v.clipId && !sustainIds.has(v.clipId)) this.#stopVoice(v);
      }
    }
    this.#lastPlayheadSample = nowSample;
    const ahead = asSampleIndex(
      nowSample + Math.floor(LOOKAHEAD_S * this.sampleRate),
    );
    for (const clip of this.#clips) {
      if (this.#startedIds.has(clip.id)) continue;
      const clipEnd = clip.startSample + clip.durationSamples;
      // Intersection with [nowSample, ahead) — not only clips whose start is inside
      if (clip.startSample >= ahead || clipEnd <= nowSample) continue;
      if (this.#startClip(clip)) this.#startedIds.add(clip.id);
    }
    this.#scheduledUntilSample = ahead;
  }

  #startClip(clip: ScheduledClip): boolean {
    const v = this.#voices.find((x) => !x.busy);
    if (!v) return false; // retry next tick

    const ph = this.playheadSample();
    const clipStart = clip.startSample;
    const clipEnd = clip.startSample + clip.durationSamples;
    // Outside clip timeline → skip permanently (caller marks started)
    if (ph >= clipEnd) return true;

    const intoClip = Math.max(0, ph - clipStart);
    const whenSample = clipStart + intoClip;
    const contentOffset = clip.offsetSamples ?? 0;
    let bufferOffsetSamples = contentOffset + intoClip;
    if (clip.loop) {
      // Wrap into the loopable region (full buffer, or loopStart/End if set)
      const ls = Math.max(
        0,
        Math.floor((clip.loopStartSec ?? 0) * this.sampleRate),
      );
      const le = Math.min(
        clip.buffer.length,
        Math.floor(
          (clip.loopEndSec ?? clip.buffer.duration) * this.sampleRate,
        ),
      );
      const loopLen = Math.max(1, le - ls);
      bufferOffsetSamples = ls + ((bufferOffsetSamples - ls) % loopLen);
      if (bufferOffsetSamples < ls) bufferOffsetSamples += loopLen;
    } else if (bufferOffsetSamples >= clip.buffer.length) {
      // Past buffer end → skip (no mute/gain hack for underrun)
      return true;
    }

    let remaining = clipEnd - whenSample;
    if (this.#loop && this.#loopEndSample > this.#loopStartSample) {
      remaining = Math.min(remaining, this.#loopEndSample - whenSample);
    }
    // Fill-loop: play for full timeline length (buffer repeats). One-shot /
    // sustain: never read past buffer end.
    const bufRemain = clip.buffer.length - bufferOffsetSamples;
    const durSamples =
      clip.loop && !clip.loopSustain
        ? remaining
        : Math.min(remaining, bufRemain);
    if (durSamples <= 0) return true;

    const src = this.ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = clip.loop;
    const rate = clip.playbackRate ?? 1;
    if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 1e-4) {
      src.playbackRate.value = rate;
    }
    this.#routeVoice(v, clip.trackId);
    src.connect(v.gain);
    const when =
      this.ctx.currentTime + (whenSample - ph) / this.sampleRate;
    const t = Math.max(when, this.ctx.currentTime);
    const offsetSec = bufferOffsetSamples / this.sampleRate;
    const dur = Math.max(0.001, durSamples / this.sampleRate);
    const gain = clip.gain;
    const fadeInS = Math.max(0, clip.fadeInMs / 1000);
    const intoSec = intoClip / this.sampleRate;

    v.gain.gain.cancelScheduledValues(t);
    if (intoSec >= fadeInS || fadeInS <= 0) {
      // Mid-clip past fade-in: full level immediately (do not re-duck volume)
      v.gain.gain.setValueAtTime(gain, t);
    } else {
      const startGain = gain * (intoSec / fadeInS);
      const remainFade = fadeInS - intoSec;
      v.gain.gain.setValueAtTime(startGain, t);
      v.gain.gain.linearRampToValueAtTime(gain, t + remainFade);
    }

    if (clip.loop) {
      const ls = Math.max(0, clip.loopStartSec ?? 0);
      const le = Math.min(
        clip.buffer.duration,
        clip.loopEndSec ?? clip.buffer.duration,
      );
      src.loopStart = ls;
      src.loopEnd = Math.max(ls + 0.001, le);
      const loopOffset = Math.max(ls, Math.min(offsetSec, le - 0.001));
      if (clip.loopSustain) {
        // Editor: hold until transport stop / wrap policy
        src.start(t, loopOffset);
      } else {
        // Montage: loop buffer only for the clip's timeline length
        if (clip.fadeOutMs > 0) {
          const fadeOutS = clip.fadeOutMs / 1000;
          const fadeStart = Math.max(t, t + dur - fadeOutS);
          v.gain.gain.setValueAtTime(gain, fadeStart);
          v.gain.gain.linearRampToValueAtTime(0, t + dur);
        }
        src.start(t, loopOffset, dur);
      }
    } else {
      if (clip.fadeOutMs > 0) {
        const fadeOutS = clip.fadeOutMs / 1000;
        const fadeStart = Math.max(t, t + dur - fadeOutS);
        v.gain.gain.setValueAtTime(gain, fadeStart);
        v.gain.gain.linearRampToValueAtTime(0, t + dur);
      }
      src.start(t, offsetSec, dur);
    }

    v.source = src;
    v.busy = true;
    v.clipId = clip.id;
    // Guard: a superseded source must not free the voice mid-new-clip.
    src.onended = () => {
      if (v.source !== src) return;
      v.busy = false;
      v.source = null;
      v.clipId = null;
    };
    return true;
  }

  /**
   * Hard-stop a voice: clear onended, disconnect, free slot immediately.
   * Soft ramp without disconnect left zombie BufferSources stacking on seek/play.
   */
  #stopVoice(v: Voice): void {
    const src = v.source;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(0, t);
    if (src) {
      src.onended = null;
      try {
        src.stop(t);
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* */
      }
    }
    v.source = null;
    v.busy = false;
    v.clipId = null;
  }

  async decodeArrayBuffer(ab: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(ab.slice(0));
  }

  async renderOffline(
    clips: ScheduledClip[],
    durationSamples: number,
    tracks: TrackInsertConfig[] = [],
  ): Promise<AudioBuffer> {
    const sr = this.sampleRate;
    const length = Math.max(1, Math.floor(durationSamples));
    const offline = new OfflineAudioContext(2, length, sr);
    const busIn = new Map<string, GainNode>();
    for (const t of tracks) {
      busIn.set(t.id, createTrackBus(offline, offline.destination, t).input);
    }

    for (const clip of clips) {
      const contentOffset = clip.offsetSamples ?? 0;
      const bufRemain = clip.buffer.length - contentOffset;
      const durSamples = Math.min(clip.durationSamples, Math.max(0, bufRemain));
      if (durSamples <= 0) continue;

      const src = offline.createBufferSource();
      src.buffer = clip.buffer;
      const rate = clip.playbackRate ?? 1;
      if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 1e-4) {
        src.playbackRate.value = rate;
      }
      const g = offline.createGain();
      src.connect(g);
      const dest =
        (clip.trackId && busIn.get(clip.trackId)) || offline.destination;
      g.connect(dest);

      const t = clip.startSample / sr;
      const dur = Math.max(0.001, durSamples / sr);
      const gain = clip.gain;
      const fadeInS = Math.max(0, clip.fadeInMs / 1000);
      const fadeOutS = Math.max(0, clip.fadeOutMs / 1000);

      g.gain.setValueAtTime(0, t);
      if (fadeInS > 0) {
        g.gain.linearRampToValueAtTime(gain, t + Math.min(fadeInS, dur));
      } else {
        g.gain.setValueAtTime(gain, t);
      }
      if (fadeOutS > 0 && dur > fadeOutS) {
        const fadeStart = t + dur - fadeOutS;
        g.gain.setValueAtTime(gain, fadeStart);
        g.gain.linearRampToValueAtTime(0, t + dur);
      } else if (fadeOutS > 0) {
        g.gain.linearRampToValueAtTime(0, t + dur);
      }

      const offsetSec = contentOffset / sr;
      src.start(t, offsetSec, dur);
    }
    return offline.startRendering();
  }
}
