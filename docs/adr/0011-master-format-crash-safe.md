# ADR-0011 — Crash-safe master format

## Context

WAV float32 is faithful but header-at-start is fragile on crash. FLAC costs CPU on mobile.

## Decision

Write raw PCM float32 (or interleaved) with a journal; write WAV header on clean close. Measure FLAC later before switching.

## Consequences

Recovery after tab crash reconstructs from raw + segment journal.
