import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Same-origin ML WASM under COEP (ADR-0015).
 * - MediaPipe → public/ml/mediapipe-wasm
 * - Transformers ORT → src/app/ml/vendor/ort-tf (Vite `?url`, not /public)
 * Demucs ORT: package exports `onnxruntime-web/…?url`.
 */
function copyMlWasm(): Plugin {
  const sync = () => {
    const mp = resolvePkgDir("@mediapipe", "tasks-audio", "wasm");
    if (mp) {
      copyDirFiles(mp, path.join(rootDir, "public/ml/mediapipe-wasm"));
    }
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
      // ML WASM/ORT are fetched on demand (Cache Storage / HF); do not SW-precache.
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2,webp}"],
        globIgnores: [
          "**/ml/**",
          "**/vendor/ort-tf/**",
          "**/*ort-wasm*",
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
