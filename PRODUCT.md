# Glane

## Platform

web

## Audience

Field recordists, sound designers, and musicians who capture audio outdoors or in uncontrolled spaces, then segment, tag, and rearrange material on a laptop or tablet in the browser.

They often work between takes: one hand on gear, limited attention, need status and transport controls to stay obvious.

## Purpose

Local-first instrument: **capture → segment → library → arrange** (and related listen / synth / sequencer surfaces). Primary jobs:

1. Record or import reliably with clear transport feedback.
2. Find and preview samples in the library without losing place.
3. Edit slices / timeline with dense, precise controls.
4. Theme and chrome must stay out of the way of waveforms and meters.

## Constraints

- Stack: Lit + `@supersoniks/concorde` (`gl-*` custom elements). Prefer `sonic-*` primitives; do not invent parallel controls.
- Themes: Pack A — `nord` (default), `dark`, `matcha`. Tokens in `apps/web/src/app/styles/`. Flat surfaces; no page-wide decorative gradients.
- Local-first P0–P4 (OPFS + IndexedDB); API/sync is later (P5). Do not design as if cloud sync is required for core flows.
- Touch target floor: `--gl-touch` (44px) where primary actions are tappable.
- Accessibility: keyboard, focus rings, `prefers-reduced-motion` for landing motion.
- Brand fonts are intentional (Plus Jakarta Sans, Bricolage Grotesque, JetBrains Mono) — not Inter defaults.

## Terminology

| Term | Meaning |
|------|---------|
| Capture | Live or file ingest into the local library |
| Slice / segment | Cut of a recording used as a sample |
| Library | Browse / search / tag local samples |
| Arrange / sequencer | Timeline / sequencing of slices |
| Theme Pack A | nord / dark / matcha palettes on `--sc-*` |

## Design workflow

- Default build path: **code-led** (dense Operate UI).
- Visitor modes: app screens = **Operate**; marketing landing = **Persuade**; privacy/docs-like = **Read**.
- Skills: project `/impeccable`, bridge `ssks-impeccable`, Concorde skills after `yarn ai:sync`.

## Evidence on hand

- Implemented themes and tokens under `apps/web/src/app/styles/`
- Pages: capture, library, editor, sequencer, listen, synth, landing, workspace hub
- Product notes: `AGENTS.md`
