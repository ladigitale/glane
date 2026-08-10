---
name: concorde-menu
description: >-
  Menus et navigation Concorde : sonic-menu, sonic-menu-item, sonic-divider.
  Sidebar, sections, routes pushstate.
---

# Concorde — menus et navigation

Référence doc : `node_modules/@supersoniks/concorde/src/core/components/ui/menu/menu.md`

## Imports

```typescript
import "@supersoniks/concorde/menu";
import "@supersoniks/concorde/divider";
```

## Structure type (navigation latérale)

```html
<nav aria-label="Navigation latérale">
  <sonic-menu direction="column" align="left" size="sm" class="w-full">
    <sonic-menu-item pushstate href="/" autoActive="strict">Accueil</sonic-menu-item>

    <sonic-divider label="Section A" align="left" size="sm"></sonic-divider>
    <sonic-menu-item pushstate href="/a/page" autoActive="strict">Page A</sonic-menu-item>

    <sonic-divider label="Section B" align="left" size="sm"></sonic-divider>
    <sonic-menu-item pushstate href="/b/page" autoActive="strict">Page B</sonic-menu-item>
  </sonic-menu>
</nav>
```

## Règles

| Contexte | Composants |
|----------|------------|
| Liste de liens / nav | **`sonic-menu`** + **`sonic-menu-item`** |
| Séparation de sections | **`sonic-divider`** avec `label` |
| Liens internes (router Concorde) | `pushstate` + `href` sur **`sonic-menu-item`** |
| Item actif | `autoActive="strict"` sur chaque item de route |

## Interdits pour la navigation

- **Ne pas** empiler des **`sonic-button`** ghost pour simuler un menu latéral.
- **Ne pas** inventer des séparateurs custom quand **`sonic-divider`** suffit.
- **Ne pas** oublier `pushstate` sur les liens internes.
- **Ne pas** mettre `autoActive` sur le **`sonic-menu`** — c’est sur chaque **`sonic-menu-item`**.

## Attributs utiles

### sonic-menu

`direction="column"`, `align="left"`, `size="sm"` pour une sidebar.

### sonic-menu-item

Hérite de **`sonic-button`** : `pushstate`, `href`, `autoActive`, `variant`.

### sonic-divider

`label`, `align="left"`, `size="sm"`.

## Routes fichier

Pas de **tirets** dans les noms de dossiers sous `routes/` — le générateur Concorde produit des identifiants JS invalides (`dpkey-dynamic` → erreur).

## Checklist

- [ ] `sonic-menu` englobe tous les items
- [ ] Sections séparées par `sonic-divider` avec `label`
- [ ] Chaque route : `pushstate` + `href` + `autoActive="strict"`
- [ ] Imports `@supersoniks/concorde/menu`, `/menu-item`, `/divider` (pas `ui/…`)
