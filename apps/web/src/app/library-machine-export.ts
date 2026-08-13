/**
 * Library → hardware sample pack (ZIP of WAV).
 * Octatrack: long names, class folders, 44.1 kHz int16 mono.
 * MPC2000XL: DOS 8.3 names, flat pack, 44.1 kHz int16 mono.
 */
import { audioExport } from "@glane/audio-io";
import type { Sample, SampleClass } from "@glane/core-model";
import { toMonoPcm } from "@glane/audio-dsp";
import { loadSampleAudio } from "./load-sample-audio.js";

export type MachineTarget = "octatrack" | "mpc2000xl";

const TARGET_RATE = 44_100;

const CLASS_DIR: Record<SampleClass, string> = {
  percussive: "PERC",
  tonal: "TONAL",
  texture: "TEX",
  noise: "NOISE",
  rhythmic: "RHY",
  voice: "VOX",
  unclassified: "MISC",
};

function displayName(s: Sample): string {
  return (s.userName ?? s.name).trim() || "sample";
}

function sanitizeLong(name: string): string {
  return (
    name
      .replace(/[^\w.\-() +]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 48) || "sample"
  );
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

function pathFor(sample: Sample, index: number, target: MachineTarget, used: Set<string>): string {
  if (target === "mpc2000xl") {
    return unique83(stem83(displayName(sample), index), used);
  }
  const dir = CLASS_DIR[sample.class];
  return uniquePath(`${dir}/${sanitizeLong(displayName(sample))}.wav`, used);
}

async function wavBytes(
  pcm: Float32Array,
  sampleRate: number,
): Promise<Uint8Array> {
  const atTarget = audioExport.resampleLinear(pcm, sampleRate, TARGET_RATE);
  const blob = audioExport.encodeWavMono(atTarget, TARGET_RATE, "int16");
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildZip(
  samples: Sample[],
  target: MachineTarget,
): Promise<{ blob: Blob; exported: number; skipped: number }> {
  const used = new Set<string>();
  const files: { path: string; data: Uint8Array }[] = [];
  let skipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const audio = await loadSampleAudio(s);
    if (!audio || audio.pcm.length === 0) {
      skipped += 1;
      continue;
    }
    const data = await wavBytes(
      toMonoPcm(audio.pcm, audio.channelCount ?? 1),
      audio.sampleRate,
    );
    files.push({ path: pathFor(s, i, target, used), data });
  }
  if (files.length === 0) {
    return { blob: new Blob(), exported: 0, skipped };
  }
  return {
    blob: audioExport.zipStore(files),
    exported: files.length,
    skipped,
  };
}

function packFilename(projectTitle: string, target: MachineTarget): string {
  const base = audioExport.sanitizeFilename(projectTitle || "glane");
  const tag = target === "mpc2000xl" ? "mpc2000xl" : "octatrack";
  return `${base}-${tag}.zip`;
}

export const libraryMachineExport = {
  buildZip,
  packFilename,
  download(projectTitle: string, target: MachineTarget, blob: Blob): void {
    audioExport.downloadBlob(packFilename(projectTitle, target), blob);
  },
} as const;
