---
name: prefer-tailwind
description: >-
  Lit/Concorde (Glane): Tailwind utilities in class= not new BEM/CSS. CSS for
  :host, print, fullscreen, timeline chrome hooks only. Tokens bg-neutral-0.
---

# prefer-tailwind (Glane)

Layout / spacing / color → `class="flex gap-3 …"` — not new component CSS.
Tokens: `bg-neutral-0`, `text-neutral-500`, `text-primary` (Concorde `--sc-*` via `tailwind.config.js`).
Import: `import tailwind from "../../css/tailwind"` (adjust depth) → `static styles = [tailwind]` or `[tailwind, hostCss]`.

Keep CSS only for: `:host`, print, fullscreen, complex timeline/seek chrome (pseudo, absolute playhead/handles) — **do not inject the full Tailwind sheet into `edit-timeline` / seek chrome hosts** (flex + sticky canvas collapses). Prefer `!` utilities over new `#id` / BEM when fighting legacy.

No behavior change. New UI in `apps/web/**/*.ts` must follow this.

Wire: `apps/web/src/css/tailwind.ts` + `postcss.config.cjs` / `tailwind.config.cjs` (package is `"type":"module"` — use `.cjs`). `preflight: false` — do not inject `@tailwind base` into Lit shadows.
