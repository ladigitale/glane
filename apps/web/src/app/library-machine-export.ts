/**
 * Library → hardware sample pack (ZIP of WAV).
 * Octatrack: long names, class folders, 44.1 kHz int16 mono.
 * Digitakt: class folders, 48 kHz int16 mono (native +Drive / Transfer).
 * Digitakt II: class folders, 48 kHz int16 stereo when source is stereo, else mono.
 * MPC2000XL: DOS 8.3 names, flat pack, 44.1 kHz int16 mono.
 */
import { audioExport } from "@glane/audio-io";
import type { Sample, SampleAnalysis, SampleClass } from "@glane/core-model";
import { deinterleave, normalizePeak, toMonoPcm } from "@glane/audio-dsp";
import { db } from "./db.js";
import { loadSampleAudio } from "./load-sample-audio.js";
import { bpmFromTags } from "./sample-auto-name.js";

export type MachineTarget =
  | "octatrack"
  | "digitakt"
  | "digitakt2"
  | "mpc2000xl";

export type MachineExportOpts = {
  /** Peak-normalize PCM before encode (default false). */
  normalizePeak?: boolean;
  /** Target dBTP when normalizing (default −1). */
  peakDbtp?: number;
  onProgress?: (p: { done: number; total: number }) => void;
};

export type MachineExportResult = {
  blob: Blob;
  exported: number;
  skipped: number;
  mono: number;
  stereo: number;
  rate: number;
  normalized: boolean;
};

const RATE_44100 = 44_100;
const RATE_48000 = 48_000;
/** Headroom for groovebox converters / Transfer. */
const EXPORT_PEAK_DBTP = -1;

const CLASS_DIR: Record<SampleClass, string> = {
  percussive: "PERC",
  tonal: "TONAL",
  texture: "TEX",
  noise: "NOISE",
  rhythmic: "RHY",
  voice: "VOX",
  unclassified: "MISC",
};

const PACK_TAG: Record<MachineTarget, string> = {
  octatrack: "octatrack",
  digitakt: "digitakt",
  digitakt2: "digitakt2",
  mpc2000xl: "mpc2000xl",
};

function isDigitaktFamily(target: MachineTarget): boolean {
  return target === "digitakt" || target === "digitakt2";
}

function targetRate(target: MachineTarget): number {
  return isDigitaktFamily(target) ? RATE_48000 : RATE_44100;
}

function displayName(s: Sample): string {
  return (s.userName ?? s.name).trim() || "sample";
}

function sanitizeLong(name: string, maxLen: number): string {
  return (
    name
      .replace(/[^\w.\-() +]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, maxLen) || "sample"
  );
}

/** Filename-safe note token (`C#3` → `Cs3`). */
function noteToken(noteName: string | undefined | null): string | null {
  const raw = (noteName ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/♯|#/g, "s")
    .replace(/♭/g, "b")
    .replace(/[^A-Za-z0-9]/g, "");
  return cleaned || null;
}

function bpmToken(
  analysis: SampleAnalysis | undefined,
  sample: Sample,
): string | null {
  const fromAnalysis =
    analysis?.bpm != null && Number.isFinite(analysis.bpm) && analysis.bpm > 0
      ? Math.round(analysis.bpm)
      : null;
  const bpm = fromAnalysis ?? bpmFromTags(sample.tags);
  return bpm != null ? String(bpm) : null;
}

function nameHasToken(name: string, token: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const t = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return t.length > 0 && n.includes(t);
}

/**
 * Long-name stem: display name + note/BPM when analysis has them
 * and they are not already in the display name (Digitakt maxLen ≈ 24).
 */
function stemWithMeta(
  sample: Sample,
  analysis: SampleAnalysis | undefined,
  maxLen: number,
): string {
  const base = displayName(sample);
  const note = noteToken(analysis?.noteName);
  const bpm = bpmToken(analysis, sample);
  const meta: string[] = [];
  if (note && !nameHasToken(base, note)) meta.push(note);
  if (bpm && !nameHasToken(base, bpm) && !nameHasToken(base, `${bpm}bpm`)) {
    meta.push(bpm);
  }
  const suffix = meta.length > 0 ? `_${meta.join("_")}` : "";
  const room = Math.max(4, maxLen - suffix.length);
  return `${sanitizeLong(base, room)}${suffix}`;
}

/** MPC2000XL / DOS 8.3 stem (A–Z 0–9, max 8). */
function stem83(name: string, index: number): string {
  const raw = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  if (raw.length > 0) return raw;
  return `S${String(index + 1).padStart(7, "0")}`.slice(0, 8);
}

function uniquePath(path: string, used: Set<string>): string {
  const key = path.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const base = dot >= 0 ? path.slice(0, dot) : path;
  const ext = dot >= 0 ? path.slice(dot) : "";
  let n = 2;
  for (;;) {
    const next = `${base}_${n}${ext}`;
    const k = next.toLowerCase();
    if (!used.has(k)) {
      used.add(k);
      return next;
    }
    n += 1;
  }
}

/** Keep DOS 8.3 when resolving collisions (suffix eats stem length). */
function unique83(stem: string, used: Set<string>): string {
  const base0 = stem.slice(0, 8) || "SAMPLE";
  let path = `${base0}.WAV`;
  if (!used.has(path.toLowerCase())) {
    used.add(path.toLowerCase());
    return path;
  }
  for (let n = 2; n < 100_000; n++) {
    const suffix = String(n);
    const base = `${base0.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    path = `${base}.WAV`;
    if (!used.has(path.toLowerCase())) {
      used.add(path.toLowerCase());
      return path;
    }
  }
  return uniquePath(`${base0}.WAV`, used);
}

function pathFor(
  sample: Sample,
  index: number,
  target: MachineTarget,
  used: Set<string>,
  analysis: SampleAnalysis | undefined,
): string {
  if (target === "mpc2000xl") {
    return unique83(stem83(displayName(sample), index), used);
  }
  const dir = CLASS_DIR[sample.class];
  /** Digitakt UI truncates; keep stems readable in Transfer + on-device. */
  const maxLen = isDigitaktFamily(target) ? 24 : 48;
  return uniquePath(
    `${dir}/${stemWithMeta(sample, analysis, maxLen)}.wav`,
    used,
  );
}

async function wavBytesMono(
  pcm: Float32Array,
  sampleRate: number,
  rate: number,
): Promise<Uint8Array> {
  const atTarget = audioExport.resampleLinear(pcm, sampleRate, rate);
  const blob = audioExport.encodeWavMono(atTarget, rate, "int16");
  return new Uint8Array(await blob.arrayBuffer());
}

async function wavBytesStereo(
  pcm: Float32Array,
  channelCount: number,
  sampleRate: number,
  rate: number,
): Promise<Uint8Array> {
  const planar = deinterleave(pcm, channelCount);
  const channels = audioExport.resampleChannels(planar, sampleRate, rate);
  const blob = audioExport.encodeWavChannels(channels, rate, "int16");
  return new Uint8Array(await blob.arrayBuffer());
}

async function encodeForTarget(
  pcm: Float32Array,
  channelCount: number,
  sampleRate: number,
  target: MachineTarget,
): Promise<{ data: Uint8Array; stereo: boolean }> {
  const rate = targetRate(target);
  if (target === "digitakt2" && channelCount >= 2) {
    return {
      data: await wavBytesStereo(pcm, channelCount, sampleRate, rate),
      stereo: true,
    };
  }
  return {
    data: await wavBytesMono(toMonoPcm(pcm, channelCount), sampleRate, rate),
    stereo: false,
  };
}

async function analysesById(
  ids: string[],
): Promise<Map<string, SampleAnalysis>> {
  const rows = await db.analyses.bulkGet(ids);
  const map = new Map<string, SampleAnalysis>();
  for (let i = 0; i < ids.length; i++) {
    const row = rows[i];
    if (row) map.set(ids[i]!, row);
  }
  return map;
}

async function buildZip(
  samples: Sample[],
  target: MachineTarget,
  opts?: MachineExportOpts,
): Promise<MachineExportResult> {
  const normalize = opts?.normalizePeak === true;
  const peakDbtp = opts?.peakDbtp ?? EXPORT_PEAK_DBTP;
  const rate = targetRate(target);
  const used = new Set<string>();
  const files: { path: string; data: Uint8Array }[] = [];
  let skipped = 0;
  let mono = 0;
  let stereo = 0;
  const analyses = await analysesById(samples.map((s) => s.id));
  const total = samples.length;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const audio = await loadSampleAudio(s);
    if (!audio || audio.pcm.length === 0) {
      skipped += 1;
      opts?.onProgress?.({ done: i + 1, total });
      continue;
    }
    const ch = audio.channelCount ?? 1;
    let pcm = audio.pcm;
    if (normalize) {
      pcm = normalizePeak(pcm, peakDbtp);
    }
    const encoded = await encodeForTarget(pcm, ch, audio.sampleRate, target);
    if (encoded.stereo) stereo += 1;
    else mono += 1;
    files.push({
      path: pathFor(s, i, target, used, analyses.get(s.id)),
      data: encoded.data,
    });
    opts?.onProgress?.({ done: i + 1, total });
  }

  if (files.length === 0) {
    return {
      blob: new Blob(),
      exported: 0,
      skipped,
      mono: 0,
      stereo: 0,
      rate,
      normalized: normalize,
    };
  }
  return {
    blob: audioExport.zipStore(files),
    exported: files.length,
    skipped,
    mono,
    stereo,
    rate,
    normalized: normalize,
  };
}

function packFilename(projectTitle: string, target: MachineTarget): string {
  const base = audioExport.sanitizeFilename(projectTitle || "glane");
  return `${base}-${PACK_TAG[target]}.zip`;
}

export const libraryMachineExport = {
  buildZip,
  packFilename,
  download(projectTitle: string, target: MachineTarget, blob: Blob): void {
    audioExport.downloadBlob(packFilename(projectTitle, target), blob);
  },
} as const;
