# ADR-0004 — DSP in WASM; MIT time-stretch

## Context

Rubber Band is GPL/commercial; SoundTouch LGPL; signalsmith-stretch is MIT.

## Decision

Analysis/processing in WASM (Rust preferred) called from Workers. Zero alloc on the audio thread. Default stretch: `signalsmith-stretch` (MIT). Thresholds live in `packages/audio-dsp/config`.

## Consequences

JS may prototype descriptors until WASM is wired; contract stays pure `Float32Array` in / structured out.
