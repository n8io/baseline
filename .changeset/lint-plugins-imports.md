---
"app": minor
---

The import rules A2 (domain imports), A7 (`@hono` in domain), A9 (logger), A10 (UI and contexts), A19 (memory adapters), A21 (shared Packages in business code) and A24 (Package `/testing` helpers) move from the architecture test to `noRestrictedImports` overrides in `biome.json`, so `pnpm check` and the editor report them. The overrides skip test files and cannot tell `import type` from a value import: A2 now allows the id and authn Packages by name, and A21 allows `Inbox` and `Actor` by name. Keep your own `noRestrictedImports` entries in the matching override when you upgrade.
