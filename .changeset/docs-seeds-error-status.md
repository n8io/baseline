---
"app": patch
"@n8io/baseline-http": patch
---

Docs only. `docs/agents/domain-create.md` says a seed that takes another Domain's ids must tolerate a stale one (no foreign keys between Domains; a row deleted and seeded again gets a new id). `docs/agents/api.md` and the http README say a Domain's `<domain>-error-status.ts` table is typed `as const satisfies Record<BarError["type"], number>`, not `HttpErrorStatus`, because a Domain's root imports no HTTP package.

To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/domain-create.md` and `docs/agents/api.md`.
