/** Non-destructive edit ops for the mono editor (applied over immutable master PCM). */

import { stretchBuffer } from "@glane/audio-dsp";

export type EditorOp =
  | { op: "trim"; startSample: number; endSample: number }
  | { op: "fade"; fadeInMs: number; fadeOutMs: number }
  | { op: "loop"; loopStartSample: number; loopEndSample: number; xfadeMs: number }
  | { op: "normalize_peak"; targetDbtp?: number }
  | { op: "reverse" }
  | { op: "clear_loop" }
  | {
      op: "stretch";
      ratio: number;
      mode: "preserve-pitch" | "resample";
    };

export type EditorState = {
  /** Inclusive start / exclusive end into master. */
  startSample: number;
  endSample: number;
  fadeInMs: number;
  fadeOutMs: number;
  loopStartSample: number | null;
  loopEndSample: number | null;
  loopXfadeMs: number;
  reverse: boolean;
  normalizeGain: number;
  /** Time ratio: >1 shorter/faster (matches stretchBuffer). */
  stretchRatio: number;
  stretchMode: "preserve-pitch" | "resample";
};

export function emptyEditorState(length: number): EditorState {
  return {
    startSample: 0,
    endSample: Math.max(0, length),
    fadeInMs: 0,
    fadeOutMs: 0,
    loopStartSample: null,
    loopEndSample: null,
    loopXfadeMs: 40,
    reverse: false,
    normalizeGain: 1,
    stretchRatio: 1,
    stretchMode: "preserve-pitch",
  };
}

export function applyOps(
  masterLen: number,
  ops: EditorOp[],
): EditorState {
  let s = emptyEditorState(masterLen);
  for (const op of ops) {
    s = applyOne(s, op, masterLen);
  }
  return s;
}

function applyOne(s: EditorState, op: EditorOp, masterLen: number): EditorState {
  switch (op.op) {
    case "trim": {
      const start = Math.max(0, Math.min(op.startSample, masterLen));
      const end = Math.max(start + 1, Math.min(op.endSample, masterLen));
      return { ...s, startSample: start, endSample: end };
    }
    case "fade":
      return {
        ...s,
        fadeInMs: Math.max(0, op.fadeInMs),
        fadeOutMs: Math.max(0, op.fadeOutMs),
      };
    case "loop": {
      const a = Math.max(s.startSample, Math.min(op.loopStartSample, s.endSample - 1));
      const b = Math.max(a + 1, Math.min(op.loopEndSample, s.endSample));
      return {
        ...s,
        loopStartSample: a,
        loopEndSample: b,
        loopXfadeMs: Math.max(0, op.xfadeMs),
      };
    }
    case "clear_loop":
      return { ...s, loopStartSample: null, loopEndSample: null };
    case "normalize_peak":
      return { ...s, normalizeGain: 1 }; // gain computed when rendering
    case "reverse":
      return { ...s, reverse: !s.reverse };
    case "stretch": {
      const ratio = Math.min(4, Math.max(0.25, op.ratio));
      return {
        ...s,
        stretchRatio: s.stretchRatio * ratio,
        stretchMode: op.mode,
      };
    }
  }
}

/** Render a playable Float32Array from master + state (allocates). */
export function renderView(
  master: Float32Array,
  state: EditorState,
  sampleRate: number,
): Float32Array {
  const slice = master.subarray(state.startSample, state.endSample);
  let out = new Float32Array(slice.length);
  out.set(slice);
  if (state.reverse) {
    for (let i = 0, j = out.length - 1; i < j; i++, j--) {
      const t = out[i]!;
      out[i] = out[j]!;
      out[j] = t;
    }
  }

  if (Math.abs(state.stretchRatio - 1) > 1e-3) {
    out = new Float32Array(
      stretchBuffer(out, state.stretchRatio, state.stretchMode),
    );
  }

  const fadeInN = Math.min(
    out.length / 2,
    Math.floor((state.fadeInMs / 1000) * sampleRate),
  );
  const fadeOutN = Math.min(
    out.length / 2,
    Math.floor((state.fadeOutMs / 1000) * sampleRate),
  );
  for (let i = 0; i < fadeInN; i++) {
    out[i] = (out[i] ?? 0) * (i / fadeInN);
  }
  for (let i = 0; i < fadeOutN; i++) {
    const idx = out.length - 1 - i;
    out[idx] = (out[idx] ?? 0) * (i / fadeOutN);
  }
  return out;
}

export function renderNormalized(
  master: Float32Array,
  state: EditorState,
  sampleRate: number,
  doNormalize: boolean,
  peakTargetDbtp = -0.3,
): Float32Array {
  const out = renderView(master, state, sampleRate);
  if (!doNormalize) return out;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i] ?? 0);
    if (a > peak) peak = a;
  }
  if (peak < 1e-9) return out;
  const target = Math.pow(10, peakTargetDbtp / 20);
  const g = target / peak;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * g;
  return out;
}
