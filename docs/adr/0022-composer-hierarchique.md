# ADR-0022 — Hierarchical composer (`@glane/composer`)

## Context

The web generative planner mixed composition (form, harmony, rhythm, melody) with sample rendering. Random per-bar pruning and sequential RNG made phrases unstable and hard to test.

## Decision

1. **`packages/composer`** — pure TS layers: DNA-ish genes → form → harmony → drums/bass/melody/beds → ensemble → modulation → gestures → mix/master → `Score`.
2. **Addressed RNG** — `rng(seed, path)`; regenerate one node without reshuffling the rest.
3. **Web façade** — `planSequence` → `compose` → `realizeComposerScore` (sample seat, stretch, fades, float pitch). Optional `automation` / `master` / `sends` on the result.
4. **Playback** — automation ramps + send buses A/B in `TransportEngine` (ADR-0023).

## Consequences

Form/energy UI maps to composer `FormFamily` / `EnergyShape`. Legacy `planSequenceLegacy` removed. Song DNA builders live in `dna.ts` (`buildSongDna` / `assembleSongDna`). Timeline shows `Project.formSections` banner after generate. Sample rhythm genes (§10): onset → `RhythmGene` + UI « Groove depuis mes sons ». Mixcheck appends plan warnings. Style generator profiles in `styles/profiles.ts` drive auto form/mode/groove/ensemble + slider centers (web reuses them). Send buses A/B in audio-engine + `Project.spaces` / track `sendA`/`sendB`. Lock-regenerate: `makeComposeRng` + UI locks (forme/harmonie/drums/mélodie/expression) + « Régénérer (déverrouillés) ». Layer matrix enter thresholds lowered (more activity); breaks keep hats; bass unlocks from kick with style motion and rare hook-lead on bridge/break.
