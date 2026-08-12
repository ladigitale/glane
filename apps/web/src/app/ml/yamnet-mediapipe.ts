import {
  centerWindow,
  resampleLinear,
  type AudioClassifierPort,
  type AudioLabelScore,
} from "@glane/audio-ml";

const YAMNET_SR = 16_000;
/** YAMNet patch length ≈ 0.975 s; we feed up to ~4 s center window. */
const WINDOW_SEC = 4;
const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";

type MediaPipeAudio = typeof import("@mediapipe/tasks-audio");

let classifierPromise: Promise<AudioClassifierPort> | null = null;

/**
 * Lazy MediaPipe YAMNet classifier (main thread or worker).
 * WASM from same-origin `/ml/mediapipe-wasm`; model from CORP CDN → Cache Storage.
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

async function createYamnetClassifier(): Promise<AudioClassifierPort> {
  const mp: MediaPipeAudio = await import("@mediapipe/tasks-audio");
  const wasmRoot = `${import.meta.env.BASE_URL}ml/mediapipe-wasm`.replace(
    /\/?$/,
    "",
  );
  const fileset = await mp.FilesetResolver.forAudioTasks(`${wasmRoot}/`);
  const modelBuf = await loadYamnetModelBuffer();
  const classifier = await mp.AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBuf },
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
          if (!cat.categoryName) continue;
          out.push({ label: cat.categoryName, score: cat.score ?? 0 });
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
  const cacheKey = "glane-yamnet-tflite-v1";
  try {
    const cache = await caches.open("glane-ml");
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Uint8Array(await hit.arrayBuffer());
    }
    const res = await fetch(DEFAULT_MODEL_URL, { mode: "cors" });
    if (!res.ok) throw new Error(`yamnet fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    await cache.put(cacheKey, new Response(buf.slice(0), {
      headers: { "Content-Type": "application/octet-stream" },
    }));
    return new Uint8Array(buf);
  } catch {
    const res = await fetch(DEFAULT_MODEL_URL, { mode: "cors" });
    if (!res.ok) throw new Error(`yamnet fetch ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
