# ADR-0003 — Cross-origin isolation for SharedArrayBuffer

## Context

Lock-free ring buffer between AudioWorklet and analysis workers wants `SharedArrayBuffer` → COOP `same-origin` + COEP `require-corp` (or `credentialless`).

## Decision

Enable isolation on Vite and production. Inventory third-party assets for CORP. Fallback: `postMessage` + Transferable (same features, lower throughput).

## Consequences

Capability detection at runtime; never UA sniffing. Diagnostic UI shows isolation status.
