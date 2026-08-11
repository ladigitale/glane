/**
 * Capture abstraction — swap getUserMedia for Capacitor native later (ADR-0001).
 *
 * Field fidelity: disable browser voice pipeline (AEC / NS / AGC). Many mobile
 * browsers ignore soft `false`; we prefer `{ exact: false }` then fall back.
 */
export type CaptureConstraintsResult = {
  stream: MediaStream;
  settings: MediaTrackSettings;
  warnings: string[];
};

export interface AudioCaptureSource {
  start(): Promise<CaptureConstraintsResult>;
  stop(): void;
  readonly stream: MediaStream | null;
}

export type MediaStreamCaptureSourceOpts = {
  /** Preferred input; empty / omitted → browser default. */
  deviceId?: string;
};

/** Prefer mono; never force sampleRate (avoids extra browser resample). */
const FIELD_BASE: MediaTrackConstraints = {
  channelCount: 1,
};

/** Soft prefs — used when `exact: false` throws OverconstrainedError. */
const FIELD_SOFT: MediaTrackConstraints = {
  ...FIELD_BASE,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Strict off for voice processing. Chrome may also honor goog* keys via
 * the extended constraint bag (ignored by other browsers).
 */
const FIELD_EXACT: MediaTrackConstraints = {
  ...FIELD_BASE,
  echoCancellation: { exact: false },
  noiseSuppression: { exact: false },
  autoGainControl: { exact: false },
  ...( {
    googEchoCancellation: false,
    googNoiseSuppression: false,
    googAutoGainControl: false,
    googHighpassFilter: false,
  } as MediaTrackConstraints),
};

/** @deprecated Prefer MediaStreamCaptureSource — kept for callers/tests. */
export const FIELD_CONSTRAINTS: MediaTrackConstraints = FIELD_SOFT;

function isOverconstrained(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError")
  );
}

function withDeviceId(
  base: MediaTrackConstraints,
  deviceId: string | undefined,
): MediaTrackConstraints {
  if (!deviceId) return base;
  return { ...base, deviceId: { ideal: deviceId } };
}

export class MediaStreamCaptureSource implements AudioCaptureSource {
  #stream: MediaStream | null = null;
  #deviceId: string | undefined;

  constructor(opts: MediaStreamCaptureSourceOpts = {}) {
    this.#deviceId = opts.deviceId?.trim() || undefined;
  }

  get stream(): MediaStream | null {
    return this.#stream;
  }

  get deviceId(): string | undefined {
    return this.#deviceId;
  }

  setDeviceId(deviceId: string | undefined): void {
    this.#deviceId = deviceId?.trim() || undefined;
  }

  async start(): Promise<CaptureConstraintsResult> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: withDeviceId(FIELD_EXACT, this.#deviceId),
      });
    } catch (err) {
      if (!isOverconstrained(err)) throw err;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: withDeviceId(FIELD_SOFT, this.#deviceId),
      });
    }
    this.#stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error("No audio track from getUserMedia");
    }
    const settings = track.getSettings();
    const warnings: string[] = [];
    if (settings.echoCancellation === true) {
      warnings.push(
        "Annulation d'écho navigateur active — le son peut sonner « téléphone ».",
      );
    }
    if (settings.noiseSuppression === true) {
      warnings.push(
        "Réduction de bruit navigateur active — le fond sonore sera compressé.",
      );
    }
    if (settings.autoGainControl === true) {
      warnings.push(
        "AGC navigateur actif — dynamique écrasée (fréquent sur mobile).",
      );
    }
    return { stream, settings, warnings };
  }

  stop(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }
}
