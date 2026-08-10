---
name: concorde
description: >-
  Composants Web Concorde (Lit) : DataProvider, scope, theme, Endpoint,
  formDataProvider, sonic-list/sonic-queue, @subscribe/@handle/@get.
  @subscribe feuille par feuille (pas d’objet parent + getters).
  Imports courts (@supersoniks/concorde/menu, /list, /utils…).
---

# Concorde — patterns et migrations

Source de vérité : fichiers `.md` dans `node_modules/@supersoniks/concorde/src/` (composants, décorateurs, docs).

**Imports** : toujours les chemins **les plus courts** — voir skill `concorde-imports` et section ci-dessous.

**Vocabulaire** : toujours **DataProvider**. Accès programmatique : **`get(chemin)`** (alias Concorde `dp`), **`set(chemin, valeur)`**. **Pas** `PublisherManager` ni `getDataProvider`.

## Imports (règle prioritaire)

Préférer `@supersoniks/concorde/menu`, `/list`, etc. **dans les apps consommatrices**. Dans le **dépôt Concorde** (lib + doc), utiliser `core/components/…` ou imports relatifs — voir skill `concorde-imports` (section « Dans le dépôt Concorde »).

Référence complète : skill **`concorde-imports`** (`.cursor/skills/concorde-imports/SKILL.md`).

## Interdits pour du **nouveau** code

- **Ne pas** étendre les mixins `Subscriber` / `Fetcher` sur des composants métier.
- **Ne pas** utiliser `data-bind`, `data-publish`, `data-subscribe` en HTML.
- **Ne pas** mettre `@input`, `@change` ou `.value` + assignation manuelle sur **`sonic-input`** quand `formDataProvider` + `name` suffit.
- **Ne pas** introduire `@onAssign` — préférer `@handle` + `DataProviderKey`.
- **Ne pas** utiliser **`@bind`** sur les composants métier — préférer **`@subscribe`** + `DataProviderKey<T, U>` (typage + placeholders `${prop}` sur l’hôte).
- **Ne pas** utiliser **`sonic-fetch`** — préférer **`sonic-queue`** (+ filtre `formDataProvider`) ou **`@get`** + `Endpoint`.
- **Ne pas** importer **`PublisherManager`** — utiliser **`get` / `set`** (réexport Concorde ou wrapper projet).
- **Ne pas** promouvoir les templates HTML (`<template>`, `data-value`) pour **`sonic-list`** / **`sonic-queue`** — préférer **`.items`**, **`.noItems`**, **`.skeleton`**, **`.separator`** (binding propriété Lit obligatoire pour les fonctions).

## DataProvider

Store observable adressé par un chemin string :

```typescript
import { dp, get, set } from "@supersoniks/concorde/utils";
import { DataProviderKey } from "@supersoniks/concorde/dataProviderKey";

const counterKey = new DataProviderKey<{ count: number }>("myCounter");

set(counterKey, { count: 0 });
dp(counterKey.count).set(1);
get(counterKey); // snapshot { count: 1 }
```

Chemins **statiques** uniquement pour `get` / `set` / `dp`. Clés avec `${…}` → décorateurs ou **`sub(clé)`** dans les templates. Migration : skill **`concorde-get-set-dp`**.

Attributs HTML courants :

| Attribut | Rôle |
|----------|------|
| `dataProvider` | Lie un composant au DataProvider à ce chemin |
| `formDataProvider` | Conteneur de formulaire — les champs `name` écrivent dedans |
| `dataFilterProvider` | Filtre lu par `sonic-queue` (relance les requêtes) |

## DataProviderKey

### Chemins statiques

```typescript
const counterKey = new DataProviderKey<{ count: number }>("myCounter");
counterKey.count.path; // "myCounter.count"
```

### Chemins dynamiques (placeholder)

Placeholder `${prop}` dans une **chaîne normale** (pas de backticks). Résolu depuis les propriétés du composant hôte ; ré-abonnement automatique quand elles changent.

```typescript
export const userKey = new DataProviderKey<User, { userIndex: number }>(
  "users.${userIndex}",
);

@property({ type: Number }) userIndex = 0;

@subscribe(userKey)
@state() user: User | null = null;
```

Même mécanisme pour `@handle`, `@publish`, `@subscribe`. Éviter `@bind` (bidirectionnel / chemins string legacy).

Doc : `src/docs/_misc/dataProviderKey.md`, `src/docs/_decorators/subscribe.md`, `handle.md`.

## Endpoint

```typescript
const users = new Endpoint<UsersResponse>("users?offset=$offset&limit=$limit");
users.path;
```

Utilisé avec `@get(endpoint)` ou `@get(endpoint, apiConfigKey)` — voir **Scope** ci-dessous.

## Scope — defaults hérités

Skill dédié : **`concorde-scope`**.

`<sonic-scope>` (light DOM) : les descendants héritent des attributs (`serviceURL`, `token`, `formDataProvider`, icônes custom…).

```typescript
import "@supersoniks/concorde/sonic-scope";
```

```html
<sonic-scope serviceURL="https://api.example.com" formDataProvider="checkout">
  …app…
</sonic-scope>
```

**API** — type `APIConfiguration` (`@supersoniks/concorde/utils/api`) :

| Mode | `@get` | Config |
|------|--------|--------|
| Scope | `@get(endpoint)` | hérite `serviceURL`, `token`, … du scope |
| DataProvider | `@get(endpoint, apiConfigKey)` | objet publié via `set(apiConfigKey, { … })` |

Champs courants : `serviceURL`, `token`, `userName`/`password`, `credentials`, `authToken`, `tokenProvider`.  
Avancés : `cache`, `blockUntilDone`, `keepAlive`, `addHTTPResponse`.

**Ne pas confondre** avec **theme** (couleurs / typo) — skill **`concorde-theme`**.

## Theme — design tokens

Skill dédié : **`concorde-theme`**.

`<sonic-theme background color font>` + variables CSS `--sc-*` (surfaces, sémantique, typo). Pas pour l’API.

```typescript
import "@supersoniks/concorde/theme";
```

## @publish / @subscribe

```typescript
@publish(counterKey.count)
@state()
count = 0;

@subscribe(counterKey.count)
@state()
subscribedCount = 0;
```

### Règle impérative — une souscription par valeur affichée

Sur un composant **`LitElement`** métier, chaque donnée lue dans `render()` doit avoir **son propre** `@subscribe` + `@state()` (ou `@property` si besoin explicite) sur le **publisher feuille** — jamais un abonnement à l’objet parent + getters.

| Anti-pattern | Pourquoi |
|--------------|----------|
| `@subscribe(dpKeys.currentSession)` + `get edito()` | Si seul `edito` change (même référence `Session`), Lit peut **ne pas** re-rendre |
| `@subscribe` sur un parent + `sub()` enfant pour le détail | Mélange deux modèles ; préférer des feuilles cohérentes |

```typescript
// ❌ — re-render non garanti sur sous-clés
@subscribe(dpKeys.currentSession)
@state() session?: Session;
get edito() { return this.session?.edito; }

// ✅ — une propriété réactive par champ du template
@subscribe(dpKeys.currentSession.slug)
@state() slug = "";

@subscribe(dpKeys.currentSession.edito)
@state() edito: Edito | null = null;

@subscribe(dpKeys.currentSession.settings)
@state() settings: SettingsSessionAPI | null = null;
```

**Navigation typée** : chaîner `DataProviderKey` — `dpKeys.currentSession.edito` → `"app.currentSession.edito"`.

**Granularité** : descendre jusqu’à la **feuille** réellement affichée si les mutations ne remplacent pas l’objet intermédiaire (ex. `@subscribe(dpKeys.currentSession.edito.title)` si seul `title` change sans nouvel objet `edito`).

**Templates** : même règle avec `sub(dpKeys.currentSession.edito.title)` plutôt que `sub(dpKeys.currentSession)` + accès JS.

### Cas hybride — hôte `Subscriber` + enfants sonic

Des composants catalogue (`sonic-event-location-hall`, `sonic-date`, `sonic-product-title`, …) remontent l’arbre pour `dataProvider` et utilisent le **template filling** du mixin `Subscriber` — pas un `@subscribe` local.

| Situation | Approche |
|-----------|----------|
| Composant métier **sans** enfants `Subscriber` | `LitElement` + `@subscribe` **feuille par feuille** |
| Composant **hôte** d’enfants sonic `Subscriber` | `extends Subscriber(LitElement)` + `@property` remplies par template filling ; **exposer** `dataProvider` aux descendants |

**`dataProvider` imbriqué** (éviter la clé plate `"app.currentSession"`) :

```html
<mon-composant-hote dataProvider="app" subDataProvider="currentSession"></mon-composant-hote>
```

Après `initPublisher`, refléter le chemin résolu sur l’attribut (ex. `app/currentSession`) pour que les **enfants** héritent le bon publisher — ils ne lisent pas `subDataProvider` sur l’ancêtre.

**Liste / queue** : chaque ligne a son publisher — l’hôte **hérite** de l’ancêtre ; ne pas forcer `app.currentSession` sur un item de liste.

### Piège migration `Subscriber` → `LitElement` (checklist)

Lors du remplacement de `sonic-fetch` ou du retrait du mixin `Subscriber` sur un composant **métier** :

| Étape | Vérification |
|-------|----------------|
| Champs affichés dans `render()` | Chaque `@property` autrefois remplie par template filling → **`@subscribe(dpKey.feuille)` + `@state()`** (pas laisser des `@property` orphelins) |
| Enfant d’un `@get` | `@get` + `@publish`/`@handle` vers le DataProvider cible ; l’UI lit ce DP via `@subscribe`, pas via des props vides |
| Placeholders `Endpoint` | Les noms `${prop}` doivent exister sur l’hôte (`@property` ou copie dans `willUpdate` si le scan utilise un autre nom, ex. `checkCode` → `code`) |
| Modale / portal | `@get(endpoint, apiConfigKey)` si pas de `serviceURL` ascendant fiable (`Modal` → `Theme.getPopContainer()`) |
| Remplacement `sonic-fetch` | Expliciter `dataProvider` + `subDataProvider` sur les hôtes `Subscriber` enfants (ex. `app` + `currentScanTicket`) |

```typescript
// ❌ — Subscriber retiré, props jamais alimentées
export class TicketInfos extends LitElement {
  @property({ type: Object }) owner = {};
  render() { return html`${this.owner?.firstName}`; }
}

// ✅ — une souscription par champ affiché
@subscribe(dpKeys.currentScanTicket.owner)
@state() owner: Contact = {};
```

**`@subscribe` + décorateur Lit** : préférer **`@state()`** (pas `@property`) pour les champs purement lus depuis le DataProvider.

## formDataProvider

```html
<div formDataProvider="myForm">
  <sonic-input name="value" label="Texte"></sonic-input>
</div>
```

Initialisation : `set("myForm", { value: "" })`.

## sonic-queue — scroll infini + recherche

Pagination (`$offset` / `$limit`) **automatisée** avec `lazyload`.

```html
<div formDataProvider="myFilter">
  <sonic-input name="q" type="search" label="Rechercher"></sonic-input>
</div>
<sonic-queue
  lazyload
  dataFilterProvider="myFilter"
  dataProviderExpression="users?offset=$offset&limit=$limit"
  serviceurl="…"
  key="data"
  limit="4"
  .items=${renderUser}
></sonic-queue>
```

## Templates sonic-list / sonic-queue

Propriétés Lit (recommandé) :

| Propriété | Rôle |
|-----------|------|
| `.items=${fn}` | Rendu de chaque ligne — **point obligatoire** (Lit ne passe pas les fonctions en attribut HTML) |
| `.separator` | Entre chaque item (pas après le dernier) |
| `.noItems` | Liste vide |
| `.skeleton` | Chargement pendant un `fetch` |

`sonic-queue` transmet ces propriétés à chaque lot (`sonic-list` interne). `.noItems` ne s’applique qu’au **premier** lot.

## Décorateurs

| Besoin | API |
|--------|-----|
| Lire (affichage Lit) | `@subscribe(dpKey.leaf)` + `@state()` — **une fois par champ** du `render()` |
| Effet typé | `@handle(dpKey.a, …)` |
| API HTTP | `@get(Endpoint)` ou `@get(Endpoint, apiConfigKey)` |
| Écriture classe (hors form) | `@publish` |
| Lecture classe (hors form) | `@subscribe` + `DataProviderKey` — pas `@bind` |

## Migrations courantes

| Ancien | Nouveau |
|--------|---------|
| `PublisherManager.get(…)` | `get(…)` ou `set(…)` |
| « publisher » | DataProvider |
| `sonic-input` + `@input` | `formDataProvider` + `name` |
| `sonic-fetch` | `sonic-queue` + filtre, ou `@get` + `@publish`/`@handle` + `@subscribe` / hôte `Subscriber` |
| `extends Subscriber(LitElement)` (métier seul) | `LitElement` + `@subscribe` feuille par feuille / `sub()` — **ne pas oublier** les champs template-filled |
| `extends Subscriber` (hôte d’enfants sonic) | Conserver `Subscriber` + `dataProvider` / `subDataProvider` corrects |
| `@get` dans modale | `@get(endpoint, apiConfigKey)` si config API hors scope DOM |
| `data-bind` HTML | `@subscribe` / `sub()` |
| `@bind` décorateur | `@subscribe` + `DataProviderKey` (lecture) ou `@publish` (écriture) |
| `@onAssign` | `@handle` + `DataProviderKey` |
| Templates HTML list/queue | `items`, `.separator`, `.noItems`, `.skeleton` (propriétés Lit) |

## Recettes

- **Initialiser un DataProvider** : `set(key, { … })` ou `set(key.path, { … })`.
- **Formulaire** : `formDataProvider` + `name` → `sub()` ou `@subscribe`.
- **Liste scroll infini** : `sonic-queue` + `lazyload` + `dataFilterProvider`.
- **Templates list/queue** : `items`, `separator`, `noItems`, `skeleton` (depuis un parent Lit).
- **Config API app-wide** : `<sonic-scope serviceURL="…">` ou `DataProviderKey<APIConfiguration>`.
- **Theme / couleurs** : `<sonic-theme>` + CSS `--sc-*`.
- **Clé dynamique** : `"chemin.${prop}"` + `DataProviderKey<T, { prop: … }>`.
