---
"app": major
---

Architecture rule A27: a non-test file under `src/domains/*/use-cases/` or `src/domains/*/rules/` never contains `throw`, `try`, `catch` or `Promise.reject(`. An expected outcome returns `err(new <Name>Error())` and its error joins the Use case's error union; only adapters (`spi/`, Packages) throw, for the unexpected, and `telemetryUseCasesTrace` records it. Comments do not count.

To upgrade a Project: run `pnpm template-upgrade`, then `pnpm test`. For each A27 failure, return the error with `err(...)` instead of throwing it. Where a port's error was "unreachable" and threw, pass it on with `err(saved.error)`, widen the Use case's error union, and let the route map it like any other error.
