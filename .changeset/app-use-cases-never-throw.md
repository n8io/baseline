---
"app": major
---

Architecture rule A27: a non-test file under `src/domains/*/use-cases/` or `src/domains/*/rules/` never contains `try`, `catch` or `Promise.reject(`, and never `throw`s for an expected outcome. An expected outcome returns `err(new <Name>Error())` and its error joins the Use case's error union; adapters (`spi/`, Packages) throw for the unexpected, and `telemetryUseCasesTrace` records it. The one throw a Use case or Rule keeps is for a bug that cannot happen: `throw new Error(...)` directly under a one-line `// unreachable: <why, in a few words>`, so a request fails with a 500 and a Consumer's Event retries instead of completing with an `err`. Words in comments and strings do not count. Each failure names the file and line and says what to do instead.

To upgrade a Project: run `pnpm template-upgrade`, then `pnpm test`. For each A27 failure, return the error with `err(...)` instead of throwing it, or, for a throw that guards a bug that cannot happen, make it `throw new Error(...)` and put `// unreachable: <why>` on the line directly above it.
