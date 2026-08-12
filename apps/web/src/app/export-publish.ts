/**
 * SoundCloud OAuth (via Glane API) + client upload; Bandcamp assisted publish.
 */
import { audioExport } from "@glane/audio-io";
import type {
  TransportEngine,
  ScheduledClip,
  TrackInsertConfig,
} from "@glane/audio-engine";
import { asSampleIndex, ticksToSamples, asTick, type Project } from "@glane/core-model";
import { auth } from "./auth.js";

export type SoundCloudStatus = {
  available: boolean;
  connected: boolean;
  displayName: string | null;
};

export type BounceResult = {
  buffer: AudioBuffer;
  wav: Blob;
  /** Null until MP3 encode runs (`ensureMp3`). */
  mp3: Blob | null;
};

export type BounceProgressStage = "mix" | "wav" | "mp3";

export type BounceProgress = {
  stage: BounceProgressStage;
  /** Present for `mp3` (0…1). */
  ratio?: number;
};

async function yieldToUi(): Promise<void> {
  const sched = (
    globalThis as unknown as {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (sched?.yield) {
    await sched.yield();
    return;
  }
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function applyMasterGainAsync(
  buffer: AudioBuffer,
  gainDb: number,
): Promise<void> {
  const gain = Math.pow(10, gainDb / 20);
  if (gain === 1) return;
  const chunk = 128_000;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += chunk) {
      const end = Math.min(i + chunk, data.length);
      for (let j = i; j < end; j++) data[j]! *= gain;
      await yieldToUi();
    }
  }
}

async function bounceProject(opts: {
  engine: TransportEngine;
  clips: ScheduledClip[];
  project: Project;
  lengthTick: number;
  tracks?: TrackInsertConfig[];
  /** Default: wav only. Pass true when the caller needs MP3. */
  encodeMp3?: boolean;
  onProgress?: (p: BounceProgress) => void;
}): Promise<BounceResult> {
  const {
    engine,
    clips,
    project,
    lengthTick,
    tracks = [],
    encodeMp3 = false,
    onProgress,
  } = opts;
  const durationSamples = ticksToSamples(
    asTick(lengthTick),
    project.bpm,
    engine.sampleRate,
  );
  const prev = engine.master.gain.value;
  engine.master.gain.value = 1;
  try {
    onProgress?.({ stage: "mix" });
    await yieldToUi();
    const buffer = await engine.renderOffline(
      clips,
      Number(asSampleIndex(Math.max(1, durationSamples))),
      tracks,
    );
    await applyMasterGainAsync(buffer, project.masterGainDb);
    onProgress?.({ stage: "wav" });
    await yieldToUi();
    const wav = audioExport.encodeWav(buffer, "int16");
    const mp3 = encodeMp3
      ? await audioExport.encodeMp3(buffer, 192, (p) =>
          onProgress?.({ stage: "mp3", ratio: p.ratio }),
        )
      : null;
    return { buffer, wav, mp3 };
  } finally {
    engine.master.gain.value = prev;
  }
}

async function ensureMp3(
  bounce: BounceResult,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  if (bounce.mp3) return bounce.mp3;
  bounce.mp3 = await audioExport.encodeMp3(bounce.buffer, 192, (p) =>
    onProgress?.(p.ratio),
  );
  return bounce.mp3;
}

async function fetchSoundCloudStatus(): Promise<SoundCloudStatus> {
  const base = auth.apiBase();
  if (!base) {
    return { available: false, connected: false, displayName: null };
  }
  try {
    const res = await fetch(`${base}/api/publish/soundcloud/status`, {
      headers: auth.authHeaders(),
    });
    if (!res.ok) {
      return { available: false, connected: false, displayName: null };
    }
    return (await res.json()) as SoundCloudStatus;
  } catch {
    return { available: false, connected: false, displayName: null };
  }
}

async function connectSoundCloud(): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = auth.apiBase();
  if (!base) return { ok: false, error: "api_not_configured" };
  if (!auth.getJwt()) return { ok: false, error: "authentication_required" };
  const res = await fetch(`${base}/api/publish/soundcloud/authorize`, {
    headers: auth.authHeaders(),
  });
  if (res.status === 401) return { ok: false, error: "authentication_required" };
  if (res.status === 503) return { ok: false, error: "unavailable" };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `http_${res.status}` };
  }
  const data = (await res.json()) as { url: string };
  window.location.assign(data.url);
  return { ok: true };
}

async function disconnectSoundCloud(): Promise<void> {
  const base = auth.apiBase();
  if (!base || !auth.getJwt()) return;
  await fetch(`${base}/api/publish/soundcloud`, {
    method: "DELETE",
    headers: auth.authHeaders(),
  });
}

async function uploadToSoundCloud(opts: {
  mp3: Blob;
  title: string;
  description?: string;
  sharing?: "public" | "private";
}): Promise<{ permalink_url?: string | null } | { error: string }> {
  const base = auth.apiBase();
  if (!base) return { error: "api_not_configured" };
  if (!auth.getJwt()) return { error: "authentication_required" };

  const form = new FormData();
  form.append("title", opts.title);
  if (opts.description) form.append("description", opts.description);
  form.append("sharing", opts.sharing ?? "private");
  form.append(
    "asset",
    opts.mp3,
    `${audioExport.sanitizeFilename(opts.title)}.mp3`,
  );

  const up = await fetch(`${base}/api/publish/soundcloud/tracks`, {
    method: "POST",
    headers: auth.authHeaders(),
    body: form,
  });
  if (!up.ok) {
    const body = (await up.json().catch(() => ({}))) as { error?: string };
    return { error: body.error ?? `upload_${up.status}` };
  }
  return (await up.json()) as { permalink_url?: string | null };
}

async function openBandcampAssist(title: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(title);
  } catch {
    /* ignore */
  }
  window.open("https://bandcamp.com/login?from=fan_upload", "_blank", "noopener,noreferrer");
}

function openSoundCloudAssist(): void {
  window.open("https://soundcloud.com/upload", "_blank", "noopener,noreferrer");
}

function downloadExport(title: string, kind: "wav" | "mp3", blob: Blob): void {
  const base = audioExport.sanitizeFilename(title);
  audioExport.downloadBlob(`${base}.${kind}`, blob);
}

export const exportPublish = {
  bounceProject,
  ensureMp3,
  fetchSoundCloudStatus,
  connectSoundCloud,
  disconnectSoundCloud,
  uploadToSoundCloud,
  openBandcampAssist,
  openSoundCloudAssist,
  downloadExport,
  hasJwt: () => Boolean(auth.getJwt()),
  apiConfigured: () => auth.isApiConfigured(),
} as const;
