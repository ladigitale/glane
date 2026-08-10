/**
 * OPFS session masters — write continuous PCM, close to WAV, recover after crash.
 */
export type OpfsWriteHandle = {
  write(chunk: Float32Array): Promise<void>;
  close(sampleRate: number, channelCount: number): Promise<{ bytes: number; path: string }>;
  readonly path: string;
};

export type SessionJournal = {
  closedAt?: string;
  sampleRate: number;
  channelCount: number;
  pcmBytes: number;
  recovered?: boolean;
};

async function getSessionDir(sessionId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const sessions = await root.getDirectoryHandle("sessions", { create: true });
  return sessions.getDirectoryHandle(sessionId, { create: true });
}

export function encodeWavHeader(
  dataBytes: number,
  sampleRate: number,
  channelCount: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 4, true);
  view.setUint16(32, channelCount * 4, true);
  view.setUint16(34, 32, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  return buffer;
}

export async function openSessionRecording(
  sessionId: string,
): Promise<OpfsWriteHandle> {
  const dir = await getSessionDir(sessionId);
  const fileHandle = await dir.getFileHandle("master.f32", { create: true });
  let offset = 0;
  const path = `sessions/${sessionId}/master.f32`;

  // Mark open session (no closedAt) for crash recovery.
  {
    const journal = await dir.getFileHandle("journal.json", { create: true });
    const jw = await journal.createWritable();
    await jw.write(
      JSON.stringify({
        sampleRate: 48_000,
        channelCount: 1,
        pcmBytes: 0,
        recovered: false,
      } satisfies SessionJournal),
    );
    await jw.close();
  }

  type SyncHandle = {
    write: (data: BufferSource, opts: { at: number }) => number;
    truncate: (size: number) => void;
    flush: () => void;
    close: () => void;
  };

  let sync: SyncHandle | null = null;
  if ("createSyncAccessHandle" in fileHandle) {
    sync = (await (
      fileHandle as FileSystemFileHandle & {
        createSyncAccessHandle: () => Promise<SyncHandle>;
      }
    ).createSyncAccessHandle()) as SyncHandle;
  }

  return {
    path,
    async write(chunk: Float32Array) {
      const copy = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      ) as ArrayBuffer;
      const view = new Float32Array(copy);
      if (sync) {
        sync.write(view, { at: offset });
        offset += view.byteLength;
        return;
      }
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(offset);
      await writable.write(view);
      offset += view.byteLength;
      await writable.close();
    },
    async close(sampleRate: number, channelCount: number) {
      if (sync) {
        sync.flush();
        sync.close();
      }
      await finalizeSessionWav(sessionId, sampleRate, channelCount, false);
      return { bytes: offset + 44, path: `sessions/${sessionId}/master.wav` };
    },
  };
}

/** Write / rewrite master.wav from master.f32 + journal. */
export async function finalizeSessionWav(
  sessionId: string,
  sampleRate: number,
  channelCount: number,
  recovered: boolean,
): Promise<{ bytes: number; pcmBytes: number }> {
  const dir = await getSessionDir(sessionId);
  const fileHandle = await dir.getFileHandle("master.f32");
  const rawFile = await fileHandle.getFile();
  const rawBuf = await rawFile.arrayBuffer();
  const pcmBytes = rawBuf.byteLength;
  const header = encodeWavHeader(pcmBytes, sampleRate, channelCount);
  const out = new Uint8Array(44 + pcmBytes);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(rawBuf), 44);
  const wavHandle = await dir.getFileHandle("master.wav", { create: true });
  const w = await wavHandle.createWritable();
  await w.write(out);
  await w.close();
  const journal = await dir.getFileHandle("journal.json", { create: true });
  const jw = await journal.createWritable();
  await jw.write(
    JSON.stringify({
      closedAt: new Date().toISOString(),
      sampleRate,
      channelCount,
      pcmBytes,
      recovered,
    } satisfies SessionJournal),
  );
  await jw.close();
  return { bytes: out.byteLength, pcmBytes };
}

export async function readSessionJournal(
  sessionId: string,
): Promise<SessionJournal | null> {
  try {
    const dir = await getSessionDir(sessionId);
    const journal = await dir.getFileHandle("journal.json");
    const text = await (await journal.getFile()).text();
    return JSON.parse(text) as SessionJournal;
  } catch {
    return null;
  }
}

export async function recoverSessionIfNeeded(sessionId: string): Promise<boolean> {
  const journal = await readSessionJournal(sessionId);
  if (journal?.closedAt) return false;
  try {
    const dir = await getSessionDir(sessionId);
    await dir.getFileHandle("master.f32");
    return true;
  } catch {
    return false;
  }
}

/** Finalize incomplete OPFS sessions known to Dexie (and any listed ids). */
export async function recoverAllIncompleteSessions(
  metaById: Map<string, { sampleRate: number; channelCount: number }>,
): Promise<string[]> {
  const recovered: string[] = [];
  for (const [name, meta] of metaById) {
    const needs = await recoverSessionIfNeeded(name);
    if (!needs) continue;
    await finalizeSessionWav(name, meta.sampleRate, meta.channelCount, true);
    recovered.push(name);
  }
  // Also scan OPFS for orphans not in meta (best-effort).
  try {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle("sessions");
    const dir = sessions as FileSystemDirectoryHandle & {
      keys?: () => AsyncIterableIterator<string>;
    };
    if (typeof dir.keys === "function") {
      for await (const name of dir.keys()) {
        if (metaById.has(name)) continue;
        const needs = await recoverSessionIfNeeded(name);
        if (!needs) continue;
        await finalizeSessionWav(name, 48_000, 1, true);
        recovered.push(name);
      }
    }
  } catch {
    /* no sessions dir */
  }
  return recovered;
}

export async function loadSessionWav(sessionId: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await getSessionDir(sessionId);
    const file = await (await dir.getFileHandle("master.wav")).getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

/** Float32 PCM from OPFS (skips WAV if only raw exists). */
export async function loadSessionPcm(sessionId: string): Promise<{
  pcm: Float32Array;
  sampleRate: number;
  channelCount: number;
} | null> {
  const journal = await readSessionJournal(sessionId);
  try {
    const dir = await getSessionDir(sessionId);
    try {
      const wav = await (await dir.getFileHandle("master.wav")).getFile();
      const ab = await wav.arrayBuffer();
      // skip 44-byte header → float32 LE
      const pcm = new Float32Array(ab, 44);
      return {
        pcm,
        sampleRate: journal?.sampleRate ?? 48_000,
        channelCount: journal?.channelCount ?? 1,
      };
    } catch {
      const raw = await (await dir.getFileHandle("master.f32")).getFile();
      const ab = await raw.arrayBuffer();
      return {
        pcm: new Float32Array(ab),
        sampleRate: journal?.sampleRate ?? 48_000,
        channelCount: journal?.channelCount ?? 1,
      };
    }
  } catch {
    return null;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function estimateStorage(): Promise<{
  usage: number;
  quota: number;
}> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

export const sessionOpfs = {
  open: openSessionRecording,
  finalize: finalizeSessionWav,
  recoverIfNeeded: recoverSessionIfNeeded,
  recoverAll: recoverAllIncompleteSessions,
  loadWav: loadSessionWav,
  loadPcm: loadSessionPcm,
  journal: readSessionJournal,
  estimate: estimateStorage,
  persist: requestPersistentStorage,
} as const;
