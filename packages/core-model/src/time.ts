import { PPQ } from "./config.js";

/** Musical time in ticks (PPQ = 960). Never store float seconds in the model. */
export type Tick = number & { readonly __brand: "Tick" };
export type SampleIndex = number & { readonly __brand: "SampleIndex" };

export function asTick(n: number): Tick {
  return Math.round(n) as Tick;
}

export function asSampleIndex(n: number): SampleIndex {
  return Math.round(n) as SampleIndex;
}

export function ticksToSamples(ticks: Tick, bpm: number, sampleRate: number): SampleIndex {
  const beats = ticks / PPQ;
  const seconds = (beats * 60) / bpm;
  return asSampleIndex(seconds * sampleRate);
}

export function samplesToTicks(samples: SampleIndex, bpm: number, sampleRate: number): Tick {
  const seconds = samples / sampleRate;
  const beats = (seconds * bpm) / 60;
  return asTick(beats * PPQ);
}

export function msToSamples(ms: number, sampleRate: number): SampleIndex {
  return asSampleIndex((ms / 1000) * sampleRate);
}

export function samplesToMs(samples: SampleIndex, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}
