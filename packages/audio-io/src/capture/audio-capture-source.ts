/**
 * Capture abstraction — swap getUserMedia for Capacitor native later (ADR-0001).
 *
 * Field fidelity: disable browser voice pipeline (AEC / NS / AGC). Many mobile
 * browsers ignore soft `false`; we prefer `{ exact: false }` then fall back.
 *
 * Never call getUserMedia({ audio: true }) first — that latches Android
 * MODE_IN_COMMUNICATION / iOS VoiceChat, and later AGC-off requests stay
 * compressed. USB class-compliant inputs must use deviceId exact.
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

type DeviceIdMode = "exact" | "ideal";

/** Chrome extra keys — ignored elsewhere; never `{ exact }` (OverconstrainedError). */
const CHROME_VOICE_OFF = {
  googEchoCancellation: false,
  googNoiseSuppression: false,
  googAutoGainControl: false,
  googAutoGainControl2: false,
  googHighpassFilter: false,
  googTypingNoiseDetection: false,
  voiceIsolation: false,
} as MediaTrackConstraints;

/** Prefer stereo when the device offers it; never force sampleRate. */
const FIELD_BASE: MediaTrackConstraints = {
  channelCount: 2,
  ...CHROME_VOICE_OFF,
};

/** Soft prefs — used when `exact: false` throws OverconstrainedError. */
const FIELD_SOFT: MediaTrackConstraints = {
  ...FIELD_BASE,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Strict off for voice processing. USB devices often omit `false` from
 * capabilities → OverconstrainedError; caller must fall back to FIELD_SOFT
 * without dropping the selected deviceId.
 */
const FIELD_EXACT: MediaTrackConstraints = {
  ...FIELD_BASE,
  echoCancellation: { exact: false },
  noiseSuppression: { exact: false },
  autoGainControl: { exact: false },
};

/**
 * Permission / enumerateDevices probe — same voice-off prefs as capture.
 * Do not use `{ audio: true }` (default AEC/NS/AGC latches the OS session).
 */
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
  mode: DeviceIdMode,
): MediaTrackConstraints {
  if (!deviceId) return base;
  return { ...base, deviceId: { [mode]: deviceId } };
}

/** Ordered getUserMedia attempts: processing-off first, selected device exact. */
export function fieldCaptureAttempts(
  deviceId?: string,
): MediaTrackConstraints[] {
  const id = deviceId?.trim() || undefined;
  const attempts: MediaTrackConstraints[] = [
    withDeviceId(FIELD_EXACT, id, "exact"),
    withDeviceId(FIELD_SOFT, id, "exact"),
  ];
  if (id) attempts.push(withDeviceId(FIELD_SOFT, id, "ideal"));
  return attempts;
}

export function captureTrackWarnings(
  settings: MediaTrackSettings,
  requestedDeviceId?: string,
): string[] {
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
  const want = requestedDeviceId?.trim();
  const got = settings.deviceId?.trim();
  if (want && got && got !== want) {
    warnings.push(
      "La source sélectionnée n'a pas été retenue — micro intégré probable (son compressé).",
    );
  }
  return warnings;
}

async function polishFieldTrack(track: MediaStreamTrack): Promise<void> {
  try {
    const hinted = track as MediaStreamTrack & { contentHint?: string };
    if ("contentHint" in hinted) hinted.contentHint = "music";
  } catch {
    /* Safari */
  }
  try {
    await track.applyConstraints(FIELD_SOFT);
  } catch {
    /* capabilities reject exact-off; initial constraints already asked */
  }
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
    const attempts = fieldCaptureAttempts(this.#deviceId);
    let stream: MediaStream | undefined;
    let lastErr: unknown;
    for (const audio of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        break;
      } catch (err) {
        lastErr = err;
        if (!isOverconstrained(err)) throw err;
      }
    }
    if (!stream) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("getUserMedia failed");
    }
    this.#stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error("No audio track from getUserMedia");
    }
    await polishFieldTrack(track);
    const settings = track.getSettings();
    return {
      stream,
      settings,
      warnings: captureTrackWarnings(settings, this.#deviceId),
    };
  }

  stop(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }
}
