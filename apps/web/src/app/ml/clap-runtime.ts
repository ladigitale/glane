/**
 * CLAP embeddings via Transformers.js (Xenova/larger_clap_music_and_speech).
 * Lazy-loaded; WebGPU when available. Fail-soft for library search / similar.
 */
import {
  CLAP_FEATURES_KEY,
  centerWindow,
  resampleLinear,
  type ClapEmbeddingFeatures,
} from "@glane/audio-ml";
import { transformersOrtWasmPaths } from "./ort-wasm-urls.js";

/** LAION larger CLAP tuned for music + speech (better field / library fit). */
export const CLAP_MODEL_ID = "Xenova/larger_clap_music_and_speech";
export const CLAP_STATUS_EVENT = "glane:clap-status";

const CLAP_SR = 48_000;
const WINDOW_SEC = 10;

export type ClapStatusDetail = {
  phase: "idle" | "loading-model" | "embedding" | "searching" | "error";
  /** 0–1 when known */
  ratio?: number;
  sampleId?: string;
  message?: string;
};

type Transformers = typeof import("@huggingface/transformers");

let tfPromise: Promise<Transformers> | null = null;
let audioReady: Promise<void> | null = null;
let textReady: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let audioModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textModel: any = null;

function emitStatus(detail: ClapStatusDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLAP_STATUS_EVENT, { detail }));
}

async function loadTransformers(): Promise<Transformers> {
  if (!tfPromise) {
    tfPromise = import("@huggingface/transformers").then((tf) => {
      // Do NOT point at onnxruntime-web: transformers bundles its own ORT (≠ app dep).
      // CDN breaks under COEP; Vite `?url` assets (not /public .mjs).
      try {
        const wasm = tf.env.backends?.onnx?.wasm;
        if (wasm) {
          wasm.numThreads = 1;
          wasm.wasmPaths = transformersOrtWasmPaths;
        }
      } catch {
        /* older env shape */
      }
      tf.env.allowLocalModels = false;
      tf.env.useBrowserCache = true;
      return tf;
    });
  }
  return tfPromise;
}

async function preferDevice(): Promise<"webgpu" | "wasm"> {
  const nav = globalThis.navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
  };
  if (nav?.gpu) {
    try {
      if (await nav.gpu.requestAdapter()) return "webgpu";
    } catch {
      /* */
    }
  }
  return "wasm";
}

function hfProgress(info: {
  status?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}): void {
  let ratio: number | undefined;
  if (typeof info.progress === "number") {
    ratio = info.progress > 1 ? info.progress / 100 : info.progress;
  } else if (info.total && info.loaded) {
    ratio = info.loaded / info.total;
  }
  emitStatus({ phase: "loading-model", ratio, message: info.status });
}

async function ensureAudioModels(): Promise<void> {
  if (audioReady) return audioReady;
  audioReady = (async () => {
    emitStatus({ phase: "loading-model", ratio: 0.05, message: "audio" });
    const tf = await loadTransformers();
    const device = await preferDevice();
    emitStatus({ phase: "loading-model", ratio: 0.15, message: "audio" });
    processor = await tf.AutoProcessor.from_pretrained(CLAP_MODEL_ID, {
      progress_callback: hfProgress,
    });
    emitStatus({ phase: "loading-model", ratio: 0.35, message: "audio" });
    audioModel = await tf.ClapAudioModelWithProjection.from_pretrained(
      CLAP_MODEL_ID,
      { dtype: "q8", device, progress_callback: hfProgress },
    );
    emitStatus({ phase: "idle" });
  })().catch((e) => {
    audioReady = null;
    emitStatus({
      phase: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  });
  return audioReady;
}

async function ensureTextModels(): Promise<void> {
  if (textReady) return textReady;
  textReady = (async () => {
    emitStatus({ phase: "loading-model", ratio: 0.2, message: "text" });
    const tf = await loadTransformers();
    const device = await preferDevice();
    emitStatus({ phase: "loading-model", ratio: 0.5, message: "text" });
    tokenizer = await tf.AutoTokenizer.from_pretrained(CLAP_MODEL_ID, {
      progress_callback: hfProgress,
    });
    emitStatus({ phase: "loading-model", ratio: 0.8, message: "text" });
    textModel = await tf.ClapTextModelWithProjection.from_pretrained(
      CLAP_MODEL_ID,
      { dtype: "q8", device, progress_callback: hfProgress },
    );
    emitStatus({ phase: "idle" });
  })().catch((e) => {
    textReady = null;
    emitStatus({
      phase: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  });
  return textReady;
}

function tensorToVector(embeds: {
  data: ArrayLike<number>;
  dims?: number[];
}): number[] {
  const data = embeds.data;
  const n = data.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = data[i] ?? 0;
  return out;
}

export function isClapAudioReady(): boolean {
  return processor != null && audioModel != null;
}

/** Download / init audio CLAP weights (opt-in or similar-sounds). */
export function preloadClapAudio(): Promise<void> {
  return ensureAudioModels();
}

/** Embed mono PCM → 512-d CLAP vector. */
export async function embedAudioPcm(
  pcm: Float32Array,
  sampleRate: number,
  sampleId?: string,
): Promise<ClapEmbeddingFeatures> {
  await ensureAudioModels();
  emitStatus({ phase: "embedding", sampleId, ratio: 0.3 });
  const windowed = centerWindow(pcm, sampleRate, WINDOW_SEC);
  const at48 =
    sampleRate === CLAP_SR
      ? windowed
      : resampleLinear(windowed, sampleRate, CLAP_SR);
  const inputs = await processor(at48, { sampling_rate: CLAP_SR });
  const { audio_embeds } = await audioModel(inputs);
  const vector = tensorToVector(audio_embeds);
  emitStatus({ phase: "idle", sampleId });
  return {
    model: CLAP_MODEL_ID,
    dims: vector.length,
    vector,
  };
}

/** Embed text query → same space as audio. */
export async function embedTextQuery(text: string): Promise<number[]> {
  await ensureTextModels();
  emitStatus({ phase: "searching", ratio: 0.5 });
  const textInputs = tokenizer([text], {
    padding: true,
    truncation: true,
  });
  const { text_embeds } = await textModel(textInputs);
  const vec = tensorToVector(text_embeds);
  emitStatus({ phase: "idle" });
  return vec;
}

export function clapFeatureFromAnalysis(
  features: Record<string, unknown> | undefined,
): ClapEmbeddingFeatures | null {
  if (!features) return null;
  const raw = features[CLAP_FEATURES_KEY];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ClapEmbeddingFeatures>;
  if (!Array.isArray(o.vector) || o.vector.length === 0) return null;
  // Stale embeddings from a previous checkpoint are not comparable.
  if (o.model !== CLAP_MODEL_ID) return null;
  return {
    model: CLAP_MODEL_ID,
    dims: o.dims ?? o.vector.length,
    vector: o.vector.map((x) => Number(x)),
  };
}
