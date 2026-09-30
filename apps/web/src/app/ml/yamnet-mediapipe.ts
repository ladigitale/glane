import {
  centerWindow,
  resampleLinear,
  type AudioClassifierPort,
  type AudioLabelScore,
} from "@glane/audio-ml";

const YAMNET_SR = 16_000;
/** YAMNet patch length ≈ 0.975 s; we feed up to ~4 s center window. */
const WINDOW_SEC = 4;
/** Same-origin copy (Vite `copy-ml-wasm`) — required under COEP (CDN has no CORP). */
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";

type MediaPipeAudio = typeof import("@mediapipe/tasks-audio");

let classifierPromise: Promise<AudioClassifierPort> | null = null;

function localModelUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}ml/yamnet/yamnet.tflite`;
}

/**
 * Lazy MediaPipe YAMNet classifier (main thread or worker).
 * Prefer {@link yamnetClient} on the UI thread — `classify` is sync WASM.
 * WASM from same-origin `/ml/mediapipe-wasm`; model from `/ml/yamnet` (Cache Storage).
 */
export async function getYamnetClassifier(): Promise<AudioClassifierPort> {
  if (!classifierPromise) {
    classifierPromise = createYamnetClassifier().catch((err) => {
      classifierPromise = null;
      throw err;
    });
  }
  return classifierPromise;
}

/** Bootstrap MediaPipe YAMNet (main thread — module workers lack importScripts). */
export async function createYamnetClassifier(): Promise<AudioClassifierPort> {
  const mp: MediaPipeAudio = await import("@mediapipe/tasks-audio");
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  // No trailing slash — FilesetResolver joins with `/${name}.js`.
  const wasmRoot = `${prefix}ml/mediapipe-wasm`.replace(/\/+$/, "");
  const fileset = await mp.FilesetResolver.forAudioTasks(wasmRoot);
  const modelBuf = await loadYamnetModelBuffer();
  // MediaPipe may transfer/detach the buffer — pass a dedicated copy.
  const modelCopy = new Uint8Array(modelBuf);
  const classifier = await mp.AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelCopy },
    maxResults: 8,
    scoreThreshold: 0.08,
  });

  return {
    async classify(
      pcm: Float32Array,
      sampleRate: number,
    ): Promise<AudioLabelScore[]> {
      const mono16 = resampleLinear(
        centerWindow(pcm, sampleRate, WINDOW_SEC),
        sampleRate,
        YAMNET_SR,
      );
      const results = classifier.classify(mono16, YAMNET_SR);
      const out: AudioLabelScore[] = [];
      for (const block of results) {
        for (const cat of block.classifications?.[0]?.categories ?? []) {
          const label = cat.categoryName || cat.displayName;
          if (!label) continue;
          out.push({ label, score: cat.score ?? 0 });
        }
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    },
    dispose() {
      classifier.close();
    },
  };
}

async function loadYamnetModelBuffer(): Promise<Uint8Array> {
  const cacheKey = "glane-yamnet-tflite-v2-local";
  try {
    const cache = await caches.open("glane-ml");
    const hit = await cache.match(cacheKey);
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer());
      if (buf.byteLength > 1_000_000) return buf;
    }
    const local = await fetch(localModelUrl());
    if (local.ok) {
      const buf = await local.arrayBuffer();
      if (buf.byteLength > 1_000_000) {
        await cache.put(
          cacheKey,
          new Response(buf.slice(0), {
            headers: { "Content-Type": "application/octet-stream" },
          }),
        );
        return new Uint8Array(buf);
      }
    }
    // Last resort (often blocked by COEP — CDN lacks CORP).
    const res = await fetch(CDN_MODEL_URL, { mode: "cors" });
    if (!res.ok) throw new Error(`yamnet fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    await cache.put(
      cacheKey,
      new Response(buf.slice(0), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    return new Uint8Array(buf);
  } catch (e) {
    const local = await fetch(localModelUrl());
    if (local.ok) {
      return new Uint8Array(await local.arrayBuffer());
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}
