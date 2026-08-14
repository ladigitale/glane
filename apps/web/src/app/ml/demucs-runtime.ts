/**
 * HT-Demucs FT bag ONNX runtime (runs inside demucs-worker; WebGPU when available).
 * One specialist session at a time — peak RAM ≈ single-model, better vocals SDR.
 */
import {
  DEMUCS_N_SAMPLES,
  DEMUCS_SAMPLE_RATE,
  DEMUCS_STEMS,
  resampleLinear,
  separateOverlapAdd,
  stereoToMono,
  type DemucsStemName,
} from "@glane/audio-ml";
import {
  clampChannelCount,
  deinterleave,
  frameCount,
  sliceFrames,
} from "@glane/audio-dsp";
import { demucsOrtWasmPaths } from "./ort-wasm-urls.js";

/** StemSplit FT specialists (fp16weights) — only the matching output row is high quality. */
export const DEMUCS_FT_MODEL_URLS: Record<DemucsStemName, string> = {
  drums:
    "https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/main/htdemucs_ft_drums_fp16weights.onnx",
  bass: "https://huggingface.co/StemSplitio/htdemucs-ft-bass-onnx/resolve/main/htdemucs_ft_bass_fp16weights.onnx",
  other:
    "https://huggingface.co/StemSplitio/htdemucs-ft-other-onnx/resolve/main/htdemucs_ft_other_fp16weights.onnx",
  vocals:
    "https://huggingface.co/StemSplitio/htdemucs-ft-vocals-onnx/resolve/main/htdemucs_ft_vocals_fp16weights.onnx",
};

const CACHE_KEY_PREFIX = "glane-htdemucs-ft-fp16-v1";
const MODEL_MIN_BYTES = 80_000_000;
const MAX_SEPARATE_SEC = 60;

/** @deprecated Prefer DEMUCS_FT_MODEL_URLS; kept for call sites that expect a single URL. */
export const DEMUCS_MODEL_URL = DEMUCS_FT_MODEL_URLS.vocals;

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

export type DemucsSeparateResult = {
  sampleRate: number;
  stems: Record<DemucsStemName, Float32Array>;
  /** webgpu | wasm */
  backend: string;
};

export function demucsCacheKey(stem: DemucsStemName): string {
  return `${CACHE_KEY_PREFIX}-${stem}`;
}

export function formatOrtError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/bad_alloc|ERROR_CODE:\s*6|out of memory|OOM/i.test(raw)) {
    return (
      "Mémoire insuffisante pour Demucs (compte ~1–2 Go libres, WebGPU recommandé). " +
      "Ferme d’autres onglets, Chrome desktop, réessaie. " +
      `(${raw.slice(0, 100)})`
    );
  }
  if (/both async and sync fetching of the wasm|no available backend/i.test(raw)) {
    return (
      "Backend ONNX WASM indisponible. " +
      "Hard-refresh après restart de `yarn dev`. " +
      `(${raw.slice(0, 120)})`
    );
  }
  return raw;
}

function isOom(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return /bad_alloc|ERROR_CODE:\s*6|out of memory|OOM/i.test(raw);
}

export async function hasWebGpu(): Promise<boolean> {
  const nav = globalThis.navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
  };
  if (!nav?.gpu) return false;
  try {
    return !!(await nav.gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadOrt(preferGpu: boolean): Promise<OrtModule> {
  if (preferGpu) {
    try {
      return (await import("onnxruntime-web/webgpu")) as OrtModule;
    } catch {
      /* fall through */
    }
  }
  return import("onnxruntime-web");
}

/** Same-origin ORT via Vite `?url` (not /public — Vite blocks public .mjs imports). */
function configureWasm(ort: OrtModule): void {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = demucsOrtWasmPaths;
}

function lowMemOpts(
  providers: string[],
): import("onnxruntime-web").InferenceSession.SessionOptions {
  return {
    executionProviders: providers,
    graphOptimizationLevel: "disabled",
    enableCpuMemArena: false,
    enableMemPattern: false,
  };
}

export async function fetchDemucsModel(
  stem: DemucsStemName,
  onDownload?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const url = DEMUCS_FT_MODEL_URLS[stem];
  const cacheKey = demucsCacheKey(stem);
  const cache = await caches.open("glane-ml");
  const hit = await cache.match(cacheKey);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength >= MODEL_MIN_BYTES) {
      onDownload?.(buf.byteLength, buf.byteLength);
      return buf;
    }
    await cache.delete(cacheKey);
  }

  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`model fetch ${res.status} (${stem})`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    await putCache(cache, cacheKey, buf);
    onDownload?.(buf.byteLength, buf.byteLength);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onDownload?.(loaded, total);
    }
  }
  const buf = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  if (buf.byteLength < MODEL_MIN_BYTES) {
    throw new Error(
      `modèle Demucs ${stem} incomplet (${Math.round(buf.byteLength / 1e6)} Mo)`,
    );
  }
  await putCache(cache, cacheKey, buf.buffer);
  return buf.buffer;
}

async function putCache(
  cache: Cache,
  cacheKey: string,
  buf: ArrayBuffer,
): Promise<void> {
  try {
    await cache.put(
      cacheKey,
      new Response(buf.slice(0), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  } catch {
    /* QuotaExceeded */
  }
}

/** Prefetch all FT specialists into Cache Storage (one at a time). */
export async function preloadDemucsModels(
  stems: readonly DemucsStemName[] = DEMUCS_STEMS,
  onDownload?: (loaded: number, total: number, stem: DemucsStemName) => void,
): Promise<void> {
  for (const stem of stems) {
    await fetchDemucsModel(stem, (loaded, total) =>
      onDownload?.(loaded, total, stem),
    );
  }
}

export type DemucsSessionHandle = {
  ort: OrtModule;
  session: OrtSession;
  backend: string;
  release: () => Promise<void>;
};

/** Create a session; prefer WebGPU (avoids WASM bad_alloc on large models). */
export async function createDemucsSession(
  modelBytes: Uint8Array,
): Promise<DemucsSessionHandle> {
  const preferGpu = await hasWebGpu();
  const ort = await loadOrt(preferGpu);
  configureWasm(ort);

  const attempts: string[][] = preferGpu
    ? [["webgpu"], ["wasm"]]
    : [["wasm"]];

  let lastErr: unknown;
  for (const providers of attempts) {
    try {
      const session = await ort.InferenceSession.create(
        modelBytes,
        lowMemOpts(providers),
      );
      return {
        ort,
        session,
        backend: providers[0] ?? "wasm",
        release: async () => {
          try {
            await session.release();
          } catch {
            /* ignore */
          }
        },
      };
    } catch (e) {
      lastErr = e;
      if (isOom(e)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function centerTrimInterleaved(
  pcm: Float32Array,
  channelCount: number,
  maxFrames: number,
): Float32Array {
  const ch = clampChannelCount(channelCount);
  const frames = frameCount(pcm, ch);
  if (frames <= maxFrames) return pcm;
  const startFrame = Math.floor((frames - maxFrames) / 2);
  return sliceFrames(pcm, ch, startFrame, startFrame + maxFrames);
}

function assertStemTensor(
  stems: import("onnxruntime-web").Tensor,
): Float32Array {
  if (!(stems.data instanceof Float32Array)) {
    throw new Error("unexpected Demucs output dtype");
  }
  const dims = stems.dims;
  if (
    !dims ||
    dims.length !== 4 ||
    dims[0] !== 1 ||
    dims[1] !== 4 ||
    dims[2] !== 2 ||
    dims[3] !== DEMUCS_N_SAMPLES
  ) {
    throw new Error(`unexpected Demucs dims ${JSON.stringify(dims)}`);
  }
  return stems.data.slice() as Float32Array;
}

export async function runDemucsSeparate(
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
  opts?: {
    stems?: readonly DemucsStemName[];
    onProgress?: (ratio: number) => void;
    onDownload?: (loaded: number, total: number, stem: DemucsStemName) => void;
  },
): Promise<DemucsSeparateResult> {
  const stemNames = opts?.stems?.length
    ? opts.stems.filter((s) => DEMUCS_STEMS.includes(s))
    : [...DEMUCS_STEMS];
  if (stemNames.length === 0) {
    throw new Error("Aucun stem Demucs sélectionné");
  }

  const ch = clampChannelCount(channelCount);
  const maxInFrames = Math.round(MAX_SEPARATE_SEC * sampleRate);
  const trimmed = centerTrimInterleaved(pcm, ch, maxInFrames);
  const planes = deinterleave(trimmed, ch);
  const resamplePlane = (plane: Float32Array): Float32Array =>
    sampleRate === DEMUCS_SAMPLE_RATE
      ? plane
      : resampleLinear(plane, sampleRate, DEMUCS_SAMPLE_RATE);
  const left = resamplePlane(planes[0]!);
  const right = ch >= 2 && planes[1] ? resamplePlane(planes[1]) : left;

  const stems = {} as Record<DemucsStemName, Float32Array>;
  let backend = "wasm";
  const n = stemNames.length;

  for (let i = 0; i < n; i++) {
    const stem = stemNames[i]!;
    const buf = await fetchDemucsModel(stem, (loaded, total) =>
      opts?.onDownload?.(loaded, total, stem),
    );
    const handle = await createDemucsSession(new Uint8Array(buf));
    backend = handle.backend;
    try {
      const { ort, session } = handle;
      const separated = await separateOverlapAdd(
        left,
        right,
        async (mixFlat) => {
          const input = new Float32Array(mixFlat);
          const tensor = new ort.Tensor("float32", input, [
            1,
            2,
            DEMUCS_N_SAMPLES,
          ]);
          const out = await session.run({ mix: tensor });
          const tensorOut = out.stems;
          if (!tensorOut) throw new Error("unexpected Demucs output");
          return assertStemTensor(tensorOut);
        },
        {
          stems: [stem],
          onProgress: (p) => {
            opts?.onProgress?.((i + p.ratio) / n);
          },
        },
      );
      const mono = stereoToMono(separated[stem].left, separated[stem].right);
      stems[stem] =
        sampleRate === DEMUCS_SAMPLE_RATE
          ? mono
          : resampleLinear(mono, DEMUCS_SAMPLE_RATE, sampleRate);
    } finally {
      await handle.release();
    }
  }

  // Fill missing stems with silence so callers iterating DEMUCS_STEMS stay safe.
  const len =
    stems[stemNames[0]!]?.length ??
    Math.round((left.length * sampleRate) / DEMUCS_SAMPLE_RATE);
  for (const name of DEMUCS_STEMS) {
    if (!stems[name]) stems[name] = new Float32Array(len);
  }

  return { sampleRate, stems, backend };
}

export { DEMUCS_STEMS };
