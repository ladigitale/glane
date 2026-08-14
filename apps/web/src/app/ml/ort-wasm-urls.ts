/**
 * Vite `?url` assets for ORT WASM (avoid `/public` `.mjs` dynamic import — Vite rejects it).
 * Demucs uses app `onnxruntime-web`; CLAP uses Transformers’ bundled ORT (copied under vendor/).
 */
import demucsOrtMjs from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import demucsOrtWasm from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import transformersOrtMjs from "./vendor/ort-tf/ort-wasm-simd-threaded.jsep.mjs?url";
import transformersOrtWasm from "./vendor/ort-tf/ort-wasm-simd-threaded.jsep.wasm?url";

export type OrtWasmPaths = { mjs: string; wasm: string };

export const demucsOrtWasmPaths: OrtWasmPaths = {
  mjs: demucsOrtMjs,
  wasm: demucsOrtWasm,
};

export const transformersOrtWasmPaths: OrtWasmPaths = {
  mjs: transformersOrtMjs,
  wasm: transformersOrtWasm,
};
