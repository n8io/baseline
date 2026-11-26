---
"app": major
---

Move rules from prose and the architecture test into Biome. Breaking for a Project: its `pnpm check` can now fail on code that passed before.

- `noRestrictedImports` overrides now check A1, A3 to A6, A7, A8 and A22 (the import boundaries between layers and contexts, `@hono/*` and OpenTelemetry, `varlock/env` and `#env`). `architecture-test-rules.ts` keeps what Biome cannot see: a value import of an `application/` file in `adapters/inbound/`, a value import of `src/contexts.ts` or `src/connections.ts` in a context, and a domain function reached from an adapter.
- Grit plugins check A16 (span attribute keys; the check that the key names the Use case's own context or Model is gone), A34 (a cast on a flag value), `test()` instead of `it()`, a span started outside `@n8io/baseline-telemetry`, `Math.random()` and `crypto.randomUUID()` in a Use case, and an error's `.message` on a span or in a log.
- `noRestrictedGlobals` bans `fetch`, `setTimeout` and `setInterval` in a Use case (A26).
- `noConsole` (not in `scripts/`, `test/` and `src/blocked-keys.ts`), `noParameterAssign`, `useNamingConvention` and `useFilenamingConvention` are on.
- The mock, spy and fake-timer ban also covers the test files of `packages/`.
