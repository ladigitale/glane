# ADR-0021 — Synthetic sound generator

## Context

Field capture fills the library. Users also want **batch-generated** oneshots and textures (variations around a pivot or around a library referent) that share the same polish / tagging / library pipeline.

## Decision

1. New package **`@glane/audio-synth`** owns normalized param contracts (0–1), sampling (`add` / `mul`), analysis→subtractive anchor heuristics, and offline bake.
2. **Variations**, **Family**, and **Song** modes. Engines bake **single pitches** (optional unison detune for classic synth fatness — never pre-baked chord stacks). **Harmony / chords** belong to sequence generation: each hit retunes from the sample's **recorded fundamental** (`pitchHz`) onto the arrangement timeline. Role **`arp`** in Family remains optional for monophonic phrases; sequence gen builds arpeggios from tonal library oneshots.
3. Family / Song cards expose a **machine façade**: ~4 semantic knobs per role (e.g. kick body/punch/click/length). Each Family role bakes through a **dedicated role synthesizer** (pitch-sweep kick, body+noise snare, metallic hat, …) — not the free multi-engine pipeline. Free engines (subtractive / FM / …) remain for **Variations / pivot** only; role **`arp`** keeps its phrase bake. Raw engine params stay behind an advanced toggle on pivot/arp. Engines remain the DSP layer for Variations.
4. App page **`/synth`** and **`/synth/:sampleId`**. Sequencer generate dialog can hand off BPM/tonic via `sessionStorage` → Song mode.
5. Validated buffers enter the library via **`saveSynthBatch`** (tags `synth` / `synth:role-synth` or `synth:{engine}` / `role:{…}`, polish queue).
6. UI param choices (mode, cards, pivots/ranges, song coherence) persist **per project** in `localStorage` (`synthUiState`), same pattern as sequencer chrome. Still out of scope: AudioWorklet ports for heavy engines; exact re-variation of a saved sample from its bake meta; live arpeggiator in the sequencer; dedicated strings/winds/voice roles (pad/texture cover similar intent for now).

## Consequences

- Generated sounds reuse capture polish + optional YAMNet/CLAP.
- Referent anchors are approximate for field recordings (no true synth params on capture).
- Worklet migration should not require UI contract changes if denormalize maps stay stable.
