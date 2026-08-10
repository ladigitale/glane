# ADR-0016 — Track controls, FX & editor tools (AudioRoom)

## Context

ADR-0014 covers sequencer drag/snap. AudioRoom also defines the reference UX for **per-track volume/mute**, **light FX**, and the **editor tool column** (`TrkOptions`, `sequence-sounds.sym`, `filters/`, `SndTools`). Glane already models `Track.gainDb` / `mute` / `solo` and clip fades; display and interaction still need a locked pattern.

## Options

1. Clone AudioRoom chrome (rotary art, right-rail widths, filter names, edit/FX tab strip)
2. Borrow interaction grammar only; keep `gl-` field-instrument visuals
3. Invent a DAW-style mixer strip / inspector

## Decision

**Option 2.** Source tree to study: `/home/julien/sites/audioroom/app-mobile/src/audioRoom/` (esp. `comps/seqSnds/TrkOptions.hx`, `SeqContent.hx`, `filters/*`).

### Sequencer (P4) — per track, aligned to the rail

| Control | Behaviour |
|---------|-----------|
| Mute | Dedicated control (not volume=0); horizontal switch / tap OK |
| Volume | Compact **rotary** (not a long fader); range ≈ **0…2×** linear gain with magnetic snaps at **0 / 1 / 2**; finer curve below unity |
| FX | One light insert per track (None / EQ / Echo / Reverb initially); selector + optional param popup — live in the mix |

Rail stays a **column of track controls**, not a floating inspector. Hit targets ≥ 44 px. Solo stays model-backed; UI can stay minimal until needed.

### Editor (P3) — tool column

Two modes (tabs or equivalent), AudioRoom-style:

1. **Edit** — selection ops: crop/truncate, silence, insert silence, copy/cut/paste (as Glane ops allow), normalize, speed/stretch, fade in/out
2. **FX** — apply chosen effect to **selection** or **whole** (bake into edit ops / rendered buffer); not a live rack while editing

Waveform remains the interaction surface (trim/selection/fades on-canvas). Shared transport: ADR-0005.

### Out of scope / defer

- AudioRoom visual skin (colors, rotary LED art as literal assets)
- Deep FX graph, send buses, per-clip inserts beyond fade/gain already on `Clip`
- Marketplace / sync of FX presets (P5+)

## Consequences

- Next UI work: rotary + mute affordances on `gl-sequencer-page` wired to existing `Track` fields via `seq-schedule` / `TransportEngine`
- FX needs a small insert model (track- or project-scoped) before UI; bake path for editor FX must stay crash-safe with master format (ADR-0011)
- Gestures for rotary drag stay under `packages/gestures` arbitration when they share the timeline pointer surface
