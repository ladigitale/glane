---
name: concorde-scope
description: >-
  Scope — inherited app defaults (API serviceURL, formDataProvider, icons).
  Not UI. Starter /concepts/scope.
---

# Scope — inherited configuration

Framework skill: see also **`concorde/ai/skills/concorde-scope`** (npm). Starter page: **`/concepts/scope`**, helper `scopeCallout()`.

Wrap the app in `<sonic-scope>` (light DOM). Descendants inherit attributes. Theme tokens are separate — skill `concorde-ui`, page `/ui`.

```typescript
import "@supersoniks/concorde/sonic-scope";
```

## Common attributes

| Area | Attributes | Used by |
|------|------------|---------|
| API | `serviceURL`, `token`, `credentials` | `@get`, lists, queues |
| Forms | `formDataProvider` | form fields, submit |
| Icons | `customIconLibraryPath` | `sonic-icon` `library="custom"` |

## APIConfiguration

Starter table on **`/concepts/scope`** (`concept-api-config-summary`).

Main fields: `serviceURL`, `token`, `userName`/`password`, `credentials`, `authToken`, `tokenProvider`. Advanced: `cache`, `blockUntilDone`, `keepAlive`, `addHTTPResponse`.

| Via scope | Via DataProvider |
|-----------|------------------|
| attributes on `<sonic-scope>` | object on `DataProviderKey<APIConfiguration>` |
| `@get(endpoint)` only | `@get(endpoint, apiConfigKey)` — `/demo/get` |

Type: `@supersoniks/concorde/utils/api`. Starter: `src/starter/demo/api/config.ts`.

## Remind on related pages

`/demo/get`, `/demo/list`, `/demo/queue`, `/concepts/form`, `/concepts/endpoint` — use `scopeCallout()`. Not on `/ui`.
