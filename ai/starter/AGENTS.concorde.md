# Agents — Glane (Concorde overlay)

Front: `apps/web` — Lit custom elements `gl-*` + `@supersoniks/concorde`.

## Skills (project)

| Skill | When |
|-------|------|
| `.cursor/skills/concorde-ui/SKILL.md` | Pick UI components by use case |
| `.cursor/skills/concorde-scope/SKILL.md` | Inherited API / form / icon defaults (scope) |
| `.cursor/skills/prefer-tailwind/SKILL.md` | Lit UI: Tailwind `class=` over new BEM/CSS (rule on `apps/web/**/*.ts`) |

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
