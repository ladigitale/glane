import type { AudioLabelScore } from "@glane/audio-ml";
import { getYamnetClassifier } from "./yamnet-mediapipe.js";

/**
 * YAMNet client on the UI thread (serialized jobs).
 *
 * MediaPipe’s WASM glue expects `importScripts`, which module workers do not
 * provide — Vite then rewrites `import(…/audio_wasm_internal.js)` with
 * `?import` and fails. Main-thread load keeps the public/ WASM path working
 * under COEP; jobs stay queued so classify does not overlap.
 */
export const yamnetClient = (() => {
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    async preload(): Promise<void> {
      await enqueue(async () => {
        await getYamnetClassifier();
      });
    },

    classify(
      pcm: Float32Array,
      sampleRate: number,
    ): Promise<AudioLabelScore[]> {
      return enqueue(async () => {
        const c = await getYamnetClassifier();
        return c.classify(pcm, sampleRate);
      });
    },
  };
})();
