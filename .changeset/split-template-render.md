---
"app": patch
---

`scripts/template-render.ts` is split into `template-render-*.ts` modules, one per concern (scan, names, blocks, files, tree, release). The names `template-render.ts` exports are unchanged, and `pnpm template-upgrade` now also loads a release's `template-render-*.ts` modules when it renders with that release's own code.
