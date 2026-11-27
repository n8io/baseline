---
"app": patch
---

`template-upgrade` loads every render module a release imports, found by following the entry point's imports, instead of copying only `template-render.ts` and a fixed name pattern. A release that splits its render code (app@18.0.0) no longer fails with `Cannot find module template-render-blocks.ts`.
