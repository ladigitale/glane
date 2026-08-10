# ADR-0006 — Heuristic classification first

## Context

ML in the realtime path risks latency and opacity.

## Decision

T1: rules + versioned thresholds. T2: optional ONNX enrichment (tags/similarity). Store full class score vectors; allow manual reclass.

## Consequences

No ONNX on the capture critical path. User corrections become future training signal.
