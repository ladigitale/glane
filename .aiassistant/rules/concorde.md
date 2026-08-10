# Concorde — patterns agent

Référence doc : fichiers `.md` dans `node_modules/@supersoniks/concorde/src/`.

## Imports

**Apps externes** : chemins courts (`/menu`, `/list`, `/decorators`, `/dataProviderKey`, …).

**Dépôt Concorde (lib + doc)** : `core/components/functional/list/list`, `core/decorators/Subscriber`, `core/utils/dataProviderKey` — pas `@supersoniks/concorde/list` ici.

## Vocabulaire

- **DataProvider** (jamais « publisher »)
- Accès : **get / set** — pas PublisherManager

## Interdits (nouveau code)

- sonic-fetch → sonic-queue + filtre, ou @get
- @onAssign → @handle + DataProviderKey
- data-bind HTML → @subscribe / sub()
- sonic-input + @input → formDataProvider + name
- Templates HTML list/queue → .items, .separator, .noItems, .skeleton
- Chemins longs ui/…, functional/…, core/… quand un alias racine existe

## DataProviderKey dynamique

Placeholder `${prop}` dans une chaîne normale : `"users.${userIndex}"`.

## Scope vs theme

- **Scope** (`sonic-scope`) : `serviceURL`, `formDataProvider`, icônes — skill `concorde-scope`
- **Theme** (`sonic-theme`) : `--sc-*` tokens, dark mode — skill `concorde-theme`
- `@get(endpoint)` sans clé config → hérite scope ; `@get(endpoint, apiConfigKey)` → DataProvider
- Modale / portal : préférer `apiConfigKey` si pas de scope DOM fiable

## Migration Subscriber / sonic-fetch

- Ne pas retirer `Subscriber` sans `@subscribe` feuille par feuille sur chaque champ du `render()`.
- `sonic-fetch` → `@get` + DP ; `@subscribe` ou hôte `Subscriber` avec `dataProvider`/`subDataProvider`.
- Placeholders Endpoint = propriétés homonymes sur l'hôte (`checkCode` → copier vers `code` si besoin).
- `@subscribe` + `@state()`, pas `@property` pour la lecture DP.

## Navigation

sonic-menu + sonic-menu-item + sonic-divider. pushstate + autoActive="strict".

Pas de tirets dans les noms de dossiers routes.
