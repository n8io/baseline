---
"app": patch
---

The render and domain-create now work from `// domain-create: domains-start` / `domains-end` marker pairs in `server.ts`, `worker.ts`, `seed.ts`, `ui/context.ts` and `ui/routes.ts` instead of copies of those files' text, so editing those files outside the pairs no longer breaks the render. `.template.json` no longer gets a `repository` field.
