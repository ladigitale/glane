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

/** Same-origin MediaPipe WASM (required under COEP). ORT uses Vite ?url imports. */
function copyMediapipeWasm(): Plugin {
  const sync = () => {
    const mp = resolvePkgDir("@mediapipe", "tasks-audio", "wasm");
    if (mp) {
      copyDirFiles(mp, path.join(rootDir, "public/ml/mediapipe-wasm"));
    }
  };

  return {
    name: "copy-mediapipe-wasm",
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
    copyMediapipeWasm(),
    VitePWA({
      registerType: "autoUpdate",
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
