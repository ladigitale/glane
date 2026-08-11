/**
 * Sequencer → Octatrack sliced stems (WAV 44.1 kHz int16 + `.ot`).
 * One slice per bar group (≤ 64 slices). Master + audible track stems.
 */
import { audioExport, octatrackOt } from "@glane/audio-io";
import type {
  TransportEngine,
  ScheduledClip,
  TrackInsertConfig,
} from "@glane/audio-engine";
import {
  asSampleIndex,
  asTick,
  ticksToSamples,
  PPQ,
  type Project,
  type Track,
} from "@glane/core-model";

const TARGET_RATE = 44_100;

export type SeqOtExportOpts = {
  engine: TransportEngine;
  clips: ScheduledClip[];
  tracks: Track[];
  trackInserts: TrackInsertConfig[];
  project: Project;
  lengthTick: number;
  title: string;
};

function applyMasterGain(buffer: AudioBuffer, gainDb: number): void {
  const gain = Math.pow(10, gainDb / 20);
  if (gain === 1) return;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i]! *= gain;
  }
}

function sanitizeStem(name: string): string {
  return (
    name
      .replace(/[^\w.\-() +]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 40) || "track"
  );
}

async function bufferToOtWav(
  buffer: AudioBuffer,
  targetFrames: number,
): Promise<Uint8Array> {
  const planar = audioExport.audioBufferToPlanarFloat(buffer);
  const channels = audioExport.resampleChannels(
    planar,
    buffer.sampleRate,
    TARGET_RATE,
    targetFrames,
  );
  const blob = audioExport.encodeWavChannels(channels, TARGET_RATE, "int16");
  return new Uint8Array(await blob.arrayBuffer());
}

function otBytes(opts: {
  totalSamples: number;
  bpm: number;
  bars: number;
  samplesPerBar: number;
}): Uint8Array {
  const { slices } = octatrackOt.slicesForBars({
    bars: opts.bars,
    totalSamples: opts.totalSamples,
    samplesPerBar: opts.samplesPerBar,
  });
  return octatrackOt.encode({
    totalSamples: opts.totalSamples,
    bpm: opts.bpm,
    bars: opts.bars,
    slices,
  });
}

function readmeText(opts: {
  title: string;
  bpm: number;
  bars: number;
  beatsPerBar: number;
  beatUnit: number;
  barsPerSlice: number;
  sliceCount: number;
  stems: string[];
}): string {
  const grid =
    opts.barsPerSlice === 1
      ? "1 bar per slice"
      : `${opts.barsPerSlice} bars per slice (OT max ${octatrackOt.MAX_SLICES} slices)`;
  return [
    `Glane → Octatrack sliced export`,
    `Title: ${opts.title}`,
    `BPM: ${opts.bpm}`,
    `Bars: ${opts.bars}`,
    `Time signature: ${opts.beatsPerBar}/${opts.beatUnit}`,
    `Slices: ${opts.sliceCount} (${grid})`,
    `Audio: 44.1 kHz 16-bit stereo WAV + matching .ot`,
    ``,
    `Files:`,
    ...opts.stems.map((s) => `- ${s}.wav / ${s}.ot`),
    ``,
    `On the Octatrack: copy this folder to the CF card, load a Flex/Static`,
    `slot, enable Slice playback. Tempo attribute is set to the project BPM.`,
    ``,
  ].join("\n");
}

async function renderBuffer(
  engine: TransportEngine,
  clips: ScheduledClip[],
  durationSamples: number,
  tracks: TrackInsertConfig[],
  masterGainDb: number,
): Promise<AudioBuffer> {
  const prev = engine.master.gain.value;
  engine.master.gain.value = 1;
  try {
    const buffer = await engine.renderOffline(
      clips,
      Number(asSampleIndex(Math.max(1, durationSamples))),
      tracks,
    );
    applyMasterGain(buffer, masterGainDb);
    return buffer;
  } finally {
    engine.master.gain.value = prev;
  }
}

async function buildZip(opts: SeqOtExportOpts): Promise<{
  blob: Blob;
  sliceCount: number;
  barsPerSlice: number;
  stemCount: number;
}> {
  const { engine, clips, tracks, trackInserts, project, lengthTick, title } =
    opts;
  const bpm = project.bpm;
  const bars = Math.max(1, project.bars);
  const beatsPerBar = project.timeSignature[0];
  const beatUnit = project.timeSignature[1];
  const durationAtEngine = ticksToSamples(
    asTick(lengthTick),
    bpm,
    engine.sampleRate,
  );
  const targetFrames = Number(
    ticksToSamples(asTick(lengthTick), bpm, TARGET_RATE),
  );
  const samplesPerBar = Number(
    ticksToSamples(asTick(beatsPerBar * PPQ), bpm, TARGET_RATE),
  );
  const step = octatrackOt.barsPerSlice(bars);
  const sliceCount = octatrackOt.sliceCountForBars(bars);

  const files: { path: string; data: Uint8Array }[] = [];
  const stemNames: string[] = [];

  const pushStem = async (stem: string, buffer: AudioBuffer) => {
    const wav = await bufferToOtWav(buffer, targetFrames);
    const ot = otBytes({
      totalSamples: targetFrames,
      bpm,
      bars,
      samplesPerBar,
    });
    files.push({ path: `${stem}.wav`, data: wav });
    files.push({ path: `${stem}.ot`, data: ot });
    stemNames.push(stem);
  };

  const masterBuf = await renderBuffer(
    engine,
    clips,
    Number(durationAtEngine),
    trackInserts,
    project.masterGainDb,
  );
  await pushStem("master", masterBuf);

  const used = new Set<string>(["master"]);
  for (const tr of [...tracks].sort((a, b) => a.index - b.index)) {
    const trackClips = clips.filter((c) => c.trackId === tr.id);
    if (trackClips.length === 0) continue;
    const insert = trackInserts.find((t) => t.id === tr.id);
    if (!insert) continue;
    let stem = `${String(tr.index + 1).padStart(2, "0")}-${sanitizeStem(tr.name)}`;
    let n = 2;
    while (used.has(stem.toLowerCase())) {
      stem = `${String(tr.index + 1).padStart(2, "0")}-${sanitizeStem(tr.name)}_${n}`;
      n += 1;
    }
    used.add(stem.toLowerCase());
    const buf = await renderBuffer(
      engine,
      trackClips,
      Number(durationAtEngine),
      [insert],
      project.masterGainDb,
    );
    await pushStem(stem, buf);
  }

  const readme = new TextEncoder().encode(
    readmeText({
      title: title || project.title || "glane",
      bpm,
      bars,
      beatsPerBar,
      beatUnit,
      barsPerSlice: step,
      sliceCount,
      stems: stemNames,
    }),
  );
  files.push({ path: "README.txt", data: readme });

  return {
    blob: audioExport.zipStore(files),
    sliceCount,
    barsPerSlice: step,
    stemCount: stemNames.length,
  };
}

function packFilename(title: string): string {
  return `${audioExport.sanitizeFilename(title || "glane")}-octatrack-slices.zip`;
}

export const seqOctatrackExport = {
  buildZip,
  packFilename,
  download(title: string, blob: Blob): void {
    audioExport.downloadBlob(packFilename(title), blob);
  },
} as const;
