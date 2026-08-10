# ADR-0010 — Mono capture, stereo-ready model

## Context

Phone field recording is typically mono; stereo ambiances are nicer later.

## Decision

v1 capture: mono 48 kHz. Buffers, assets, and engine APIs accept `channelCount >= 1`.

## Consequences

No stereo UI in v1; no pipeline rewrite for stereo later.
