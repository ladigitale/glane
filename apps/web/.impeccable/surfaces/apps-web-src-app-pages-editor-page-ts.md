---
version: 1
slug: "apps-web-src-app-pages-editor-page-ts"
primary_target: "apps/web/src/app/pages/editor-page.ts"
related_targets: ["apps/web/src/app/track-fx-control.ts","apps/web/src/app/timeline/edit-timeline.ts","apps/web/src/app/transport-bar.ts"]
---

# Editor

- **Route / CE:** editor page (`apps/web/src/app/pages/editor-page.ts`)
- **Mode:** Operate
- **Job:** Trim / select / transform one sample; transport always docked; leave saves dirty PCM.
- **Must keep:** Waveform stage dominant, Pack A tokens, sonic-* + gl-edit-timeline / gl-transport-bar, `--gl-touch`.
- **Avoid:** Demo tone as silent fallback when sample missing; Persuade chrome; burying undo with no chrome primary.
- **Grammar:** Header = back? + rename + info; status alerts (process / rotate / platine); timeline flex-fills stage; seek under wave; transport dock sticky; stretch/dynamics/forceRole = gl-form-stack + renderModalActions; empty = panel → Bibliothèque.
