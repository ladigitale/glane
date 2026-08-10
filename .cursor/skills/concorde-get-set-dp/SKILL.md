---
name: concorde-get-set-dp
description: >-
  Migration et usage de get/set/dp avec DataProviderKey statique.
  Rejet des placeholders ${} par resolveStaticPublisherPath ; sub() et
  décorateurs pour le dynamique.
---

# Concorde — get / set / dp (chemins statiques)

Skill de **migration** vers Concorde ≥ 4.6 avec `resolveStaticPublisherPath`.
À activer quand un projet monte de version ou refactorise vers `DataProviderKey`.

Référence framework : skill **`concorde`**, doc `src/docs/_misc/dataProviderKey.md`.

## Quand utiliser cette skill

- Monter `@supersoniks/concorde` avec garde statique sur `get` / `set` / `dp`.
- Auditer un codebase TypeScript existant avant/après upgrade.
- Distinguer **chemin évalué en JS** vs **placeholder Concorde** `${prop}` / `{$prop}`.
- Choisir entre API programmatique (`get/set/dp`) et réactivité (`sub`, décorateurs).

## Règle de rejet (runtime)

`resolveStaticPublisherPath` lève une erreur si la string passée à `get`, `set` ou `dp` contient **`${`** ou **`{$`** :

| Appel | Résultat |
|-------|----------|
| `dp(new DataProviderKey("users.${userIndex}"))` | **throw** |
| `get("users.${userIndex}")` | **throw** |
| `dp(staticKey.path)` si `.path` contient `${` | **throw** |

**OK** — le chemin est résolu **avant** l'appel (pas de placeholder littéral) :

```typescript
set(`app.pages.${index}.isComplete`, true); // → "app.pages.2.isComplete"
dp(`${this.formDataProvider}/fieldName`); // → "checkoutForm/email"
```

**Faux positif fréquent** : grep `${` dans les sources TS ne suffit pas — vérifier la **valeur runtime** passée à `get/set/dp`.

## Rétrocompatibilité

| Avant | Après (recommandé) | Statut |
|-------|-------------------|--------|
| `dp(key.path)` | `dp(key)` | Équivalent si clé statique |
| `set(key.path, v)` | `set(key, v)` | Équivalent |
| `get("myCounter.count")` | `get(key.count)` | Typage amélioré |
| `key.path` dans attribut HTML | Inchangé | Toujours valide |
| `@onAssign(key.path)` | `@handle(key.leaf)` | Migration parallèle (skill `concorde`) |

Aucune rupture pour le code qui passait déjà des **strings résolues** ou des clés **statiques**.

## Trois niveaux d'accès DataProvider

| Mécanisme | Contexte | Dynamique |
|-----------|----------|-----------|
| **`get` / `set` / `dp`** | Code impératif, snapshot instant T | **Non** (placeholder `${` interdit) |
| **`sub(chemin \| clé)`** | Template Lit, réactivité | **Oui** — string, concat JS, ou `DataProviderKey` avec `${prop}` |
| **`@subscribe` / `@publish` / `@handle`** | Propriétés composant | **Oui** — `DataProviderKey<T, U>` avec `"base.${prop}"` |
| **`@bind`** | Legacy / bidirectionnel | Éviter sur composants métier — préférer `@subscribe` |

### `sub()` — dynamique OK (clés incluses), ne pas migrer vers `get()`

`sub()` accepte `string | DataProviderKey`, résout les placeholders `${prop}` depuis le **composant hôte** du template (comme `@subscribe`), et se ré-abonne quand les props observées changent.

```typescript
const userKey = new DataProviderKey<User, { userIndex: number }>("users.${userIndex}");

html`<p>${sub(userKey.name)}</p>`
html`<p>${sub(counterKey.count)}</p>`
html`<p>${sub(this.formDataProvider + ".email")}</p>`
```

Doc : `src/docs/_directives/sub.md`.

**Anti-pattern** : remplacer `sub(…)` par `get(…)` dans un template → perte de réactivité (snapshot unique).

### Clé dynamique Concorde → décorateur ou factory

```typescript
export const resourceKey = new DataProviderKey<ResourceData, { resourceId: string }>(
  "${resourceId}",
);

// ❌ dp(resourceKey) ou dp(resourceKey.path) → throw
export const resourceProvider = (id: string) => dp<ResourceData>(id);

@handle(resourceKey.conf.mode)
onMode(mode: Mode) { /* … */ }
```

## Patterns avant / après

### Statique typé (nouveau code)

```typescript
const cartKey = new DataProviderKey<Cart>("cart");
set(cartKey, { items: [] });
dp(cartKey.items[0].qty).set(1);
```

### ID runtime (string pure, pas placeholder Concorde)

```typescript
dp(resolvedId); // ex. "resource-abc123"
set(`forms/${formId}`, formData);
```

### Index ou segment dynamique via JS (compatible)

**Avant** :

```typescript
set(`app.pages.${index}.isComplete`, isComplete);
return get(`app.labels.${language}.${key}`);
```

**Après** (option typée, même runtime) :

```typescript
const pagesKey = new DataProviderKey<AppState["pages"]>("app.pages");
set(pagesKey[index].isComplete, isComplete);

const labelsKey = new DataProviderKey<AppState["labels"]>("app.labels");
return get(labelsKey[language][key]);
```

**Helper générique** — conserver si le suffixe ne contient jamais `${` :

```typescript
export const appSet = <P extends string>(path: P, value: AppValue<P>) => {
  set(`app.${path}`, value);
};
```

### Chemins entièrement statiques

**Avant** :

```typescript
set("app.widget.computed", value);
const publisher = dp("app.widget.distance");
```

**Après** :

```typescript
const widgetKey = new DataProviderKey<AppState["widget"]>("app.widget");
set(widgetKey.computed, value);
const publisher = dp(widgetKey.distance);
```

## Profils de risque (générique)

| Profil codebase | Risque | Indice |
|-----------------|--------|--------|
| Strings JS uniquement, pas de `DataProviderKey` | Très faible | Chemins déjà résolus avant `get/set/dp` |
| Mix `DataProviderKey` statique + `.path` | Faible | Simplifier `dp(key)` progressivement |
| Clés avec `"${prop}"` passées à `dp()` | **Élevé** | Remplacer par factory `dp(idRésolu)` ou décorateur |
| Templates avec `sub()` | Aucun | Ne pas « migrer » vers `get()` |

Migrations **distinctes** (hors scope) : `PublisherManager`, `@onAssign` → `@handle`.

## Checklist migration (agent)

1. [ ] Confirmer version Concorde avec `resolveStaticPublisherPath` dans `dataProviderKey.ts`.
2. [ ] Chercher `DataProviderKey(` dont le constructeur contient `${` ou `{$`.
3. [ ] Pour chaque hit : si `get` / `set` / `dp` reçoit la clé → factory `dp(idRésolu)` ou décorateur.
4. [ ] Simplifier `dp(staticKey.path)` → `dp(staticKey)` sur clés statiques.
5. [ ] **Ne pas** toucher `sub(...)` ni décorateurs dynamiques sans raison.
6. [ ] Distinguer grep `${` (source) vs valeur runtime.
7. [ ] Tests manuels sur les flux métier qui utilisent clés dynamiques et formulaires `sub()`.

## Anti-patterns

| Anti-pattern | Pourquoi |
|--------------|----------|
| `dp(key)` sur clé `"${resourceId}"` | Throw immédiat |
| `sub()` → `get()` dans template | Perte réactivité |
| Refactor global `.path` → clé sur toutes les clés sans tri statique/dynamique | Régressions |
| Confondre migration get/set/dp et suppression `PublisherManager` | Périmètres différents |

## Fichiers de référence (package Concorde)

- `src/core/utils/dataProviderKey.ts` — `resolveStaticPublisherPath`
- `src/core/utils/PublisherProxy.ts` — overloads `get` / `set` / `dp`
- `src/core/utils/publisherPathKey.spec.ts` — tests
- `src/core/directives/DataProvider.ts` — `sub()`
- `src/docs/_misc/dataProviderKey.md`

## Maintenance

Mettre à jour quand l'API Concorde évolue ou que de nouveaux cas edge sont documentés dans les specs.
