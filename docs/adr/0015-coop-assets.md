# ADR-0015 — COOP/COEP and third-party assets

## Context

Cross-origin isolation breaks undeclared third-party scripts/fonts/CDN.

## Decision

Prefer self-hosted Concorde/fonts. Vite COOP/COEP in dev. Document CORP requirements. Fallback path without SAB if isolation fails.

## Consequences

Audit `index.html` deps whenever adding CDN scripts.
