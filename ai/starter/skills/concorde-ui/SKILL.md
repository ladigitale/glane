---
name: concorde-ui
description: >-
  Concorde UI kit — pick sonic-button, sonic-badge, sonic-card, alerts, forms,
  and other components by use case. Short imports from @supersoniks/concorde/*.
---

# Concorde UI kit — use cases

Starter demo: **`/ui`** (`src/starter/ui/components/ui-kit-demo.ts`).

Full component reference: markdown files under `node_modules/@supersoniks/concorde/src/core/components/` (e.g. `ui/button/button.md`, `ui/badge/badge.md`).

Always use **short imports** — see skill `concorde-imports`.

App-wide defaults (API, forms, icons): skill **`concorde-scope`** — `/concepts/scope`. Theme: **`concorde-theme`** (framework) + this skill for UI components.

## Theme — design tokens

Framework: skill **`concorde-theme`**. Starter demo: **`/ui`**.

Wrap app with `<sonic-theme background color font>`. Override `--sc-*` in `src/css/app.css`.

**Not** for API — use scope (`concorde-scope`).

## Pick a component

| Use case | Component | Notes |
|----------|-----------|--------|
| Primary action (submit, save) | `sonic-button` `type="primary"` | Default variant |
| Secondary / cancel | `sonic-button` `variant="outline"` or `ghost` | Lower emphasis |
| Destructive action | `sonic-button` `type="danger"` | Confirm in modal when irreversible |
| Navigation as button | `sonic-button` `href` + optional `pushstate` | Same styling as buttons |
| Icon-only control | `sonic-button` `shape="circle"` + `sonic-icon` in slot | Set `data-aria-label` |
| Toggle / radio group | `sonic-button` `radio` + `sonic-group` | See button docs |
| Async in progress | `sonic-button` `loading` or `sonic-loader` | Keeps layout stable |
| Status label (non-clickable) | `sonic-badge` | Same `type` / `variant` as buttons |
| Count on action | `sonic-badge` `slot="suffix"` inside button | e.g. inbox unread |
| Content panel | `sonic-card` + `sonic-card-header` | `type` for surface color |
| Success / error message | `sonic-alert` `status="success\|error\|warning\|info"` | Inline feedback |
| Section break | `sonic-divider` | Optional `label`, `align` |
| Text link | `sonic-link` | Styled anchor |
| Form field | `sonic-input`, `sonic-select`, `sonic-checkbox`, `sonic-switch`, `sonic-textarea` | With `formDataProvider` — see `/concepts/form` |
| Field grouping | `sonic-fieldset`, `sonic-form-layout`, `sonic-form-actions` | Layout + actions row |
| App navigation | `sonic-menu` + `sonic-menu-item` | Skill `concorde-menu` |
| Modal dialog | `sonic-modal` + title/content/actions | Confirmations, forms |
| Toast notification | `sonic-toast` | Transient global messages |
| Data table | `sonic-table` + thead/tbody/tr/td | Tabular data |
| Image | `sonic-image` | `ratio`, `rounded` |
| Tooltip | `sonic-tooltip` | Hint on hover/focus |

## Shared API (button & badge)

Both support:

- **`type`**: `default`, `primary`, `neutral`, `warning`, `danger`, `success`, `info` (badge also `contrast`)
- **`variant`**: `default`, `outline`, `ghost`, `link` (button also `unstyled`)
- **`size`**: `2xs` … `2xl`

Prefer semantic **type** for meaning; use **variant** for emphasis within that meaning.

## Examples

```typescript
import "@supersoniks/concorde/button";
import "@supersoniks/concorde/badge";
import "@supersoniks/concorde/card";
import "@supersoniks/concorde/card-header";
import "@supersoniks/concorde/alert";
import "@supersoniks/concorde/divider";
import "@supersoniks/concorde/icon";
import "@supersoniks/concorde/input";
```

```html
<sonic-button type="primary">Save</sonic-button>
<sonic-badge type="success">Active</sonic-badge>

<sonic-card type="base">
  <sonic-card-header label="Settings"></sonic-card-header>
  …
</sonic-card>

<sonic-alert status="error" label="Error">Something went wrong.</sonic-alert>
```

## When to use functional components instead

| Need | Use |
|------|-----|
| List of rows from API | `sonic-list` — `/demo/list` |
| Infinite scroll list | `sonic-queue` — `/demo/queue` |
| Single API read in component | `@get` — `/demo/get` |
| Shared app state | DataProvider + decorators — `/concepts/*` |

UI components handle **presentation**; DataProvider / `@get` / list / queue handle **data**.
