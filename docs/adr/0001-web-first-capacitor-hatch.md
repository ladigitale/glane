# ADR-0001 — Web-first, Capacitor as escape hatch

## Context

Long ambient recordings with the screen off are unreliable on iOS Safari (`AudioContext` suspended in background).

## Options

1. Native-only (Swift/Kotlin)
2. Web PWA only, accept screen-on constraint
3. Web-first + `AudioCaptureSource` interface + optional Capacitor native capture later

## Decision

Option 3. v1: screen-on capture, Wake Lock, dim "economy screen", gap markers on suspend. Capacitor only if a 45‑minute iPhone test proves the economy mode insufficient.

## Consequences

All capture goes through `AudioCaptureSource`. UI stays web. Native plugin is an adapter, not a rewrite.
