# ADR-0009 — Postgres now, pgvector later

## Context

Tadaaa uses Postgres. Spec suggested pgvector for embeddings.

## Decision

Postgres 16 from day one (Compose). Client-side cosine similarity until sync volume justifies `pgvector`.

## Consequences

No pgvector extension in early migrations.
