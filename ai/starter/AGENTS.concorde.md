# Agents — Glane (Concorde overlay)

Front: `apps/web` — Lit custom elements `gl-*` + `@supersoniks/concorde`.

## Skills (project)

| Skill | When |
|-------|------|
| `.cursor/skills/concorde-ui/SKILL.md` | Pick UI components by use case |
| `.cursor/skills/concorde-scope/SKILL.md` | Inherited API / form / icon defaults (scope) |
| `.cursor/skills/prefer-tailwind/SKILL.md` | Lit UI: Tailwind `class=` over new BEM/CSS (rule on `apps/web/**/*.ts`) |
| `.cursor/skills/glane-arranger/SKILL.md` | Sequence gen: lock / call–response / kinship between melodic voices |
| `.cursor/skills/glane-themes/SKILL.md` | UI theme palettes (nord / dark / matcha): review & retune `--sc-*` |

## Architecture

- **`apps/web/src/app/`** — product UI (capture, library, editor, sequencer, …)
- **`packages/*`** — audio DSP / engine / IO / gestures / waveform / core-model
- Local-first until P5: IndexedDB/OPFS first; Concorde Endpoint/API when sync lands

## Sync agent files

```bash
yarn ai:sync
```

Concorde source: `node_modules/@supersoniks/concorde/ai/`  
Overlay: `ai/starter/` (this repo).
