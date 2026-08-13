# ADR-0010 — Stereo capture, stereo-ready model

## Context

Phone field recording is often mono; stereo ambiances are common on external interfaces and desktop. ML classifiers (YAMNet, CLAP) and Demucs stems expect mono or planar stereo at the model boundary.

## Decision

- **v1 capture**: stereo when the device provides it (48 kHz), with mono fallback.
- **Storage**: interleaved float32 PCM in OPFS (`L0,R0,L1,R1,…`); `pcm.length === frames × channelCount`.
- **APIs**: buffers, assets, and engine paths accept `channelCount` (1 or 2).
- **ML / analysis**: downmix to mono at the queue boundary (`toMonoPcm`); Demucs deinterleaves stereo planes before separation; stem outputs stay mono.

## Consequences

- Editor, library audition, and sequencer playback preserve stereo when present.
- No second pipeline rewrite for stereo later; mono remains the degenerate case (`channelCount === 1`).
