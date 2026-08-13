/**
 * Per-sample OPFS PCM (extracted clips — not a session master).
 */

async function getSampleDir(sampleId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const samples = await root.getDirectoryHandle("samples", { create: true });
  return samples.getDirectoryHandle(sampleId, { create: true });
}

export async function saveSamplePcm(
  sampleId: string,
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 2,
): Promise<void> {
  const dir = await getSampleDir(sampleId);
  const fileHandle = await dir.getFileHandle("clip.f32", { create: true });
  const writable = await fileHandle.createWritable();
  const copy = pcm.buffer.slice(
    pcm.byteOffset,
    pcm.byteOffset + pcm.byteLength,
  ) as ArrayBuffer;
  await writable.write(new Float32Array(copy));
  await writable.close();
  const meta = await dir.getFileHandle("meta.json", { create: true });
  const mw = await meta.createWritable();
  await mw.write(
    JSON.stringify({
      sampleRate,
      channelCount,
      frames: Math.floor(pcm.length / Math.max(1, channelCount)),
    }),
  );
  await mw.close();
}

export async function loadSamplePcm(sampleId: string): Promise<{
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
} | null> {
  try {
    const dir = await getSampleDir(sampleId);
    let sampleRate = 48_000;
    let channelCount = 1;
    try {
      const meta = JSON.parse(
        await (await (await dir.getFileHandle("meta.json")).getFile()).text(),
      ) as { sampleRate?: number; channelCount?: number };
      sampleRate = meta.sampleRate ?? sampleRate;
      channelCount = meta.channelCount ?? channelCount;
    } catch {
      /* meta optional */
    }
    const raw = await (await dir.getFileHandle("clip.f32")).getFile();
    const ab = await raw.arrayBuffer();
    return { pcm: new Float32Array(ab), sampleRate, channelCount };
  } catch {
    return null;
  }
}

/** Best-effort remove of sample OPFS directory. */
export async function deleteSamplePcm(sampleId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const samples = await root.getDirectoryHandle("samples");
    await samples.removeEntry(sampleId, { recursive: true });
  } catch {
    /* already gone */
  }
}

export const sampleOpfs = {
  savePcm: saveSamplePcm,
  loadPcm: loadSamplePcm,
  deletePcm: deleteSamplePcm,
} as const;
