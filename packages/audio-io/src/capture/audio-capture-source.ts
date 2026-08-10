/**
 * Capture abstraction — swap getUserMedia for Capacitor native later (ADR-0001).
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

export const FIELD_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48_000,
};

export class MediaStreamCaptureSource implements AudioCaptureSource {
  #stream: MediaStream | null = null;

  get stream(): MediaStream | null {
    return this.#stream;
  }

  async start(): Promise<CaptureConstraintsResult> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: FIELD_CONSTRAINTS,
    });
    this.#stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error("No audio track from getUserMedia");
    }
    const settings = track.getSettings();
    const warnings: string[] = [];
    if (settings.echoCancellation === true) {
      warnings.push("echoCancellation still on — browser ignored constraint");
    }
    if (settings.noiseSuppression === true) {
      warnings.push("noiseSuppression still on — browser ignored constraint");
    }
    if (settings.autoGainControl === true) {
      warnings.push("autoGainControl still on — browser ignored constraint");
    }
    return { stream, settings, warnings };
  }

  stop(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }
}
