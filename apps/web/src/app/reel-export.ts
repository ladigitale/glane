/**
 * Client-side vertical Reel (audio bounce + WebGL viz → MediaRecorder).
 * No Instagram API — download / Web Share for Stories & Reels import.
 */
import { APP_NAME } from "@glane/core-model";
import { audioExport } from "@glane/audio-io";
import {
  REEL_SCENE_IDS,
  buildEnergySeries,
  createReelViz,
  createRng,
  drawBrandMark,
  energyAt,
  planScenes,
  scenesAt,
  type ReelPalette,
  type ReelSceneId,
} from "./reel-export-viz";

export const REEL_MAX_DURATION_S = 30;
export const REEL_FADE_OUT_S = 1.5;
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

export type { ReelPalette, ReelSceneId };
export { REEL_SCENE_IDS };

export type ReelEncodeOpts = {
  buffer: AudioBuffer;
  title: string;
  /** Background colour (bichromy). */
  bgColor?: string;
  /** Accent / wave colour (bichromy). */
  accentColor?: string;
  /** Scenes allowed in the random sequence; empty → all. */
  scenes?: readonly ReelSceneId[];
  /** Optional fixed seed (tests); default = random each encode. */
  seed?: number;
  onProgress?: (ratio: number) => void;
};

export type ReelEncodeResult = {
  blob: Blob;
  mimeType: string;
  objectUrl: string;
  durationS: number;
  extension: "webm" | "mp4";
};

const DEFAULT_BG = "#10161a";
const DEFAULT_ACCENT = "#8ec8b8";

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace("#", "");
  const h =
    raw.length === 3
      ? raw[0]! + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      : raw.slice(0, 6);
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return [0.06, 0.09, 0.1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex(r: number, g: number, b: number): string {
  const to = (x: number) =>
    Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Strict two-tone palette from background + accent pickers. */
function bichromePalette(bgHex: string, accentHex: string): ReelPalette {
  const bg = parseHex(bgHex || DEFAULT_BG);
  const ac = parseHex(accentHex || DEFAULT_ACCENT);
  const top = mix(bg, [0, 0, 0], 0.18);
  const bottom = mix(bg, ac, 0.12);
  const waveDim = mix(bg, ac, 0.35);
  const textRgb =
    luminance(bg) > 0.45
      ? mix(bg, [0, 0, 0], 0.85)
      : mix(ac, [1, 1, 1], 0.85);
  const accentLite = mix(ac, [1, 1, 1], 0.22);
  return {
    top: toHex(...top),
    bottom: toHex(...bottom),
    wave: toHex(...ac),
    waveDim: toHex(...waveDim),
    text: toHex(...textRgb),
    accent: toHex(...accentLite),
  };
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
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
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
  let max = 0.001;
  for (let i = 0; i < columns; i++) {
    if (peaks[i]! > max) max = peaks[i]!;
  }
  for (let i = 0; i < columns; i++) peaks[i]! /= max;
  return peaks;
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    peaks: Float32Array;
    progress: number;
    rms: number;
    palette: ReelPalette;
  },
): void {
  const { w, h, peaks, progress, rms, palette } = opts;
  const waveTop = h * 0.34;
  const waveH = h * 0.3;
  const midY = waveTop + waveH / 2;
  const padX = w * 0.08;
  const drawW = w - padX * 2;
  const cols = peaks.length;
  const barW = drawW / cols;
  const playCol = Math.floor(progress * cols);
  const liveBoost = 1 + rms * 0.35;

  for (let i = 0; i < cols; i++) {
    const mag = peaks[i] ?? 0;
    const near = 1 - Math.min(1, Math.abs(i - playCol) / 18);
    const boost = i === playCol ? liveBoost : 1 + near * rms * 0.15;
    const barH = Math.max(2, mag * waveH * 0.92 * boost);
    const x = padX + i * barW;
    ctx.fillStyle = i <= playCol ? palette.wave : palette.waveDim;
    ctx.globalAlpha = i <= playCol ? 0.92 : 0.45;
    ctx.fillRect(x, midY - barH / 2, Math.max(1, barW * 0.72), barH);
  }
  ctx.globalAlpha = 1;

  const px = padX + progress * drawW;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px, waveTop - 20);
  ctx.lineTo(px, waveTop + waveH + 20);
  ctx.stroke();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    title: string;
    palette: ReelPalette;
    peaks: Float32Array;
    progress: number;
    rms: number;
  },
): void {
  const { w, h, title, palette, peaks, progress, rms } = opts;

  drawWaveform(ctx, { w, h, peaks, progress, rms, palette });

  const brandY = h * 0.12;
  const markSize = 72;
  const gap = 20;
  ctx.font = "600 52px system-ui, sans-serif";
  const nameW = ctx.measureText(APP_NAME).width;
  const totalW = markSize + gap + nameW;
  const left = (w - totalW) / 2;
  drawBrandMark(ctx, left + markSize / 2, brandY, markSize, palette.accent);
  ctx.fillStyle = palette.accent;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(APP_NAME, left + markSize + gap, brandY);

  ctx.fillStyle = palette.text;
  ctx.font = "500 48px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const label = title.trim() || APP_NAME;
  const maxTitleW = w * 0.84;
  let display = label;
  if (ctx.measureText(display).width > maxTitleW) {
    while (
      display.length > 1 &&
      ctx.measureText(`${display}…`).width > maxTitleW
    ) {
      display = display.slice(0, -1);
    }
    display = `${display}…`;
  }
  ctx.fillText(display, w / 2, h * 0.88);
}

/** Canvas2D fallback when WebGL is unavailable. */
function drawFallbackFrame(
  ctx: CanvasRenderingContext2D,
  opts: {
    w: number;
    h: number;
    progress: number;
    timeS: number;
    rms: number;
    bass: number;
    title: string;
    palette: ReelPalette;
    peaks: Float32Array;
  },
): void {
  const { w, h, progress, timeS, rms, bass, title, palette, peaks } = opts;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, palette.top);
  grad.addColorStop(1, palette.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.45;
  ctx.strokeStyle = palette.wave;
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const r = (80 + i * 70) * (1 + bass * 0.25 * Math.sin(timeS * 6 + i));
    ctx.globalAlpha = 0.35 + rms * 0.4;
    ctx.beginPath();
    const sides = 3 + ((i * 2) % 5);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2 + timeS * (0.2 + i * 0.05);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 1.1;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawOverlay(ctx, { w, h, title, palette, peaks, progress, rms });
}

function normalizeScenes(
  scenes: readonly ReelSceneId[] | undefined,
): ReelSceneId[] {
  if (!scenes || scenes.length === 0) return [...REEL_SCENE_IDS];
  const allowed = new Set<string>(REEL_SCENE_IDS);
  const out = scenes.filter((s): s is ReelSceneId => allowed.has(s));
  return out.length > 0 ? out : [...REEL_SCENE_IDS];
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
  const seed =
    opts.seed ??
    (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffffffff));
  const rng = createRng(seed);
  const palette = bichromePalette(
    opts.bgColor ?? DEFAULT_BG,
    opts.accentColor ?? DEFAULT_ACCENT,
  );
  const scenes = planScenes(durationS, rng, normalizeScenes(opts.scenes));
  const energy = buildEnergySeries(clipped, REEL_FPS);
  const peaks = buildPeaks(clipped, 240);

  const canvas = document.createElement("canvas");
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");

  const viz = createReelViz(REEL_WIDTH, REEL_HEIGHT);

  const paint = (elapsed: number) => {
    const progress = Math.min(1, elapsed / durationS);
    const e = energyAt(energy, progress);
    const sc = scenesAt(scenes, elapsed);
    if (viz) {
      viz.render({
        timeS: elapsed,
        progress,
        energy: e,
        sceneA: sc.a,
        sceneB: sc.b,
        mix: sc.mix,
        palette,
      });
      ctx.drawImage(viz.canvas, 0, 0);
      drawOverlay(ctx, {
        w: REEL_WIDTH,
        h: REEL_HEIGHT,
        title: opts.title,
        palette,
        peaks,
        progress,
        rms: e.rms,
      });
    } else {
      drawFallbackFrame(ctx, {
        w: REEL_WIDTH,
        h: REEL_HEIGHT,
        progress,
        timeS: elapsed,
        rms: e.rms,
        bass: e.bass,
        title: opts.title,
        palette,
        peaks,
      });
    }
  };

  paint(0);

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
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
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
        paint(elapsed);
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
    viz?.dispose();
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
  sceneIds: REEL_SCENE_IDS,
  defaults: {
    bgColor: DEFAULT_BG,
    accentColor: DEFAULT_ACCENT,
    scenes: REEL_SCENE_IDS,
  },
} as const;
