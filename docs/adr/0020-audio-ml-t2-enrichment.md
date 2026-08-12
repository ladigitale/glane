# ADR-0020 — Audio ML as T2 enrichment (opt-in)

## Context

Heuristic classification (ADR-0006) covers realtime capture. Users want **stem separation**, **semantic tags**, and **similarity / text search** without blocking the mic path.

## Decision

1. Keep T1 DSP / heuristics on the capture critical path.
2. **Demucs** stem separation (library + editor) — Dedicated Worker + WebGPU preferred, session released after each job.
3. **YAMNet** tags after polish when `mlYamnet` is on.
4. **CLAP** (`Xenova/clap-htsat-unfused`, q8) — opt-in `mlClap` (default off). On-demand via “similar sounds” with confirm. Embeddings in `SampleAnalysis.features.clap`; serialized embed queue + status events for UI.
5. Package `@glane/audio-ml` owns math / tags / ranking; app owns ORT / MediaPipe / Transformers.js.
6. Fail soft everywhere.

## Consequences

- Demucs / CLAP first downloads are large (~166 MB / ~160 MB) and cached in the browser.
- Client cosine similarity until ADR-0009 pgvector.
- Stem children: `parentSampleId` + `stem:{name}` + `ml:demucs`.
