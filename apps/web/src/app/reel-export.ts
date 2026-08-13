/**
 * Client-side vertical Reel (audio bounce + canvas waveform → MediaRecorder).
 * No Instagram API — download / Web Share for Stories & Reels import.
 */
import { APP_NAME } from "@glane/core-model";
import { audioExport } from "@glane/audio-io";

export const REEL_MAX_DURATION_S = 30;
export const REEL_FADE_OUT_S = 1.5;
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

export type ReelPalette = {
  top: string;
  bottom: string;
  wave: string;
  waveDim: string;
  text: string;
  accent: string;
};

export type ReelEncodeOpts = {
  buffer: AudioBuffer;
  title: string;
  /** Music style id when known; drives palette. */
  styleId?: string;
  onProgress?: (ratio: number) => void;
};

export type ReelEncodeResult = {
  blob: Blob;
  mimeType: string;
  objectUrl: string;
  durationS: number;
  extension: "webm" | "mp4";
};

const DEFAULT_PALETTE: ReelPalette = {
  top: "#10161a",
  bottom: "#1b2830",
  wave: "#8ec8b8",
  waveDim: "#3a5a54",
  text: "#e8f0ef",
  accent: "#c8e8e0",
};

const STYLE_PALETTES: Record<string, ReelPalette> = {
  techno: {
    top: "#08080f",
    bottom: "#1a1030",
    wave: "#9b7cff",
    waveDim: "#3a2a60",
    text: "#ece8f8",
    accent: "#c4b0ff",
  },
  house: {
    top: "#100c14",
    bottom: "#2a1840",
    wave: "#ff7ab8",
    waveDim: "#5a3050",
    text: "#f8e8f0",
    accent: "#ffb0d4",
  },
  ambient: {
    top: "#0a1418",
    bottom: "#163038",
    wave: "#6ec8b8",
    waveDim: "#2a5050",
    text: "#e0f0ee",
    accent: "#a8e0d4",
  },
  hiphop: {
    top: "#120c0a",
    bottom: "#2a1810",
    wave: "#e8a050",
    waveDim: "#5a4030",
    text: "#f0e8e0",
    accent: "#f0c080",
  },
  dnb: {
    top: "#0a0c10",
    bottom: "#142028",
    wave: "#50e0a0",
    waveDim: "#285040",
    text: "#e0f8f0",
    accent: "#90f0c8",
  },
  jazz: {
    top: "#14100c",
    bottom: "#2a2018",
    wave: "#d4a878",
    waveDim: "#504030",
    text: "#f0e8e0",
    accent: "#e8c8a0",
  },
  rock: {
    top: "#100808",
    bottom: "#281010",
    wave: "#e06060",
    waveDim: "#502828",
    text: "#f0e8e8",
    accent: "#f09090",
  },
  metal: {
    top: "#080808",
    bottom: "#181818",
    wave: "#c0c0c8",
    waveDim: "#404048",
    text: "#f0f0f0",
    accent: "#e0e0e8",
  },
  reggae: {
    top: "#0c1408",
    bottom: "#203010",
    wave: "#70c040",
    waveDim: "#305020",
    text: "#e8f0e0",
    accent: "#a0e060",
  },
  dub: {
    top: "#081410",
    bottom: "#102820",
    wave: "#40c090",
    waveDim: "#205040",
    text: "#e0f0e8",
    accent: "#70e0b0",
  },
  pop: {
    top: "#101018",
    bottom: "#202038",
    wave: "#70b0ff",
    waveDim: "#304060",
    text: "#e8eef8",
    accent: "#a0c8ff",
  },
  folk: {
    top: "#141208",
    bottom: "#282418",
    wave: "#c8a860",
    waveDim: "#504830",
    text: "#f0ebe0",
    accent: "#e0c880",
  },
};

function paletteFor(styleId?: string): ReelPalette {
  if (!styleId || styleId === "auto") return DEFAULT_PALETTE;
  return STYLE_PALETTES[styleId] ?? DEFAULT_PALETTE;
}

function pickMimeType(): { mimeType: string; extension: "webm" | "mp4" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Array<{ mimeType: string; extension: "webm" | "mp4" }> = [
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
    { mimeType: "video/mp4", extension: "mp4" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return null;
}

function applyFadeOut(buf: AudioBuffer, fadeOutS: number): void {
  const fadeSamples = Math.min(
    buf.length,
    Math.floor(fadeOutS * buf.sampleRate),
  );
  if (fadeSamples <= 0) return;
  const fadeStart = buf.length - fadeSamples;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = fadeStart; i < buf.length; i++) {
      const g = 1 - (i - fadeStart) / fadeSamples;
      data[i]! *= Math.max(0, g);
    }
  }
}

function clipBuffer(src: AudioBuffer, maxDurationS: number): AudioBuffer {
  const durationS = Math.min(src.duration, maxDurationS);
  const frameCount = Math.max(1, Math.floor(durationS * src.sampleRate));
  if (frameCount >= src.length) {
    // Clone so we can fade in place without mutating the bounce cache.
    const clone = new AudioBuffer({
      length: src.length,
      numberOfChannels: src.numberOfChannels,
      sampleRate: src.sampleRate,
    });
    for (let c = 0; c < src.numberOfChannels; c++) {
      clone.getChannelData(c).set(src.getChannelData(c));
    }
    return clone;
  }
  const out = new AudioBuffer({
    length: frameCount,
    numberOfChannels: src.numberOfChannels,
    sampleRate: src.sampleRate,
  });
  for (let c = 0; c < src.numberOfChannels; c++) {
    out
      .getChannelData(c)
      .set(src.getChannelData(c).subarray(0, frameCount));
  }
  return out;
}

/** Peak magnitudes 0…1 for drawing (mono mix). */
function buildPeaks(buf: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const ch0 = buf.getChannelData(0);
  const ch1 =
    buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const block = Math.max(1, Math.floor(buf.length / columns));
  for (let i = 0; i < columns; i++) {
    const start = i * block;
    const end = Math.min(buf.length, start + block);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const s0 = ch0[j] ?? 0;
      const s1 = ch1 ? (ch1[j] ?? 0) : s0;
      const m = Math.abs((s0 + s1) * 0.5);
      if (m > peak) peak = m;
    }
    peaks[i] = peak;
  }
  // Soft normalize
  let max = 0.001;
  for (let i = 0; i < columns; i++) {
    if (peaks[i]! > max) max = peaks[i]!;
  }
  for (let i = 0; i < columns; i++) peaks[i]! /= max;
  return peaks;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    peaks: Float32Array;
    progress: number;
    title: string;
    palette: ReelPalette;
  },
): void {
  const { w, h, peaks, progress, title, palette } = opts;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, palette.top);
  grad.addColorStop(1, palette.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Soft vignette
  const vig = ctx.createRadialGradient(
    w / 2,
    h * 0.45,
    w * 0.1,
    w / 2,
    h * 0.45,
    w * 0.75,
  );
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  const waveTop = h * 0.28;
  const waveH = h * 0.36;
  const midY = waveTop + waveH / 2;
  const padX = w * 0.08;
  const drawW = w - padX * 2;
  const cols = peaks.length;
  const barW = drawW / cols;
  const playCol = Math.floor(progress * cols);

  for (let i = 0; i < cols; i++) {
    const mag = peaks[i] ?? 0;
    const barH = Math.max(2, mag * waveH * 0.92);
    const x = padX + i * barW;
    ctx.fillStyle = i <= playCol ? palette.wave : palette.waveDim;
    ctx.globalAlpha = i <= playCol ? 0.95 : 0.55;
    ctx.fillRect(x, midY - barH / 2, Math.max(1, barW * 0.72), barH);
  }
  ctx.globalAlpha = 1;

  // Playhead
  const px = padX + progress * drawW;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px, waveTop - 24);
  ctx.lineTo(px, waveTop + waveH + 24);
  ctx.stroke();

  // Brand
  ctx.fillStyle = palette.accent;
  ctx.font = "600 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(APP_NAME, w / 2, h * 0.14);

  // Title
  ctx.fillStyle = palette.text;
  ctx.font = "500 48px system-ui, sans-serif";
  const label = title.trim() || APP_NAME;
  const maxTitleW = w * 0.84;
  let display = label;
  if (ctx.measureText(display).width > maxTitleW) {
    while (display.length > 1 && ctx.measureText(`${display}…`).width > maxTitleW) {
      display = display.slice(0, -1);
    }
    display = `${display}…`;
  }
  ctx.fillText(display, w / 2, h * 0.82);
}

async function encode(opts: ReelEncodeOpts): Promise<ReelEncodeResult> {
  const mime = pickMimeType();
  if (!mime) {
    throw new Error("MediaRecorder unsupported in this browser");
  }

  const clipped = clipBuffer(opts.buffer, REEL_MAX_DURATION_S);
  if (opts.buffer.duration > REEL_MAX_DURATION_S) {
    applyFadeOut(clipped, REEL_FADE_OUT_S);
  }
  const durationS = clipped.duration;
  const palette = paletteFor(opts.styleId);
  const peaks = buildPeaks(clipped, 240);

  const canvas = document.createElement("canvas");
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");

  drawFrame(ctx, {
    w: REEL_WIDTH,
    h: REEL_HEIGHT,
    peaks,
    progress: 0,
    title: opts.title,
    palette,
  });

  const audioCtx = new AudioContext({ sampleRate: clipped.sampleRate });
  try {
    await audioCtx.resume();
    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = clipped;
    source.connect(dest);

    const videoStream = canvas.captureStream(REEL_FPS);
    const mixed = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(mixed, {
      mimeType: mime.mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 192_000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mime.mimeType.split(";")[0] }));
      };
      recorder.onerror = () => reject(new Error("MediaRecorder error"));
    });

    const t0 = audioCtx.currentTime;
    source.start(t0);
    recorder.start(100);

    await new Promise<void>((resolve) => {
      let done = false;
      let raf = 0;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        try {
          if (recorder.state === "recording") recorder.stop();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const tick = () => {
        const elapsed = audioCtx.currentTime - t0;
        const progress = Math.min(1, elapsed / durationS);
        drawFrame(ctx, {
          w: REEL_WIDTH,
          h: REEL_HEIGHT,
          peaks,
          progress,
          title: opts.title,
          palette,
        });
        opts.onProgress?.(progress);
        if (elapsed >= durationS - 0.02) {
          finish();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      source.onended = () => finish();
      raf = requestAnimationFrame(tick);
      window.setTimeout(finish, Math.ceil(durationS * 1000) + 1500);
    });

    const blob = await stopped;
    for (const track of mixed.getTracks()) track.stop();
    const objectUrl = URL.createObjectURL(blob);
    opts.onProgress?.(1);
    return {
      blob,
      mimeType: blob.type || mime.mimeType,
      objectUrl,
      durationS,
      extension: mime.extension,
    };
  } finally {
    await audioCtx.close().catch(() => undefined);
  }
}

function download(title: string, result: ReelEncodeResult): void {
  const base = audioExport.sanitizeFilename(title);
  audioExport.downloadBlob(`${base}.${result.extension}`, result.blob);
}

function canShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

async function share(
  title: string,
  result: ReelEncodeResult,
): Promise<"shared" | "unsupported" | "aborted" | "failed"> {
  if (!canShare()) return "unsupported";
  const base = audioExport.sanitizeFilename(title);
  const file = new File([result.blob], `${base}.${result.extension}`, {
    type: result.mimeType,
  });
  const data: ShareData = { files: [file], title: title || APP_NAME };
  if (!navigator.canShare(data)) return "unsupported";
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "aborted";
    return "failed";
  }
}

function revoke(objectUrl: string | null | undefined): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

export const reelExport = {
  encode,
  download,
  share,
  canShare,
  revoke,
  paletteFor,
} as const;
