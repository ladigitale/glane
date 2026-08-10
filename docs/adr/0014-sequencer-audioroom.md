# ADR-0014 — Sequencer ergonomics vs AudioRoom

## Context

Spec §11 cites AudioRoom as the mobile arrangement reference (drag fluidity, timeline readability, handles).

## Options

1. Clone AudioRoom interactions wholesale
2. Borrow selectively: snap feedback, trim targets, drawer library; keep Glane tool palette + gesture FSM
3. Ignore and invent from scratch

## Decision

Option 2 (to be refined when P4 deepens). Adopt: magnetic snap with visual+haptic confirm, 44 px hit targets, cancel-zone at top, long-press duplicate. Defer: AudioRoom-specific chrome that fights the `gl-` field-instrument look.

## Consequences

`packages/gestures` remains source of truth for pointer arbitration. Visual polish follows capture/carotte language, not a DAW skin.

Track volume / mute / FX and editor tool column: see ADR-0016.
