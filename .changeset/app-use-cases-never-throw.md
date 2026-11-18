---
"app": major
---

Architecture rule A27: a non-test file under `src/domains/*/use-cases/` or `src/domains/*/rules/` never contains `try`, `catch` or `Promise.reject(`, and never `throw`s for an expected outcome. An expected outcome returns `err(new <Name>Error())` and its error joins the Use case's error union; adapters (`spi/`, Packages) throw for the unexpected, and `telemetryUseCasesTrace` records it. The one throw a Use case or Rule keeps is for a broken invariant (a bug), with a `// unreachable: <why it cannot happen>` comment on the line above it, so a request fails with a 500 and a Consumer's Event retries instead of completing with an `err`. Comments do not count as code.

To upgrade a Project: run `pnpm template-upgrade`, then `pnpm test`. For each A27 failure, return the error with `err(...)` instead of throwing it, or, for a throw that guards a broken invariant, put `// unreachable: <why>` on the line above it.
