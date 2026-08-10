# Imports Concorde — chemins courts

Toujours préférer le **chemin export le plus court** documenté dans `package.json` de `@supersoniks/concorde` — **dans les projets consommateurs** (apps qui installent le package).

Éviter les chemins `ui/…`, `functional/…`, `core/…` quand un alias racine existe **en dehors du monorepo Concorde**.

## Dans le dépôt Concorde (lib + doc)

Les exports courts (`@supersoniks/concorde/list`, `/menu`, `/queue`, …) **ne résolvent pas** ici : l’alias Vite `@supersoniks/concorde` pointe sur `src/`, pas sur les sous-chemins `package.json`.

| Besoin | ✅ Dans ce repo | ❌ Ne pas utiliser ici |
|--------|----------------|------------------------|
| `sonic-list` | `import "../../core/components/functional/list/list"` ou `@supersoniks/concorde/core/components/functional/list/list` | `@supersoniks/concorde/list` |
| `sonic-queue` | `…/core/components/functional/queue/queue` | `@supersoniks/concorde/queue` |
| UI (button, input, …) | `…/core/components/ui/…` ou relatif depuis `src/docs` | `@supersoniks/concorde/button`, etc. |
| `@subscribe`, `@ancestorAttribute` | `@supersoniks/concorde/core/decorators/Subscriber` | — |
| `DataProviderKey` | `@supersoniks/concorde/core/utils/dataProviderKey` | `@supersoniks/concorde/dataProviderKey` (alias doc seulement si configuré) |

`@supersoniks/concorde/decorators` peut fonctionner (fichier `src/decorators.ts`) ; préférer quand même les chemins `core/…` dans `src/docs/example/**` pour cohérence.

## Composants UI

| Composant | ✅ Préférer | ❌ Éviter |
|-----------|------------|----------|
| Menu | `@supersoniks/concorde/menu` | `…/ui/menu` |
| Menu item | `@supersoniks/concorde/menu-item` | `…/ui/menu-item` |
| Divider | `@supersoniks/concorde/divider` | `…/ui/divider` |
| Button | `@supersoniks/concorde/button` | `…/ui/button` |
| Theme | `@supersoniks/concorde/theme` | `…/ui/theme` |
| Scope | `@supersoniks/concorde/sonic-scope` | `…/functional/sonic-scope` |
| Input | `@supersoniks/concorde/input` | `…/ui/form/input` |
| Select | `@supersoniks/concorde/select` | `…/ui/form/select` |
| Checkbox | `@supersoniks/concorde/checkbox` | `…/ui/form/checkbox` |

## Composants fonctionnels

| Composant | ✅ Préférer | ❌ Éviter |
|-----------|------------|----------|
| List | `@supersoniks/concorde/list` | `…/functional/list` |
| Queue | `@supersoniks/concorde/queue` | `…/functional/queue` |
| Router | `@supersoniks/concorde/router` | `…/core/components/functional/router/router` |
| Fetch | `@supersoniks/concorde/fetch` | `…/functional/fetch` |
| Value | `@supersoniks/concorde/value` | `…/functional/value` |

## Utilitaires & types

| Besoin | ✅ Préférer | ❌ Éviter |
|--------|------------|----------|
| Décorateurs | `@supersoniks/concorde/decorators` | chemins `…/core/decorators/…` |
| Directives (`sub`) | `@supersoniks/concorde/directives` | — |
| `get` / `set` / `dp` | `@supersoniks/concorde/utils` | `PublisherManager` |
| `DataProviderKey` | `@supersoniks/concorde/dataProviderKey` | `…/core/utils/dataProviderKey` |
| `Endpoint` | `@supersoniks/concorde/utils/endpoint` | `…/core/utils/endpoint` |
| `APIConfiguration` | `@supersoniks/concorde/utils/api` | `…/core/utils/api` |
| Vite config | `@supersoniks/concorde/vite-config` | — |

## Exemples

```typescript
import "@supersoniks/concorde/menu";
import "@supersoniks/concorde/menu-item";
import "@supersoniks/concorde/divider";
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/theme";
import "@supersoniks/concorde/input";
import "@supersoniks/concorde/list";
import "@supersoniks/concorde/queue";
import "@supersoniks/concorde/router";

import { subscribe, handle, get } from "@supersoniks/concorde/decorators";
import { sub } from "@supersoniks/concorde/directives";
import { get, set } from "@supersoniks/concorde/utils";
import { DataProviderKey } from "@supersoniks/concorde/dataProviderKey";
import { Endpoint } from "@supersoniks/concorde/utils/endpoint";
import type { APIConfiguration } from "@supersoniks/concorde/utils/api";
```

Side-effect imports (enregistrement custom elements) : toujours le chemin **composant** court ci-dessus.
