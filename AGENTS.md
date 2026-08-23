# Glane — agent notes

Field-recording instrument: capture → segment → library → arrange.

## Naming

| Surface | Value |
|---------|-------|
| Product | `APP_NAME` = **Glane** (`packages/core-model` / `apps/web` config; API `APP_NAME` env) |
| CE prefix | `gl-` |
| Host path | `/usr2/sites/poc/glane` (or `/home/julien/sites/poc/glane`) |
| Container path | `/sites/poc/glane` when mounted via devops; Compose API workdir `/app` |
| DB | Postgres `glane` |
| Vhost (typical) | `glane.julien.test` |

## Stack

- **Yarn 1** workspaces (`apps/web`, `packages/*`) — not pnpm
- **Lit** + `@supersoniks/concorde`; custom elements `gl-*`
- **Local-first P0–P4**: OPFS + IndexedDB; API/sync in **P5**
- **T2 ML** (`@glane/audio-ml`): Demucs stems, YAMNet tags, CLAP search (ADR-0020)
- **API**: FrankenPHP + Symfony + API Platform + Postgres (Tadaaa-family Compose)
- Mercure: off until P5 (`MERCURE_ENABLED=0`)

## Commands

```bash
yarn status          # git / node / docker / health / JWT
yarn setup           # yarn install + JWT + docker compose up (+ composer si possible)
yarn setup -- --no-docker
yarn update          # refresh deps (+ composer/rebuild si stack up)
# Ne pas définir scripts.install → setup (boucle lifecycle Yarn)
yarn env:up          # démarre FrankenPHP + Postgres
yarn env:down
yarn jwt:generate

# Front (via ssks on this machine)
ssks yarn setup -- --no-docker
ssks yarn dev

# API shortcuts
yarn api:logs
yarn api:migrate
yarn api:composer install
yarn api:sh

# Agent / Concorde skills
yarn ai:sync
```

Never run `php` / `composer` / heavy `yarn build` on the host outside Docker/`ssks`.

## Phases

See plan: Bootstrap → P0 capture → P1 detect → P2 library → P3 editor → P4 sequencer → P5 sync → P6 polish.

## Sister apps

SSO handoff with Tadaaa is post-auth (Belts pattern); not required for local capture.

<!-- concorde-ai -->

# Agents — Concorde

Guide pour les agents IA sur un projet **Concorde** (Lit + DataProvider).

## Skills / rules (après installation)

| Fichier | Rôle |
|---------|------|
| `.cursor/skills/concorde/SKILL.md` | Patterns framework |
| `.cursor/skills/concorde-imports/SKILL.md` | Imports courts |
| `.cursor/skills/concorde-scope/SKILL.md` | Scope + APIConfiguration |
| `.cursor/skills/concorde-theme/SKILL.md` | Design tokens sonic-theme |
| `.cursor/skills/concorde-menu/SKILL.md` | Navigation sonic-menu |
| `.cursor/skills/concorde-get-set-dp/SKILL.md` | Migration get/set/dp + DataProviderKey statique |
| `.cursor/rules/concorde.mdc` | Règles Cursor (patterns) |
| `.aiassistant/rules/concorde.md` | Règles JetBrains AI Assistant |

Installation :

```bash
node node_modules/@supersoniks/concorde/scripts/ai-init.mjs
```

Source : `@supersoniks/concorde/ai/`

## Imports dans ce dépôt (lib + doc)

Les chemins courts (`@supersoniks/concorde/list`, `/menu`, `/queue`, …) sont des **exports npm** pour les apps **externes**. Dans le repo Concorde (`src/docs`, `src/core`, démos), utiliser les chemins **réels** :

- Composants : `@supersoniks/concorde/core/components/…` ou import relatif (`../../core/components/functional/list/list`)
- Décorateurs : `@supersoniks/concorde/core/decorators/Subscriber` (ou `src/decorators.ts` via `@supersoniks/concorde/decorators` si résolu par l’alias Vite racine)
- `DataProviderKey` : `@supersoniks/concorde/core/utils/dataProviderKey`

Skill **`concorde-imports`** : section « Dans le dépôt Concorde ».

## Conventions impératives

- Toujours **DataProvider**, accès via **`get` / `set`**
- Pas de **`sonic-fetch`**, pas de **`PublisherManager`**
- Pas de `@onAssign` — **`@handle`** + `DataProviderKey`
- Pas de **`@bind`** sur les composants métier — **`@subscribe`** + `DataProviderKey<T, U>` (type + contraintes hôte `${…}`)
- Formulaires : **`formDataProvider`** + `name` sur `sonic-input`
- Listes : templates **Lit** (`.items`, `.separator`, `.noItems`, `.skeleton`) — pas de promotion des `<template>` HTML
- **Scope** (API/forms) ≠ **theme** (couleurs) — skills `concorde-scope` / `concorde-theme`

## Migration get / set / dp

Skill **`concorde-get-set-dp`** : chemins sans placeholder **`${…}`** / **`{$…}`** pour `get` / `set` / `dp` ; chemins JS évalués OK ; clés dynamiques → décorateurs, `dp(idRésolu)`, ou **`sub(clé)`** dans les templates Lit.

## Migration Subscriber / sonic-fetch

Skill **`concorde`** — section **« Piège migration Subscriber → LitElement »** : ne pas laisser des `@property` orphelines après retrait du mixin ; `@get` + `@subscribe` feuille ; `apiConfigKey` en modale ; sync des noms de props pour les `Endpoint` dynamiques.

## Documentation

Fichiers `.md` dans le package : `node_modules/@supersoniks/concorde/src/` (composants, décorateurs, getting-started).

---

# Agents — Glane (Concorde overlay)

Front: `apps/web` — Lit custom elements `gl-*` + `@supersoniks/concorde`.

## Skills (project)

| Skill | When |
|-------|------|
| `.cursor/skills/concorde-ui/SKILL.md` | Pick UI components by use case |
| `.cursor/skills/concorde-scope/SKILL.md` | Inherited API / form / icon defaults (scope) |
| `.cursor/skills/prefer-tailwind/SKILL.md` | Lit UI: Tailwind `class=` over new BEM/CSS (rule on `apps/web/**/*.ts`) |
| `.cursor/skills/glane-arranger/SKILL.md` | Sequence gen: lock / call–response / kinship between melodic voices |

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
