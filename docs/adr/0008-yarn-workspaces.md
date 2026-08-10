# ADR-0008 — Yarn workspaces (not pnpm)

## Context

Spec suggested pnpm; machine + Tadaaa use Yarn 1 + `ssks`.

## Decision

Yarn 1 workspaces: `apps/web`, `packages/*`. Keep `packages/` for audio isolation.

## Consequences

No pnpm lockfile. Align scripts with Tadaaa (`api:up`, etc.).
