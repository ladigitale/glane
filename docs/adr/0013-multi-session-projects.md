# ADR-0013 — Multi-session samples in a project

## Context

Arrangements naturally mix takes from several sessions.

## Decision

`Clip` → `SampleVersion` → `Sample` with any `sessionId`. Project BPM is independent of session dominant BPM.

## Consequences

Library drawer filters by session optionally; tempo normalize uses project BPM.
