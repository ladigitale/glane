---
name: glane-themes
description: >-
  Review and retune Glane UI theme palettes (nord / dark / matcha) via Concorde
  --sc-* tokens. Use when editing themes.css, theme.ts, tokens.css, or when the
  user asks about theme colors, contrast, Pack A, or appearance presets.
---

# glane-themes

UI color design for Glane Pack A themes. **Not** API scope (`concorde-scope`). Framework wiring: `concorde-theme`. Tailwind mapping: `prefer-tailwind`.

## Source of truth

| File | Role |
|------|------|
| [`apps/web/src/app/styles/themes.css`](apps/web/src/app/styles/themes.css) | Per-theme `--sc-*` under `html[data-theme="…"]` |
| [`apps/web/src/app/styles/tokens.css`](apps/web/src/app/styles/tokens.css) | Fonts, `--gl-*` aliases, `:root` default (= Nord) |
| [`apps/web/src/app/theme.ts`](apps/web/src/app/theme.ts) | Ids, `themeColor` meta, `DEFAULT_THEME_ID` |
| [`apps/web/tailwind.config.cjs`](apps/web/tailwind.config.cjs) | `neutral-*` / `primary` → `--sc-*` |

Ids: `nord` (default) · `dark` · `matcha`.

Bridge: `--gl-ink` ← `--sc-base`, `--gl-fg` ← `--sc-base-content`, `--gl-accent` ← `--sc-primary`. Tailwind `bg-neutral-*` → `--sc-base-*` (header = `bg-neutral-100` → `--sc-base-100`).

### Concorde `sonic-theme` remap (critical)

`sonic-theme[theme=dark]` redefines `--sc-base` / `--sc-primary` / … as `var(--sc-dark-*, fallback)`. If `--sc-dark-*` is unset, chrome (header `bg-neutral-100`, buttons) stays on Concorde defaults while `html`/`body` may show Pack A — **orphan neutrals**.

- Dark themes (`nord`, `dark`): set **both** `--sc-*` and `--sc-dark-*` (mirror with `var(--sc-…)`).
- Light (`matcha`): Concorde `theme=light` **hardcodes** `#fff` slate — do **not** set `theme="light"` on `sonic-theme` (app passes `theme="dark"` only when dark). Own the light palette via `--sc-*` on `html` + `sonic-theme`.

Spot-check after any palette edit: page `bg` (`--sc-base`) **and** header `bg-neutral-100` (`--sc-base-100` via dark bridge).

Palette helper: [concordecolors](https://delanfranchi.github.io/concordecolors/).

## Quality anchor

**Nord** sets the usability bar (clear base→100 steps, readable text, `--sc-dark-*` bridge). Accents may be high-chroma / eccentric when the user asks — neutrals stay coherent.

Nord character: deeper polar ink + electric aurora teal. All three themes: **tranché** accents, clear neutral steps (page `base` → header `100`), eccentric modern — no desert / muted clay.

## Semantic color theory (required)

Status roles are a **fixed hue wheel** (chroma may be high; hue is not optional):

| Token | Hue family | Approx. |
|-------|------------|---------|
| `--sc-primary` | Brand only — **one** hue, not a status | Theme-specific |
| `--sc-info` | Blue | ~200–220° |
| `--sc-success` | Green | ~140–160° |
| `--sc-warning` | Amber / gold | ~40–50° |
| `--sc-danger` | Red | ~0–15° |

Rules:

1. Primary must **not** sit in the danger or warning band (hot pink brand is OK if danger is clearly redder ≈0–10° and warning is yellower ≈45°).
2. Never use mint/sky/rose as interchangeable stickers without mapping to the table above.
3. Neutrals share **one undertone** family — no competing chroma in `base`…`200`.
4. Status fills share a similar chroma “loudness” so they read as a system.

## Theme characters (preserve when retuning)

| Id | Mood (labels) | Neutrals | Brand primary |
|----|---------------|----------|---------------|
| `nord` | Polar night (`Nord`) | Cool ink blue-grey, sharp steps | Electric aurora teal |
| `dark` | Ink (`Encre` / `Ink`) | Near-black cool ink | Hot pink — high chroma |
| `matcha` | Sorbet (`Sorbet`) | Lilac mist paper — **not white** | Electric indigo |

## Review workflow

Copy and track:

```
Theme review:
- [ ] Read themes.css + theme.ts themeColor
- [ ] Score each theme vs Nord (surfaces / chrome / accents)
- [ ] List defects (contrast, chroma, AI-slop, scale jumps)
- [ ] Propose hex tables (keep ids + rounded tokens unless asked)
- [ ] Patch themes.css (+ themeColor; tokens.css :root only if Nord changes)
- [ ] Spot-check: header `bg-neutral-100`, buttons primary, alerts, timeline `--gl-*`
```

### Checklist (every non-Nord theme)

1. **Surfaces / neutrals** — `base` → `50` → `100` → `200` usable as page / header (`bg-neutral-100`) / panel. Mirror into `--sc-dark-*` on dark themes. No neon chrome fills.
2. **Scale direction** — Dark themes: rising lightness toward `900`. Light themes: rising darkness toward `900`. Monotonic; ~even perceptual steps.
3. **Text** — `--sc-base-content` on `--sc-base` ≥ WCAG AA (~4.5:1 body). Muted UI can use `400`/`500` but stays readable on `base`/`50`/`100`.
4. **Primary** — Distinct from info/success/warning/danger; `--sc-primary-content` readable on primary. One brand accent, not a rainbow.
5. **Semantics** — Fixed hue wheel (info blue / success green / warning amber / danger red); separable at a glance; content colors pass on their fill.
6. **AI-slop reject** — No generic desert clay; no orphan Concorde neutrals; no random sticker pastels. High-chroma brand OK if semantics stay on the hue wheel.
7. **Rounded** — Keep per-theme `--sc-rounded` / `--sc-btn-rounded` unless redesigning shape language.
8. **Meta** — `themeColor` in `theme.ts` matches `--sc-base`.
9. **sonic-theme** — Dark: `--sc-dark-*` bridge set. Light: no `theme="light"` on host. Header `bg-neutral-100` matches Pack A, not Concorde default.

### Output format (review only)

```markdown
## Theme color review

### Verdict
- nord: keep | tweak (why)
- dark: retune | keep (why)
- matcha: retune | keep (why)

### Issues
| Theme | Token | Problem | Severity |
|-------|-------|---------|----------|

### Proposed palettes
(full --sc-* hex block per retuned theme)

### Files to edit
- themes.css …
```

Do **not** change component classnames or invent parallel CSS variables — retune tokens only.

## Edit rules

- Prefer editing `themes.css` only.
- Sync `:root` in `tokens.css` when Nord defaults change.
- Update `themeColor` in `theme.ts` when `--sc-base` changes.
- No new theme ids unless asked.
- Flat surfaces (no page gradients) — Pack A convention.
- After hex changes: user switches theme in UI; agent does not need a browser unless asked.

## Companion skills

- `concorde-theme` — `<sonic-theme>` / variable names
- `prefer-tailwind` — consume via `bg-neutral-*` / `text-primary`, not raw hex in components
- `concorde-ui` — which sonic-* types use primary / danger / …
