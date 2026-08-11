import {
  DEFAULT_CHANNEL_COUNT,
  DEFAULT_SAMPLE_RATE,
  RING_BUFFER_SECONDS_DEFAULT,
  createEntityId,
  nowIso,
  type Session,
} from "@glane/core-model";
import {
  MediaStreamCaptureSource,
  type AudioCaptureSource,
} from "./capture/audio-capture-source.js";
import { RingBuffer, ringCapacityForSeconds } from "./capture/ring-buffer.js";
import { RollingPcmWindow } from "./capture/rolling-window.js";
import { createCaptureWorkletUrl } from "./worklet/capture-processor.js";
import { estimateStorage, requestPersistentStorage } from "./opfs/session-store.js";

export type LevelMeter = { rms: number; peak: number };

export type LiveCaptureEvents = {
  onLevel?: (level: LevelMeter) => void;
  onWarning?: (message: string) => void;
  onState?: (state: "idle" | "listening" | "suspended") => void;
  /** Fired after each ring drain into the rolling window. */
  onWindow?: (window: Float32Array, sampleRate: number) => void;
};

/** Gentle field-leveling compressor (not browser AGC). */
const AUTO_GAIN = {
  threshold: -28,
  knee: 18,
  ratio: 3,
  attack: 0.003,
  release: 0.25,
  /** Linear makeup after compressor (~+5 dB). */
  makeup: 1.8,
} as const;

export type LiveCaptureOpts = {
  windowSeconds?: number;
  capture?: AudioCaptureSource;
  /** Soft compressor + makeup in the capture graph (default false). */
  autoGain?: boolean;
  /** Preferred getUserMedia input (ignored if `capture` is injected). */
  deviceId?: string;
};

/**
 * Long-running capture: mic → (optional compressor) → ring → rolling RAM window (~10 s).
 * Does **not** write a session master to OPFS.
 */
export class LiveCapture {
  readonly capture: AudioCaptureSource;
  #ctx: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #compressor: DynamicsCompressorNode | null = null;
  #makeup: GainNode | null = null;
  #autoGain = false;
  #ring: RingBuffer | null = null;
  #window: RollingPcmWindow | null = null;
  #drainTimer: number | null = null;
  #wakeLock: WakeLockSentinel | null = null;
  #hunt: Session | null = null;
  #events: LiveCaptureEvents;
  #startedAtMs = 0;
  #pcmScratch = new Float32Array(48_000);
  #windowSeconds: number;

  constructor(events: LiveCaptureEvents = {}, opts: LiveCaptureOpts = {}) {
    this.capture =
      opts.capture ?? new MediaStreamCaptureSource({ deviceId: opts.deviceId });
    this.#events = events;
    this.#windowSeconds = opts.windowSeconds ?? RING_BUFFER_SECONDS_DEFAULT;
    this.#autoGain = opts.autoGain ?? false;
  }

  get autoGain(): boolean {
    return this.#autoGain;
  }

  get hunt(): Session | null {
    return this.#hunt;
  }

  get ring(): RingBuffer | null {
    return this.#ring;
  }

  get rolling(): RollingPcmWindow | null {
    return this.#window;
  }

  get audioContext(): AudioContext | null {
    return this.#ctx;
  }

  get sampleRate(): number {
    return this.#ctx?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  async start(title: string, projectId: string): Promise<Session> {
    await requestPersistentStorage();
    const storage = await estimateStorage();
    if (storage.quota > 0 && storage.usage / storage.quota > 0.85) {
      this.#events.onWarning?.(
        "Espace de stockage > 85 % — purgez avant une longue chasse.",
      );
    }

    const { stream, warnings } = await this.capture.start();
    for (const w of warnings) this.#events.onWarning?.(w);

    try {
      // Native hardware rate — avoid mic→48 kHz browser resample on mobile.
      const ctx = new AudioContext({
        latencyHint: "interactive",
      });
      this.#ctx = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const capacity = ringCapacityForSeconds(this.#windowSeconds, ctx.sampleRate);
      const crossOriginIsolated =
        typeof globalThis !== "undefined" &&
        "crossOriginIsolated" in globalThis &&
        (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ===
          true;
      this.#ring = new RingBuffer(capacity, crossOriginIsolated);
      this.#window = new RollingPcmWindow(capacity);

      if (!this.#ring.usesSharedMemory) {
        this.#events.onWarning?.(
          "SharedArrayBuffer indisponible — ouvrez via le serveur Vite (localhost) pour une capture fiable.",
        );
      }

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

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = AUTO_GAIN.threshold;
      compressor.knee.value = AUTO_GAIN.knee;
      compressor.ratio.value = AUTO_GAIN.ratio;
      compressor.attack.value = AUTO_GAIN.attack;
      compressor.release.value = AUTO_GAIN.release;
      const makeup = ctx.createGain();
      makeup.gain.value = AUTO_GAIN.makeup;
      this.#compressor = compressor;
      this.#makeup = makeup;
      this.#wireGraph();

      const id = createEntityId();
      this.#startedAtMs = performance.now();
      const now = nowIso();
      this.#hunt = {
        id,
        projectId,
        startedAt: now,
        endedAt: null,
        durationMs: 0,
        sampleRate: ctx.sampleRate,
        channelCount: DEFAULT_CHANNEL_COUNT,
        title: title.trim() || "Capture",
        status: "recording",
        gapMarkers: [],
        createdAt: now,
        updatedAt: now,
        revision: 0,
      };

      this.#drainTimer = window.setInterval(() => this.#drain(), 50);
      document.addEventListener("visibilitychange", this.#onVisibility);
      ctx.addEventListener("statechange", this.#onCtxState);

      try {
        this.#wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        this.#events.onWarning?.(
          "Wake Lock indisponible — laissez l'écran allumé.",
        );
      }

      this.#events.onState?.("listening");
      return this.#hunt;
    } catch (err) {
      this.capture.stop();
      this.#teardownGraph();
      const ctx = this.#ctx;
      this.#ctx = null;
      this.#node = null;
      this.#source = null;
      this.#compressor = null;
      this.#makeup = null;
      this.#ring = null;
      this.#window = null;
      void ctx?.close().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Soft compressor + makeup on the capture path.
   * Safe to call while listening (rewires without restarting the mic).
   */
  setAutoGain(enabled: boolean): void {
    if (this.#autoGain === enabled) return;
    this.#autoGain = enabled;
    if (this.#source && this.#node) this.#wireGraph();
  }

  #wireGraph(): void {
    const source = this.#source;
    const node = this.#node;
    const compressor = this.#compressor;
    const makeup = this.#makeup;
    if (!source || !node || !compressor || !makeup) return;

    try {
      source.disconnect();
    } catch {
      /* not connected */
    }
    try {
      compressor.disconnect();
    } catch {
      /* not connected */
    }
    try {
      makeup.disconnect();
    } catch {
      /* not connected */
    }

    if (this.#autoGain) {
      source.connect(compressor);
      compressor.connect(makeup);
      makeup.connect(node);
    } else {
      source.connect(node);
    }
  }

  #teardownGraph(): void {
    try {
      this.#source?.disconnect();
    } catch {
      /* */
    }
    try {
      this.#compressor?.disconnect();
    } catch {
      /* */
    }
    try {
      this.#makeup?.disconnect();
    } catch {
      /* */
    }
    try {
      this.#node?.disconnect();
    } catch {
      /* */
    }
  }

  async stop(): Promise<Session | null> {
    if (!this.#hunt || !this.#ctx) return null;
    if (this.#drainTimer != null) window.clearInterval(this.#drainTimer);
    this.#drainTimer = null;
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#ctx.removeEventListener("statechange", this.#onCtxState);

    this.#teardownGraph();
    this.capture.stop();

    const durationMs = Math.round(performance.now() - this.#startedAtMs);
    const ended = nowIso();
    this.#hunt = {
      ...this.#hunt,
      endedAt: ended,
      durationMs,
      status: "ready",
      updatedAt: ended,
    };
    this.#events.onState?.("idle");

    const ctx = this.#ctx;
    const wake = this.#wakeLock;
    this.#wakeLock = null;
    this.#ctx = null;
    this.#node = null;
    this.#source = null;
    this.#compressor = null;
    this.#makeup = null;
    this.#ring = null;
    this.#window = null;

    // Non-blocking teardown — awaiting close() was freezing the stop button.
    void wake?.release().catch(() => undefined);
    void ctx.close().catch(() => undefined);

    return this.#hunt;
  }

  #drain(): void {
    if (!this.#ring || !this.#window) return;
    const n = this.#ring.read(this.#pcmScratch);
    if (n <= 0) return;
    const chunk = this.#pcmScratch.subarray(0, n);
    this.#window.push(chunk);
    const onWindow = this.#events.onWindow;
    if (!onWindow) return;
    // Only copy when a listener asks — capture UI uses snapshotRecent on its tick.
    onWindow(
      this.#window.snapshotRecent(
        Math.min(this.#window.filled, Math.floor(this.sampleRate * 1.5)),
      ),
      this.sampleRate,
    );
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
    if (this.#ctx?.state === "suspended") {
      this.#events.onState?.("suspended");
      this.#events.onWarning?.("AudioContext suspendu.");
    }
  };
}
