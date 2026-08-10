/**
 * User-facing bounce encoding (WAV / MP3) + browser download.
 */
export type EncodeWavOpts = {
  sampleRate: number;
  channelCount: number;
  /** IEEE float32 (internal masters) vs int16 (portable download). Default int16. */
  format?: "float32" | "int16";
};

function writeStr(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function encodeWavHeaderBytes(
  dataBytes: number,
  sampleRate: number,
  channelCount: number,
  format: "float32" | "int16",
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const isFloat = format === "float32";
  const bytesPerSample = isFloat ? 4 : 2;
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return buffer;
}

function audioBufferToPlanarFloat(buffer: AudioBuffer): Float32Array[] {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    chans.push(buffer.getChannelData(c).slice());
  }
  return chans;
}

function planarToInterleavedInt16(channels: Float32Array[]): Int16Array {
  const ch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const out = new Int16Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      out[i * ch + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return out;
}

function asBlobPart(view: ArrayBufferView): BlobPart {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy;
}

function encodeWavFromChannels(
  channels: Float32Array[],
  opts: EncodeWavOpts,
): Blob {
  const format = opts.format ?? "int16";
  const channelCount = opts.channelCount;
  if (format === "float32") {
    const frames = channels[0]?.length ?? 0;
    const pcm = new Float32Array(frames * channelCount);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channelCount; c++) {
        pcm[i * channelCount + c] = channels[c]?.[i] ?? 0;
      }
    }
    const header = encodeWavHeaderBytes(
      pcm.byteLength,
      opts.sampleRate,
      channelCount,
      "float32",
    );
    return new Blob([header, asBlobPart(pcm)], { type: "audio/wav" });
  }
  const pcm = planarToInterleavedInt16(channels);
  const header = encodeWavHeaderBytes(
    pcm.byteLength,
    opts.sampleRate,
    channelCount,
    "int16",
  );
  return new Blob([header, asBlobPart(pcm)], { type: "audio/wav" });
}

async function encodeMp3FromChannels(
  channels: Float32Array[],
  sampleRate: number,
  bitrateKbps = 192,
): Promise<Blob> {
  // lamejs is CJS; Vite interop may expose default or named.
  const mod = (await import("lamejs")) as {
    Mp3Encoder?: new (
      channels: number,
      sampleRate: number,
      kbps: number,
    ) => {
      encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
      flush: () => Int8Array;
    };
    default?: {
      Mp3Encoder: new (
        channels: number,
        sampleRate: number,
        kbps: number,
      ) => {
        encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
        flush: () => Int8Array;
      };
    };
  };
  const Mp3Encoder = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error("lamejs Mp3Encoder unavailable");

  const channelCount = Math.min(2, Math.max(1, channels.length));
  const encoder = new Mp3Encoder(channelCount, sampleRate, bitrateKbps);
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  const block = 1152;
  const parts: BlobPart[] = [];
  const leftI16 = new Int16Array(left.length);
  const rightI16 = new Int16Array(right.length);
  for (let i = 0; i < left.length; i++) {
    const sl = Math.max(-1, Math.min(1, left[i]!));
    leftI16[i] = sl < 0 ? sl * 0x8000 : sl * 0x7fff;
    const sr = Math.max(-1, Math.min(1, right[i]!));
    rightI16[i] = sr < 0 ? sr * 0x8000 : sr * 0x7fff;
  }
  for (let i = 0; i < leftI16.length; i += block) {
    const l = leftI16.subarray(i, i + block);
    const r = rightI16.subarray(i, i + block);
    const mp3buf =
      channelCount === 1
        ? encoder.encodeBuffer(l)
        : encoder.encodeBuffer(l, r);
    if (mp3buf.length > 0) parts.push(new Uint8Array(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: "audio/mpeg" });
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has started the download
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, "_").trim() || "glane-export";
}

/** Linear resample (mono). Identity when rates match. */
function resampleLinear(
  pcm: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const outLen = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = pcm.length / outLen;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = pcm[i0]! * (1 - t) + pcm[i1]! * t;
  }
  return out;
}

function encodeWavMono(
  pcm: Float32Array,
  sampleRate: number,
  format: "float32" | "int16" = "int16",
): Blob {
  return encodeWavFromChannels([pcm], {
    sampleRate,
    channelCount: 1,
    format,
  });
}

/** CRC-32 (ZIP) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed (STORE) ZIP — fine for WAV packs, zero deps. */
function zipStore(files: ReadonlyArray<{ path: string; data: Uint8Array }>): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.path.replace(/\\/g, "/"));
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.byteLength, true);
    lv.setUint32(22, f.data.byteLength, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, f.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true); // STORE
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.byteLength, true);
    cv.setUint32(24, f.data.byteLength, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    centrals.push(cen);
    offset += local.length + f.data.byteLength;
  }
  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob(
    [...locals, ...centrals, eocd].map((part) => asBlobPart(part)),
    { type: "application/zip" },
  );
}

export const audioExport = {
  encodeWavHeaderBytes,
  encodeWav(buffer: AudioBuffer, format: "float32" | "int16" = "int16"): Blob {
    return encodeWavFromChannels(audioBufferToPlanarFloat(buffer), {
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
      format,
    });
  },
  encodeWavMono,
  resampleLinear,
  zipStore,
  async encodeMp3(buffer: AudioBuffer, bitrateKbps = 192): Promise<Blob> {
    return encodeMp3FromChannels(
      audioBufferToPlanarFloat(buffer),
      buffer.sampleRate,
      bitrateKbps,
    );
  },
  downloadBlob,
  sanitizeFilename,
} as const;
