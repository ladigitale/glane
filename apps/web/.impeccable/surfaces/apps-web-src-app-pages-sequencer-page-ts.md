---
version: 1
slug: "apps-web-src-app-pages-sequencer-page-ts"
primary_target: "apps/web/src/app/pages/sequencer-page.ts"
related_targets: ["apps/web/src/app/transport-bar.ts","apps/web/src/app/track-fx-control.ts","apps/web/src/app/sample-row.ts"]
---

# Arrangement

- **Route / CE:** sequencer page (`apps/web/src/app/pages/sequencer-page.ts`)
- **Mode:** Operate
- **Job:** Place / trim / arrange clips on tracks; generate; transport docked; sample drawer for drag-in.
- **Must keep:** Timeline stage dominant, Pack A, track gutters (conf + settings), gl-transport-bar, seek, `--gl-touch`.
- **Avoid:** Persuade chrome; burying Generate; hardcoded empty copy; rotate hint as raw toolbar.
- **Grammar:** Chrome primaries = Generate + Undo; rotate = sonic-alert; drawer empty = panel → Capture; 0 clips = quiet stage hint; modals already form-actions / gl-form-stack.
