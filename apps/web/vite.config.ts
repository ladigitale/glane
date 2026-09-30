import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const YAMNET_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
/** ~3.9 MiB — reject tiny / failed downloads. */
const YAMNET_MIN_BYTES = 1_000_000;

function resolvePkgDir(...parts: string[]): string | null {
  const candidates = [
    path.join(rootDir, "node_modules", ...parts),
    path.join(rootDir, "../../node_modules", ...parts),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function copyDirFiles(src: string, dest: string, filter?: (name: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (filter && !filter(name)) continue;
    const from = path.join(src, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(dest, name));
  }
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function ensureYamnetModel(): void {
  const dest = path.join(rootDir, "public/ml/yamnet/yamnet.tflite");
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size >= YAMNET_MIN_BYTES) {
      return;
    }
  } catch {
    /* recreate */
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  try {
    execFileSync("curl", ["-fsSL", "-o", tmp, YAMNET_MODEL_URL], {
      stdio: "pipe",
    });
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < YAMNET_MIN_BYTES) {
      throw new Error("yamnet download too small");
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* */
    }
    console.warn(
      "[copy-ml-wasm] YAMNet model download failed — tags need public/ml/yamnet/yamnet.tflite",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Same-origin ML WASM under COEP (ADR-0015).
 * - MediaPipe → public/ml/mediapipe-wasm
 * - YAMNet tflite → public/ml/yamnet (CDN has no CORP)
 * - Transformers ORT → src/app/ml/vendor/ort-tf (Vite `?url`, not /public)
 * Demucs ORT: package exports `onnxruntime-web/…?url`.
 */
function copyMlWasm(): Plugin {
  const sync = () => {
    const mp = resolvePkgDir("@mediapipe", "tasks-audio", "wasm");
    if (mp) {
      copyDirFiles(mp, path.join(rootDir, "public/ml/mediapipe-wasm"));
    }
    ensureYamnetModel();
    const tfOrt = resolvePkgDir("@huggingface", "transformers", "dist");
    if (tfOrt) {
      const dest = path.join(rootDir, "src/app/ml/vendor/ort-tf");
      for (const name of [
        "ort-wasm-simd-threaded.jsep.mjs",
        "ort-wasm-simd-threaded.jsep.wasm",
      ]) {
        const from = path.join(tfOrt, name);
        if (fs.existsSync(from)) copyFile(from, path.join(dest, name));
      }
    }
  };

  return {
    name: "copy-ml-wasm",
    buildStart: sync,
    configureServer() {
      sync();
    },
  };
}

export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [
    copyMlWasm(),
    VitePWA({
      registerType: "autoUpdate",
      // ML WASM/ORT/RNNoise are fetched on demand (Cache Storage / HF); do not SW-precache.
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2,webp}"],
        globIgnores: [
          "**/ml/**",
          "**/vendor/ort-tf/**",
          "**/*ort-wasm*",
          // Bundled ML workers exceed Workbox's 2 MiB precache cap (denoise ~5 MB).
          "**/denoise-worker*",
          "**/demucs-worker*",
          "**/*.wasm",
          "**/*.onnx",
        ],
      },
      manifest: {
        name: "Glane",
        short_name: "Glane",
        description: "Captation et remontage de sons d'ambiance",
        theme_color: "#282a36",
        background_color: "#282a36",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  assetsInclude: ["**/*.wasm", "**/*.onnx"],
  optimizeDeps: {
    include: ["@breezystack/lamejs"],
    exclude: ["onnxruntime-web", "onnxruntime-web/webgpu", "@huggingface/transformers"],
  },
  worker: {
    format: "es",
  },
});
