---
name: concorde-theme
description: >-
  sonic-theme — design tokens (colors, fonts, dark mode). Not API scope.
---

# Theme — design system

`<sonic-theme>` définit la base visuelle Concorde. **Pas** pour l’API (`serviceURL` → scope, skill `concorde-scope`).

```typescript
import "@supersoniks/concorde/theme";
```

```html
<sonic-theme background color font>
  …app…
</sonic-theme>

<!-- dark -->
<sonic-theme theme="dark" background color font>…</sonic-theme>
```

## Attributs

| Attribut | Rôle |
|----------|------|
| `background` | Fond page / surface (`--sc-base`) |
| `color` | Couleur texte (`--sc-base-content`) |
| `font` | Famille / graisse (`--sc-font-family-base`) |
| `theme="light"` \| `"dark"` | Palette built-in |

## Variables CSS

Override dans `:root` ou fichier CSS projet :

- Surfaces : `--sc-base`, `--sc-base-content`, `--sc-base-50` … `--sc-base-900`
- Sémantique : `--sc-primary`, `--sc-success`, `--sc-warning`, `--sc-danger`, `--sc-info` (+ `-content`)
- Forme : `--sc-rounded`, `--sc-btn-rounded`, `--sc-border-width`
- Typo : `--sc-font-family-base`, `--sc-headings-font-family`

Doc composant : `node_modules/@supersoniks/concorde/src/core/components/ui/theme/`.

Popovers, modals, toasts se montent sous le `<sonic-theme>` le plus proche.

Palette generator : [concordecolors](https://delanfranchi.github.io/concordecolors/).
