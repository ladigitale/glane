# ADR-0018 — One library, N arrangements

## Context

ADR-0017 couples library and arrangement 1:1 inside `Project`. Users often want several montages from the same capture pool (variants, lengths, moods) without duplicating sessions/samples. Project-level create / rename / duplicate / delete must stay for workspaces; the same ops are needed for arrangements.

## Decision

Split the current `Project` blob:

| Entity | Owns | Ops |
|--------|------|-----|
| **Project** (workspace) | Sessions, samples (library), title | create, rename, duplicate (deep: library + all arrangements), soft-delete (cascade library + arrangements) |
| **Arrangement** | `bpm`, `timeSignature`, `bars`, `masterGainDb`, `snapConfig`, tracks, clips, title | create (blank tracks), rename, duplicate (tracks + clips only; clips keep same `sampleId`), soft-delete (tracks + clips; library untouched) |

- `Session` / `Sample` keep `projectId` (library scope).
- `Track` / arrangement meta hang off `arrangementId` (migrate from `projectId`).
- `UserPrefs`: `currentProjectId` + `currentArrangementId` (must belong to current project).
- Sequencer edits the current arrangement; library / capture stay project-scoped.
- Cross-project sample reuse stays out of scope (ADR-0017); sharing is **intra-project** via shared sample ids.

UI: arrangement switcher next to (or under) the project switcher — same affordances as projects (list, new, rename, duplicate, delete), with delete confirm that library is preserved.

## Consequences

- Dexie migration: extract arrangement fields from `Project` into an `arrangements` table; rewrite `tracks.projectId` → `arrangementId`; seed one arrangement per existing project; set prefs.
- Project duplicate remains a full workspace clone (new sample ids / OPFS); arrangement duplicate is cheap (metadata + clip refs).
- Deleting the last arrangement of a project recreates a blank default (never leave a project without an arrangement).
- Product copy: “Projet” = workspace/library; “Arrangement” / “Montage” = sequencer piece.
- Implement after sequencer P4 is stable enough; no change to P0–P3 library capture path beyond prefs wiring.
