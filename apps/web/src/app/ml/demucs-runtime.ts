/**
 * HT-Demucs ONNX runtime (runs inside demucs-worker; WebGPU when available).
 * Keeps peak RAM down via low-mem session opts + release after each job.
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
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";

export const DEMUCS_MODEL_URL =
  "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx";

const MAX_SEPARATE_SEC = 60;
const MODEL_MIN_BYTES = 80_000_000;
const CACHE_KEY = "glane-htdemucs-fp16-v2";

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

export type DemucsSeparateResult = {
  sampleRate: number;
  stems: Record<DemucsStemName, Float32Array>;
  /** webgpu | wasm */
  backend: string;
};

export function formatOrtError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/bad_alloc|ERROR_CODE:\s*6|out of memory|OOM/i.test(raw)) {
    return (
      "Mémoire insuffisante pour Demucs (compte ~1–2 Go libres, WebGPU recommandé). " +
      "Ferme d’autres onglets, Chrome desktop, réessaie. " +
      `(${raw.slice(0, 100)})`
    );
  }
  return raw;
}

function isOom(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return /bad_alloc|ERROR_CODE:\s*6|out of memory|OOM/i.test(raw);
}

function absoluteUrl(path: string): string {
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return new URL(path, globalThis.location.origin).href;
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

function configureWasm(ort: OrtModule): void {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: absoluteUrl(ortWasmMjsUrl),
    wasm: absoluteUrl(ortWasmUrl),
  };
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
  url: string = DEMUCS_MODEL_URL,
  onDownload?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await caches.open("glane-ml");
  const hit = await cache.match(CACHE_KEY);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength >= MODEL_MIN_BYTES) {
      onDownload?.(buf.byteLength, buf.byteLength);
      return buf;
    }
    await cache.delete(CACHE_KEY);
  }

  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`model fetch ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    await putCache(cache, buf);
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
      `modèle Demucs incomplet (${Math.round(buf.byteLength / 1e6)} Mo)`,
    );
  }
  await putCache(cache, buf.buffer);
  return buf.buffer;
}

async function putCache(cache: Cache, buf: ArrayBuffer): Promise<void> {
  try {
    await cache.put(
      CACHE_KEY,
      new Response(buf.slice(0), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  } catch {
    /* QuotaExceeded */
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

export async function runDemucsSeparate(
  handle: DemucsSessionHandle,
  pcm: Float32Array,
  sampleRate: number,
  channelCount = 1,
  onProgress?: (ratio: number) => void,
): Promise<DemucsSeparateResult> {
  const { ort, session, backend } = handle;
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

  const separated = await separateOverlapAdd(
    left,
    right,
    async (mixFlat) => {
      const input = new Float32Array(mixFlat);
      const tensor = new ort.Tensor("float32", input, [1, 2, DEMUCS_N_SAMPLES]);
      const out = await session.run({ mix: tensor });
      const stems = out.stems;
      if (!stems || !(stems.data instanceof Float32Array)) {
        throw new Error("unexpected Demucs output");
      }
      return stems.data.slice() as Float32Array;
    },
    {
      onProgress: (p) => onProgress?.(p.ratio),
    },
  );

  const stems = {} as Record<DemucsStemName, Float32Array>;
  for (const name of DEMUCS_STEMS) {
    const mono = stereoToMono(separated[name].left, separated[name].right);
    stems[name] =
      sampleRate === DEMUCS_SAMPLE_RATE
        ? mono
        : resampleLinear(mono, DEMUCS_SAMPLE_RATE, sampleRate);
  }
  return { sampleRate, stems, backend };
}

export { DEMUCS_STEMS };
