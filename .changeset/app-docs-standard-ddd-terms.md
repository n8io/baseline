---
"app": major
---

The agent docs, `AGENTS.md` and the README speak the standard DDD terms the code now uses: bounded context (not Domain), Aggregate root (not Model), transition and specification (not Rule), inbound and outbound adapter (not API layer and SPI), Event handler (not Consumer), anti-corruption layer (not Bridge) and saga (not Outcome Events). Placeholders follow the files they name: `<context>` for a context's files (`<context>Scopes`, `<context>-error-status.ts`) and `<aggregate>` for an Aggregate's (`<aggregate>-table.ts`, `<aggregate>Schedule`, the `<aggregate>-list.tsx` page). The temporary `_Allowed until_` line is gone from `CONTEXT.md`, so `pnpm glossary-check` now flags every old word. `glossary-check` also skips a `kind:` value quoted in Markdown (`` `kind: "client"` ``), as it already did in code. `pnpm piece-remove queue` now says "Remove your Event handlers first". The README diagram shows the HTTP route, the Postgres adapter, the Domain event and the Event handler.

To upgrade a Project: nothing is required. `pnpm template-upgrade` brings the new docs; `pnpm glossary-check` now warns on an old word in any line a branch adds, so rename the old words in your own comments, docs and test names as you touch them. A Project README that kept the Template's `## Domains` section can rename it `## Bounded contexts`.
