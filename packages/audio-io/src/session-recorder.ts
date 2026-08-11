import {
  DEFAULT_CHANNEL_COUNT,
  RING_BUFFER_SECONDS_DEFAULT,
  createEntityId,
  nowIso,
  type GapMarker,
  type Session,
} from "@glane/core-model";
import {
  MediaStreamCaptureSource,
  type AudioCaptureSource,
} from "./capture/audio-capture-source.js";
import { RingBuffer, ringCapacityForSeconds } from "./capture/ring-buffer.js";
import { createCaptureWorkletUrl } from "./worklet/capture-processor.js";
import {
  estimateStorage,
  openSessionRecording,
  requestPersistentStorage,
  type OpfsWriteHandle,
} from "./opfs/session-store.js";

export type LevelMeter = { rms: number; peak: number };

export type SessionRecorderEvents = {
  onLevel?: (level: LevelMeter) => void;
  onGap?: (marker: GapMarker) => void;
  onWarning?: (message: string) => void;
  onState?: (state: "idle" | "recording" | "suspended") => void;
  /** PCM chunk after ring drain, before OPFS write (analysis tap). */
  onPcm?: (pcm: Float32Array, absoluteOffsetSamples: number) => void;
};

/**
 * Orchestrates capture → ring → OPFS drain + wake lock + gap markers (P0).
 */
export class SessionRecorder {
  readonly capture: AudioCaptureSource;
  #ctx: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #ring: RingBuffer | null = null;
  #opfs: OpfsWriteHandle | null = null;
  #drainTimer: number | null = null;
  #wakeLock: WakeLockSentinel | null = null;
  #session: Session | null = null;
  #events: SessionRecorderEvents;
  #startedAtMs = 0;
  #pcmScratch = new Float32Array(48_000);
  #absoluteOffsetSamples = 0;

  constructor(
    events: SessionRecorderEvents = {},
    capture: AudioCaptureSource = new MediaStreamCaptureSource(),
  ) {
    this.capture = capture;
    this.#events = events;
  }

  get session(): Session | null {
    return this.#session;
  }

  get ring(): RingBuffer | null {
    return this.#ring;
  }

  get audioContext(): AudioContext | null {
    return this.#ctx;
  }

  async start(projectId: string): Promise<Session> {
    await requestPersistentStorage();
    const storage = await estimateStorage();
    if (storage.quota > 0 && storage.usage / storage.quota > 0.85) {
      this.#events.onWarning?.("Espace de stockage > 85 % — purgez avant une longue prise.");
    }

    const { stream, warnings } = await this.capture.start();
    for (const w of warnings) this.#events.onWarning?.(w);

    // Native hardware rate — avoid mic→48 kHz browser resample on mobile.
    const ctx = new AudioContext({
      latencyHint: "interactive",
    });
    this.#ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const capacity = ringCapacityForSeconds(
      RING_BUFFER_SECONDS_DEFAULT,
      ctx.sampleRate,
    );
    const crossOriginIsolated =
      typeof globalThis !== "undefined" &&
      "crossOriginIsolated" in globalThis &&
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ===
        true;
    this.#ring = new RingBuffer(capacity, crossOriginIsolated);

    const url = createCaptureWorkletUrl();
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(ctx, "glane-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: {
        sab: this.#ring.sab,
        capacityFrames: capacity,
        shared: this.#ring.usesSharedMemory,
      },
    });
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type: string; rms?: number; peak?: number };
      if (data.type === "level" && data.rms != null && data.peak != null) {
        this.#events.onLevel?.({ rms: data.rms, peak: data.peak });
      }
    };
    this.#node = node;
    this.#source = ctx.createMediaStreamSource(stream);
    this.#source.connect(node);

    const id = createEntityId();
    this.#opfs = await openSessionRecording(id);
    this.#startedAtMs = performance.now();
    this.#absoluteOffsetSamples = 0;
    const now = nowIso();
    this.#session = {
      id,
      projectId,
      startedAt: now,
      endedAt: null,
      durationMs: 0,
      sampleRate: ctx.sampleRate,
      channelCount: DEFAULT_CHANNEL_COUNT,
      status: "recording",
      gapMarkers: [],
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };

    this.#drainTimer = window.setInterval(() => void this.#drain(), 1000);
    document.addEventListener("visibilitychange", this.#onVisibility);
    ctx.addEventListener("statechange", this.#onCtxState);

    try {
      this.#wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      this.#events.onWarning?.(
        "Wake Lock indisponible — laissez l'écran allumé pendant la prise.",
      );
    }

    this.#events.onState?.("recording");
    return this.#session;
  }

  async stop(): Promise<Session | null> {
    if (!this.#session || !this.#ctx) return null;
    if (this.#drainTimer != null) window.clearInterval(this.#drainTimer);
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#ctx.removeEventListener("statechange", this.#onCtxState);
    await this.#drain();

    this.#source?.disconnect();
    this.#node?.disconnect();
    this.capture.stop();
    await this.#wakeLock?.release().catch(() => undefined);
    this.#wakeLock = null;

    const durationMs = Math.round(performance.now() - this.#startedAtMs);
    if (this.#opfs) {
      await this.#opfs.close(
        this.#session.sampleRate,
        this.#session.channelCount,
      );
    }
    await this.#ctx.close();

    const ended = nowIso();
    this.#session = {
      ...this.#session,
      endedAt: ended,
      durationMs,
      status: "ready",
      updatedAt: ended,
    };
    this.#events.onState?.("idle");
    this.#ctx = null;
    this.#node = null;
    this.#source = null;
    return this.#session;
  }

  async #drain(): Promise<void> {
    if (!this.#ring || !this.#opfs) return;
    const n = this.#ring.read(this.#pcmScratch);
    if (n > 0) {
      const chunk = this.#pcmScratch.subarray(0, n);
      this.#events.onPcm?.(chunk, this.#absoluteOffsetSamples);
      this.#absoluteOffsetSamples += n;
      await this.#opfs.write(chunk);
    }
  }

  #onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      void this.#wakeLock?.release().catch(() => undefined);
      void navigator.wakeLock
        ?.request("screen")
        .then((l) => {
          this.#wakeLock = l;
        })
        .catch(() => undefined);
      void this.#ctx?.resume();
    }
  };

  #onCtxState = (): void => {
    if (this.#ctx?.state === "suspended" && this.#session) {
      const marker: GapMarker = {
        atMs: Math.round(performance.now() - this.#startedAtMs),
        reason: "audio_context_suspended",
      };
      this.#session.gapMarkers = [...this.#session.gapMarkers, marker];
      this.#events.onGap?.(marker);
      this.#events.onState?.("suspended");
      this.#events.onWarning?.(
        "AudioContext suspendu — coupure marquée dans la session.",
      );
    }
  };
}
