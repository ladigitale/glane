# ADR-0002 — Local-first, server second

## Context

Field use needs offline cold-start. Masters must not leave the device until the user asks.

## Decision

Audio in OPFS; metadata in IndexedDB (Dexie). Sync opportunistic in P5 (Wi‑Fi default). Policies: local-only / metadata-only / full sync.

## Consequences

API Platform is optional until P5. Product DoD for P0–P4 never requires network.
