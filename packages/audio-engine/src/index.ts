import { asSampleIndex, type SampleIndex, type TrackFx } from "@glane/core-model";
import {
  createMasterFxChain,
  createTrackBus,
  disposeTrackBus,
  fxTailSamples,
  scheduleGainAdsr,
  updateTrackBus,
  type MasterFxChain,
  type TrackBus,
  type TrackInsertConfig,
} from "./track-insert";
import {
  TAPE_SCRUB_CATCHUP_S,
  TAPE_SCRUB_DRIFT_SAMPLES,
  TAPE_SCRUB_FADE_IN_S,
  TAPE_SCRUB_FADE_OUT_S,
  TAPE_SCRUB_RATE_EPS,
  TAPE_SCRUB_SNAP_SAMPLES,
  scrubRateToTarget,
  type TapeScrubVoice,
} from "./tape-scrub";

export type { TrackBus, TrackInsertConfig, MasterFxChain } from "./track-insert";
export {
  bakeTrackFx,
  createMasterFxChain,
  createTrackBus,
  disposeTrackBus,
  fxTailSamples,
  scheduleGainAdsr,
  updateTrackBus,
  wireOfflineTrackBus,
} from "./track-insert";
export {
  scrubRateToTarget,
  TAPE_SCRUB_CATCHUP_S,
  TAPE_SCRUB_DRIFT_SAMPLES,
  TAPE_SCRUB_FADE_IN_S,
  TAPE_SCRUB_FADE_OUT_S,
  TAPE_SCRUB_RATE_EPS,
  TAPE_SCRUB_SNAP_SAMPLES,
  type TapeScrubVoice,
} from "./tape-scrub";

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
  /** Track ADSR decay (ms). 0 = skip. */
  decayMs?: number;
  /** Track ADSR sustain 0–1. Default 1. */
  sustain?: number;
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

const LOOKAHEAD_S = 0.5;
const TIMER_MS = 25;
const VOICE_POOL = 32;

/**
 * Single transport / scheduler (ADR-0005). Master clock = AudioContext.currentTime.
 */
export class TransportEngine {
  readonly ctx: AudioContext;
  /** Master volume (after mix + master FX). */
  readonly master: GainNode;
  /** Tap on the master bus for a VU (does not alter the signal). */
  readonly analyser: AnalyserNode;
  #mix: MasterFxChain;
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
  /** Vinyl scrub overrides transport voices until {@link endTapeScrub}. */
  #tapeMode = false;
  #tape = new Map<
    string,
    {
      source: AudioBufferSourceNode;
      gain: GainNode;
      buffer: AudioBuffer;
      originSample: number;
      originCtxTime: number;
      rate: number;
      targetGain: number;
      loopStartSample: number | null;
      loopEndSample: number | null;
    }
  >();
  /** Voices fading out after a soft replace / end (avoid hard cuts). */
  #tapeDying: Array<{
    source: AudioBufferSourceNode;
    gain: GainNode;
    stopAt: number;
  }> = [];

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.35;
    this.#mix = createMasterFxChain(this.ctx, this.master);
    this.master.connect(this.analyser);
    this.master.connect(this.ctx.destination);
    for (let i = 0; i < VOICE_POOL; i++) {
      const gain = this.ctx.createGain();
      gain.connect(this.#mix.input);
      this.#voices.push({ source: null, gain, busy: false, clipId: null });
    }
  }

  get playing(): boolean {
    return this.#playing;
  }

  get tapeScrubbing(): boolean {
    return this.#tapeMode;
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

  /** Two serial wet inserts on the master bus (before volume). */
  setMasterFx(fx0: TrackFx, fx1: TrackFx, bpm?: number): void {
    this.#mix.apply(fx0, fx1, bpm);
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
        updateTrackBus(existing, this.ctx, this.#mix.input, config);
      } else {
        this.#buses.set(
          config.id,
          createTrackBus(this.ctx, this.#mix.input, config),
        );
      }
    }
  }

  setTrackInsert(config: TrackInsertConfig): void {
    const existing = this.#buses.get(config.id);
    if (existing) {
      updateTrackBus(existing, this.ctx, this.#mix.input, config);
      return;
    }
    this.#buses.set(
      config.id,
      createTrackBus(this.ctx, this.#mix.input, config),
    );
  }

  setClips(clips: ScheduledClip[]): void {
    this.#clips = clips;
    this.invalidate();
    if (this.#playing) this.#schedule();
  }

  /** Arm clips entering the lookahead window. Safe from rAF (main-thread timer backup). */
  scheduleAhead(): void {
    this.#schedule();
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
    this.#stopAllTapeHard();
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
    if (this.#tapeMode) {
      this.#originSample = fromSample;
      this.#originCtxTime = this.ctx.currentTime;
      this.#scheduledUntilSample = fromSample;
      this.#lastPlayheadSample = fromSample;
      this.#startedIds.clear();
      return;
    }
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
    this.#stopAllTapeHard();
    this.#silenceAll();
  }

  /**
   * Vinyl / tape scrub toward each voice's UI target sample.
   * Rate = distance-to-target / catch-up window (no max clamp) — not mouse velocity.
   * Silences transport voices while active; call {@link endTapeScrub} on pointer up.
   */
  tapeScrub(voices: TapeScrubVoice[]): void {
    void this.ctx.resume();
    if (!this.#tapeMode) {
      this.#tapeMode = true;
      this.#silenceAll();
    }
    this.#reapDyingTape();

    const wanted = new Set(voices.map((v) => v.key));
    for (const key of [...this.#tape.keys()]) {
      if (!wanted.has(key)) this.#releaseTapeVoice(key, true);
    }

    const now = this.ctx.currentTime;
    const sr = this.sampleRate;
    for (const v of voices) {
      const pitch =
        Number.isFinite(v.pitchRate) && (v.pitchRate as number) > 0
          ? (v.pitchRate as number)
          : 1;
      const target = Math.max(
        0,
        Math.min(v.buffer.length - 1, Math.floor(v.sample)),
      );
      const gain = Number.isFinite(v.gain) ? Math.max(0, v.gain as number) : 1;
      const existing = this.#tape.get(v.key);

      let audioPos = target;
      if (existing && existing.buffer === v.buffer) {
        audioPos =
          existing.originSample +
          (now - existing.originCtxTime) * sr * existing.rate;
      }

      const error = target - audioPos;
      let eff = scrubRateToTarget(error, sr, TAPE_SCRUB_CATCHUP_S) * pitch;
      if (!Number.isFinite(eff)) eff = 0;

      // Hard resync only if the source is gone / buffer swapped / absurd desync.
      let resync = !existing || existing.buffer !== v.buffer;
      if (existing && !resync) {
        if (Math.abs(error) > TAPE_SCRUB_DRIFT_SAMPLES) resync = true;
      }

      if (resync) {
        this.#releaseTapeVoice(v.key, true);
        // Land on target; rAF servo accelerates when the UI target moves away.
        this.#startTapeVoice(v, target, 0, gain);
        continue;
      }

      if (!existing) continue;

      if (Math.abs(eff) < TAPE_SCRUB_RATE_EPS) {
        try {
          existing.source.playbackRate.setValueAtTime(0, now);
        } catch {
          /* */
        }
        // Snap bookkeeping to the UI target — arrived.
        existing.originSample = target;
        existing.originCtxTime = now;
        existing.rate = 0;
        continue;
      }

      try {
        existing.source.playbackRate.setValueAtTime(eff, now);
      } catch {
        existing.source.playbackRate.value = eff;
      }
      const liveGain = existing.gain.gain.value;
      if (
        Math.abs(existing.targetGain - gain) > 1e-3 ||
        liveGain < gain * 0.5
      ) {
        const gParam = existing.gain.gain;
        gParam.cancelScheduledValues(now);
        gParam.setValueAtTime(Math.max(0, liveGain), now);
        gParam.linearRampToValueAtTime(gain, now + TAPE_SCRUB_FADE_IN_S);
        existing.targetGain = gain;
      }
      existing.originSample = audioPos;
      existing.originCtxTime = now;
      existing.rate = eff;
    }
  }

  /**
   * Drive tape at an explicit signed rate (gyro / turntable).
   * Advances through the buffer; optional loop region on the voice.
   * No max clamp. Call {@link endTapeScrub} when done.
   */
  tapeSpin(voices: TapeScrubVoice[], rate: number): void {
    void this.ctx.resume();
    if (!this.#tapeMode) {
      this.#tapeMode = true;
      this.#silenceAll();
    }
    this.#reapDyingTape();

    let scrubRate = Number.isFinite(rate) ? rate : 0;
    const wanted = new Set(voices.map((v) => v.key));
    for (const key of [...this.#tape.keys()]) {
      if (!wanted.has(key)) this.#releaseTapeVoice(key, true);
    }

    const now = this.ctx.currentTime;
    const sr = this.sampleRate;
    for (const v of voices) {
      const pitch =
        Number.isFinite(v.pitchRate) && (v.pitchRate as number) > 0
          ? (v.pitchRate as number)
          : 1;
      let eff = scrubRate * pitch;
      if (!Number.isFinite(eff)) eff = 0;
      const sample = Math.max(
        0,
        Math.min(v.buffer.length - 1, Math.floor(v.sample)),
      );
      const gain = Number.isFinite(v.gain) ? Math.max(0, v.gain as number) : 1;
      const existing = this.#tape.get(v.key);

      if (!existing || existing.buffer !== v.buffer) {
        this.#releaseTapeVoice(v.key, true);
        this.#startTapeVoice(v, sample, Math.abs(eff) < TAPE_SCRUB_RATE_EPS ? 0 : eff, gain);
        continue;
      }

      const audioPos =
        existing.originSample +
        (now - existing.originCtxTime) * sr * existing.rate;

      // UI seek during spin — hard land on the new playhead.
      if (Math.abs(audioPos - sample) > TAPE_SCRUB_DRIFT_SAMPLES / 6) {
        this.#releaseTapeVoice(v.key, true);
        this.#startTapeVoice(
          v,
          sample,
          Math.abs(eff) < TAPE_SCRUB_RATE_EPS ? 0 : eff,
          gain,
        );
        continue;
      }

      if (Math.abs(eff) < TAPE_SCRUB_RATE_EPS) {
        try {
          existing.source.playbackRate.setValueAtTime(0, now);
        } catch {
          /* */
        }
        existing.originSample = audioPos;
        existing.originCtxTime = now;
        existing.rate = 0;
        continue;
      }

      try {
        existing.source.playbackRate.setValueAtTime(eff, now);
      } catch {
        existing.source.playbackRate.value = eff;
      }
      const liveGain = existing.gain.gain.value;
      if (
        Math.abs(existing.targetGain - gain) > 1e-3 ||
        liveGain < gain * 0.5
      ) {
        const gParam = existing.gain.gain;
        gParam.cancelScheduledValues(now);
        gParam.setValueAtTime(Math.max(0, liveGain), now);
        gParam.linearRampToValueAtTime(gain, now + TAPE_SCRUB_FADE_IN_S);
        existing.targetGain = gain;
      }
      existing.originSample = audioPos;
      existing.originCtxTime = now;
      existing.rate = eff;
    }
  }

  /** Estimated buffer-relative playhead for an active tape voice. */
  tapeAudioSample(key: string): number | null {
    const node = this.#tape.get(key);
    if (!node) return null;
    const now = this.ctx.currentTime;
    let s =
      node.originSample +
      (now - node.originCtxTime) * this.sampleRate * node.rate;
    const ls = node.loopStartSample;
    const le = node.loopEndSample;
    if (ls != null && le != null && le > ls) {
      const len = le - ls;
      let rel = (s - ls) % len;
      if (rel < 0) rel += len;
      s = ls + rel;
    } else {
      s = Math.max(0, Math.min(node.buffer.length - 1, s));
    }
    return s;
  }

  endTapeScrub(): void {
    if (!this.#tapeMode && this.#tape.size === 0 && this.#tapeDying.length === 0) {
      return;
    }
    for (const key of [...this.#tape.keys()]) this.#releaseTapeVoice(key, true);
    this.#tapeMode = false;
    // Keep dying fades; reap on next scrub / stop.
    if (this.#playing) this.#schedule();
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

  /**
   * Play a one-shot buffer immediately (library audition).
   * `onEnded` runs when the buffer finishes naturally — not when superseded
   * by another audition / stop() (those clear onended).
   */
  audition(
    buffer: AudioBuffer,
    fadeOutMs = 5,
    onEnded?: () => void,
  ): void {
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
      onEnded?.();
    };
  }

  #startTapeVoice(
    v: TapeScrubVoice,
    sample: number,
    rate: number,
    gain: number,
  ): void {
    const g = this.ctx.createGain();
    this.#routeTapeGain(g, v.trackId);
    const now = this.ctx.currentTime;
    g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + TAPE_SCRUB_FADE_IN_S);
    const src = this.ctx.createBufferSource();
    src.buffer = v.buffer;
    src.playbackRate.value = rate === 0 ? 0 : rate;
    src.connect(g);

    let loopStartSample: number | null = null;
    let loopEndSample: number | null = null;
    if (
      v.loopStartSec != null &&
      v.loopEndSec != null &&
      v.loopEndSec > v.loopStartSec
    ) {
      const ls = Math.max(0, v.loopStartSec);
      const le = Math.min(v.buffer.duration, v.loopEndSec);
      if (le > ls + 0.001) {
        src.loop = true;
        src.loopStart = ls;
        src.loopEnd = le;
        loopStartSample = Math.floor(ls * this.sampleRate);
        loopEndSample = Math.floor(le * this.sampleRate);
      }
    }

    let offsetSec = sample / this.sampleRate;
    if (src.loop) {
      offsetSec = Math.max(
        src.loopStart,
        Math.min(src.loopEnd - 0.001, offsetSec),
      );
    }
    // No duration cap — pointer-up / resync stops.
    try {
      src.start(0, offsetSec);
    } catch {
      try {
        g.disconnect();
      } catch {
        /* */
      }
      return;
    }
    this.#tape.set(v.key, {
      source: src,
      gain: g,
      buffer: v.buffer,
      originSample: sample,
      originCtxTime: now,
      rate,
      targetGain: gain,
      loopStartSample,
      loopEndSample,
    });
    src.onended = () => {
      const cur = this.#tape.get(v.key);
      if (cur?.source !== src) return;
      this.#tape.delete(v.key);
      try {
        src.disconnect();
      } catch {
        /* */
      }
      try {
        g.disconnect();
      } catch {
        /* */
      }
    };
  }

  #routeTapeGain(gain: GainNode, trackId: string | null | undefined): void {
    const bus = trackId ? this.#buses.get(trackId) : undefined;
    gain.connect(bus ? bus.input : this.#mix.input);
  }

  /** Soft-release active tape voice (crossfade out) or hard cut. */
  #releaseTapeVoice(key: string, fade: boolean): void {
    const node = this.#tape.get(key);
    if (!node) return;
    this.#tape.delete(key);
    node.source.onended = null;
    const t = this.ctx.currentTime;
    if (!fade) {
      node.gain.gain.cancelScheduledValues(t);
      node.gain.gain.setValueAtTime(0, t);
      try {
        node.source.stop(t);
      } catch {
        /* */
      }
      try {
        node.source.disconnect();
      } catch {
        /* */
      }
      try {
        node.gain.disconnect();
      } catch {
        /* */
      }
      return;
    }
    const cur = Math.max(0, node.gain.gain.value);
    node.gain.gain.cancelScheduledValues(t);
    node.gain.gain.setValueAtTime(cur, t);
    node.gain.gain.linearRampToValueAtTime(0, t + TAPE_SCRUB_FADE_OUT_S);
    const stopAt = t + TAPE_SCRUB_FADE_OUT_S + 0.01;
    try {
      node.source.stop(stopAt);
    } catch {
      /* */
    }
    this.#tapeDying.push({ source: node.source, gain: node.gain, stopAt });
    // Cap overlap during frantic scrub — hard-kill the oldest fades.
    while (this.#tapeDying.length > 6) {
      const old = this.#tapeDying.shift();
      if (!old) break;
      try {
        old.source.onended = null;
        old.source.stop(0);
      } catch {
        /* */
      }
      try {
        old.source.disconnect();
      } catch {
        /* */
      }
      try {
        old.gain.disconnect();
      } catch {
        /* */
      }
    }
  }

  #reapDyingTape(): void {
    const now = this.ctx.currentTime;
    if (this.#tapeDying.length === 0) return;
    const keep: Array<{
      source: AudioBufferSourceNode;
      gain: GainNode;
      stopAt: number;
    }> = [];
    for (const d of this.#tapeDying) {
      if (now < d.stopAt) {
        keep.push(d);
        continue;
      }
      try {
        d.source.disconnect();
      } catch {
        /* */
      }
      try {
        d.gain.disconnect();
      } catch {
        /* */
      }
    }
    this.#tapeDying = keep;
  }

  #stopAllTapeHard(): void {
    for (const key of [...this.#tape.keys()]) this.#releaseTapeVoice(key, false);
    for (const d of this.#tapeDying) {
      try {
        d.source.onended = null;
        d.source.stop(0);
      } catch {
        /* */
      }
      try {
        d.source.disconnect();
      } catch {
        /* */
      }
      try {
        d.gain.disconnect();
      } catch {
        /* */
      }
    }
    this.#tapeDying = [];
    this.#tapeMode = false;
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
    v.gain.connect(bus ? bus.input : this.#mix.input);
  }

  #schedule(): void {
    if (!this.#playing || this.#tapeMode) return;
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
    const intoSec = intoClip / this.sampleRate;
    const clipDur = intoSec + dur;
    scheduleGainAdsr(v.gain.gain, t, clipDur, intoSec, gain, {
      attackMs: clip.fadeInMs,
      decayMs: clip.decayMs ?? 0,
      sustain: clip.sustain ?? 1,
      releaseMs: clip.fadeOutMs,
    });

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
        src.start(t, loopOffset, dur);
      }
    } else {
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
    masterFx: [TrackFx, TrackFx] | TrackFx[] = [],
    bpm = 120,
  ): Promise<AudioBuffer> {
    const sr = this.sampleRate;
    const fx0 = masterFx[0];
    const fx1 = masterFx[1];
    const tail = Math.max(
      fx0 ? fxTailSamples(fx0, sr, bpm) : 0,
      fx1 ? fxTailSamples(fx1, sr, bpm) : 0,
    );
    const length = Math.max(1, Math.floor(durationSamples) + tail);
    const offline = new OfflineAudioContext(2, length, sr);
    const chain = createMasterFxChain(
      offline,
      offline.destination,
      fx0,
      fx1,
      bpm,
    );
    const busIn = new Map<string, GainNode>();
    for (const t of tracks) {
      busIn.set(t.id, createTrackBus(offline, chain.input, t).input);
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
        (clip.trackId && busIn.get(clip.trackId)) || chain.input;
      g.connect(dest);

      const t = clip.startSample / sr;
      const dur = Math.max(0.001, durSamples / sr);
      const gain = clip.gain;
      scheduleGainAdsr(g.gain, t, dur, 0, gain, {
        attackMs: clip.fadeInMs,
        decayMs: clip.decayMs ?? 0,
        sustain: clip.sustain ?? 1,
        releaseMs: clip.fadeOutMs,
      });

      const offsetSec = contentOffset / sr;
      src.start(t, offsetSec, dur);
    }
    return offline.startRendering();
  }
}
