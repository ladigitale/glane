# ADR-0020 — Audio ML as T2 enrichment (opt-in)

## Context

Heuristic classification (ADR-0006) covers realtime capture. Users want **stem separation**, **semantic tags**, and **similarity / text search** without blocking the mic path.

## Decision

1. Keep T1 DSP / heuristics on the capture critical path.
2. **Demucs** — HT-Demucs **FT bag** (4 StemSplit ONNX specialists, fp16weights). Dedicated Worker + WebGPU preferred; **one specialist session at a time** then release (peak RAM ≈ single model). Output tensor dims asserted `(1,4,2,N)`; only the matching stem row is kept per specialist. Optional stem subset via `mlDemucsStems`.
3. **YAMNet** tags after polish when `mlYamnet` is on. Tunables: `mlYamnetMinScore`, `mlYamnetMaxLabels`, `mlYamnetAutoClass`.
4. **CLAP** (`Xenova/larger_clap_music_and_speech`, q8) — opt-in `mlClap` (default off). On-demand via “similar sounds” with confirm. Embeddings in `SampleAnalysis.features.clap` keyed by model id (stale checkpoints ignored). Tunables: `mlClapMinScore`, `mlClapLimit`.
5. **RNNoise** (Xiph via `@shiguredo/rnnoise-wasm`) — library / editor batch and single-sample **denoise**. Creates a child sample (`stem:denoised`, parent `ml:denoise`). Chosen over DeepFilterNet3 for Apache-2.0, tiny footprint, and offline batch fit (DeepFilterNet is higher quality but needs a heavy multi-ONNX / proprietary browser stack). Speech-oriented; still useful on field takes with mic hiss / room / wind.
6. Package `@glane/audio-ml` owns math / tags / ranking; app owns ORT / MediaPipe / Transformers.js / RNNoise wasm.
7. Fail soft everywhere.

## Consequences

- Demucs first download ≈ **4×166 MB** cached; inference ~4× slower than single `htdemucs` but better vocals SDR (MUSDB FT).
- CLAP first download is larger than `clap-htsat-unfused`; better music/speech retrieval for field libraries.
- Field speech often lands in Demucs **`other`**, not `vocals` (model is music-trained).
- Client cosine similarity until ADR-0009 pgvector.
- Stem children: `parentSampleId` + `stem:{name}` + `ml:demucs`.
- Denoise children: `parentSampleId` + `stem:denoised` + `ml:denoise` on parent.
