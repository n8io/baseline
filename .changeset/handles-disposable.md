---
"@n8io/baseline-analytics": major
"@n8io/baseline-health": major
"@n8io/baseline-live": major
"@n8io/baseline-postgres": major
"@n8io/baseline-pulsar": major
"@n8io/baseline-queue": major
"app": patch
---

Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.
