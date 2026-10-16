---
# Recorded from apps/web theme Pack A (nord default). Refresh with /impeccable document after intentional token changes.
colors:
  nord:
    base: "#101820"
    baseContent: "#eef3f8"
    primary: "#2af5d0"
    primaryContent: "#03241c"
    info: "#4ec4ff"
    success: "#c8ff45"
    warning: "#ffc233"
    danger: "#ff5a7a"
  dark:
    base: "#0c0d12"
    baseContent: "#f2f1f6"
    primary: "#ff3d8a"
    primaryContent: "#1a0510"
  matcha:
    base: "#e9ecf1"
    baseContent: "#14161c"
    primary: "#2f3ae0"
    primaryContent: "#f3f4ff"
typography:
  ui: "Plus Jakarta Sans Variable"
  display: "Bricolage Grotesque Variable"
  mono: "JetBrains Mono"
radii:
  nord: "0.2rem"
  nordButton: "0.35rem"
  dark: "0.75rem"
  darkButton: "9999px"
  matcha: "1.5rem"
  matchaButton: "9999px"
components:
  - sonic-theme
  - sonic-button
  - sonic-badge
  - sonic-menu
  - gl-* app shells and pages
---

# Overview

Glane is a **dense audio instrument UI**: dark-first (nord default), flat surfaces, high-contrast accents for transport and status. Visual identity comes from Concorde `--sc-*` tokens bridged as `--gl-*`, not from decorative marketing chrome.

App chrome = **Operate**. Landing = **Persuade** (separate energy; do not leak landing patterns into capture/library/editor).

# Colors

- Source of truth: `apps/web/src/app/styles/themes.css` + `tokens.css`.
- Use semantic tokens (`--sc-primary`, `--sc-danger`, …) and Tailwind `neutral-*` mapped to `--sc-base*`. Never invent one-off hex beside the pack.
- Primary is brand-only (aurora teal on nord, hot pink on dark, firm indigo on matcha/Brume). Info / success / warning / danger keep their hue roles.
- Flat backgrounds — **no page-wide decorative gradients** or glow stacks.

# Typography

- UI: Plus Jakarta Sans Variable (`--gl-font-ui`).
- Display / brand: Bricolage Grotesque Variable (`--gl-font-display`) with tight tracking for titles.
- Mono: JetBrains Mono for meters, timecode, technical readouts.
- These fonts are **intentional brand choices** (not Inter/Geist defaults).

# Layout

- Instrument density: related controls close; clear separation between transport, workspace, and secondary panels.
- Prefer Tailwind utilities in Lit templates; CSS for `:host`, waveforms, and theme bridges only.
- Touch floor `--gl-touch: 44px` for primary tappable actions.
- Avoid nested decorative cards around timelines and queues.

# Elevation & Depth

- Prefer flat surfaces and subtle base-scale steps (`--sc-base-50` …) over heavy shadows.
- Hairline + huge shadow pairs are out of system.

# Shapes

- Radii follow the active theme (nord sharp; dark/matcha softer / pill buttons). Do not mix radius languages across a single screen without switching theme.

# Components

- Prefer Concorde `sonic-*` for buttons, badges, menus, theme.
- App elements use `gl-*` prefix; keep state in DataProvider (`get`/`set`).
- Empty / loading / error states must stay readable on dark themes (muted fg via `--gl-fg-muted`).

# Do’s and Don’ts

**Do**

- Keep Operate screens task-first (waveforms, lists, transport).
- Reuse Pack A themes; document intentional new tokens before spreading hex.
- Honor `prefers-reduced-motion` on landing canvases.

**Don’t**

- Purple-on-white / cream editorial / glassmorphism / neon glow defaults.
- Persuade hero, metric strips, or gradient CTAs inside capture/library/editor.
- Replace `sonic-*` with custom chrome for “polish”.
- Ship Inter/system as the product voice.
