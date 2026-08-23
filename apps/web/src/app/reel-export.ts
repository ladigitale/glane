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
  drawReelFilmGrain,
  energyAt,
  paintReelScene2d,
  planScenes,
  scenesAt,
  type ReelPalette,
  type ReelSceneId,
  type ReelViz,
} from "./reel-export-viz";
import {
  createReelThreeViz,
} from "./reel-export-three";

export const REEL_MAX_DURATION_S = 90;
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
  // Ambient full-bleed silhouette — background wash, not a UI widget.
  const midY = h * 0.5;
  const waveH = h * 0.72;
  const cols = peaks.length;
  const barW = w / cols;
  const playCol = Math.floor(progress * cols);

  ctx.save();
  for (let i = 0; i < cols; i++) {
    const mag = peaks[i] ?? 0;
    const played = i <= playCol;
    const barH = Math.max(1, mag * waveH * (0.55 + rms * 0.2));
    const x = i * barW;
    ctx.fillStyle = played ? palette.wave : palette.waveDim;
    ctx.globalAlpha = played ? 0.07 + rms * 0.05 : 0.03;
    ctx.fillRect(x, midY - barH / 2, Math.max(1, barW * 0.9), barH);
  }
  // Soft playhead veil (no hard needle).
  const px = progress * w;
  const veil = ctx.createLinearGradient(px - 40, 0, px + 40, 0);
  veil.addColorStop(0, "transparent");
  veil.addColorStop(0.5, palette.accent);
  veil.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.06 + rms * 0.05;
  ctx.fillStyle = veil;
  ctx.fillRect(px - 40, 0, 80, h);
  ctx.restore();
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
    timeS: number;
    energy: { rms: number; bass: number; mid: number; high: number };
  },
): void {
  const { w, h, title, palette, peaks, progress, timeS, energy: e } = opts;

  // Wave first — sits behind brand/title as quiet atmosphere.
  drawWaveform(ctx, { w, h, peaks, progress, rms: e.rms, palette });

  const brandY = h * 0.075;
  const markSize = 44;
  const gap = 14;
  ctx.save();
  ctx.font = "600 34px ui-monospace, SFMono-Regular, Menlo, monospace";
  const nameW = ctx.measureText(APP_NAME).width;
  const totalW = markSize + gap + nameW;
  const left = (w - totalW) / 2;
  ctx.globalAlpha = 0.55 + e.rms * 0.15;
  drawBrandMark(ctx, left + markSize / 2, brandY, markSize, palette.accent);
  ctx.fillStyle = palette.accent;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(APP_NAME, left + markSize + gap, brandY);
  ctx.restore();

  ctx.save();
  const titleY = h * 0.93;
  ctx.translate(w / 2, titleY);
  ctx.fillStyle = palette.text;
  ctx.font = "500 32px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const label = title.trim() || APP_NAME;
  const maxTitleW = w * 0.78;
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
  ctx.globalAlpha = 0.55 + e.mid * 0.15;
  ctx.fillText(display, 0, 0);
  ctx.globalAlpha = 0.12 + e.high * 0.1;
  ctx.fillStyle = palette.accent;
  for (let i = 0; i < 10; i++) {
    const sx = (Math.sin(timeS * 7 + i * 2.1) * 0.5) * maxTitleW * 0.6;
    ctx.fillRect(sx, 6 + (i % 3), 1, 1);
  }
  ctx.restore();
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
  const peaks = buildPeaks(clipped, 360);

  const canvas = document.createElement("canvas");
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");

  // Prefer Three for all scenes; legacy WebGL/2D only if Three fails.
  let threeViz: ReelViz | null = null;
  try {
    threeViz = await createReelThreeViz(REEL_WIDTH, REEL_HEIGHT);
  } catch {
    threeViz = null;
  }
  const viz = threeViz ? null : createReelViz(REEL_WIDTH, REEL_HEIGHT);

  const paint = (elapsed: number) => {
    const progress = Math.min(1, elapsed / durationS);
    const e = energyAt(energy, progress);
    const sc = scenesAt(scenes, elapsed);
    const frame = {
      timeS: elapsed,
      progress,
      energy: e,
      sceneA: sc.a,
      sceneB: sc.b,
      mix: sc.mix,
      palette,
      peaks,
    };

    if (threeViz) {
      threeViz.render(frame);
      ctx.drawImage(threeViz.canvas, 0, 0);
    } else if (viz) {
      viz.render(frame);
      ctx.drawImage(viz.canvas, 0, 0);
    } else {
      paintReelScene2d(ctx, {
        w: REEL_WIDTH,
        h: REEL_HEIGHT,
        timeS: elapsed,
        energy: e,
        sceneA: sc.a,
        sceneB: sc.b,
        mix: sc.mix,
        palette,
        peaks,
      });
    }
    drawOverlay(ctx, {
      w: REEL_WIDTH,
      h: REEL_HEIGHT,
      title: opts.title,
      palette,
      peaks,
      progress,
      timeS: elapsed,
      energy: e,
    });
    drawReelFilmGrain(ctx, {
      w: REEL_WIDTH,
      h: REEL_HEIGHT,
      timeS: elapsed,
      energy: e,
      palette,
    });
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
    threeViz?.dispose();
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
