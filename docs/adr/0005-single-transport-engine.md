# ADR-0005 — Single TransportEngine

## Context

Separate editor vs sequencer engines diverge and break live-edit guarantees.

## Decision

One `TransportEngine` (lookahead ~150 ms, voice pool). Mono editor is a one-track sequencer with a different UI.

## Consequences

All playhead, scrub, and live mutation paths share one scheduler invalidation path.
