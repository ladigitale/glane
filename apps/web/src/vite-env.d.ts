/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url" {
  const url: string;
  export default url;
}

declare module "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url" {
  const url: string;
  export default url;
}

declare module "*.mjs?url" {
  const url: string;
  export default url;
}
