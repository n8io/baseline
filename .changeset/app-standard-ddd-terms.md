---
"app": major
---

`CONTEXT.md`'s `## Architecture` now uses the standard DDD and hexagonal terms, recorded in the repo's first ADR (`docs/adr/0001-standard-ddd-terms.md`): Bounded context, Aggregate root, Entity, Value object, Invariant, Specification, Domain service, Inbound adapter, Outbound adapter, Domain event, Published language, Event handler, Outbox, Anti-corruption layer, Saga, Projection, Subdomain, Context map and Shared kernel, plus Module, Interface, Seam and Adapter. Domain, Model, Rule, API (as a layer), SPI, Consumer, Bridge and Outcome Events are now `_Avoid_` aliases of their replacements. The code still uses the old words until later releases move it, so a new `_Allowed until <when>_:` line keeps those aliases out of `pnpm glossary-check` for now.

To upgrade a Project: run `pnpm template-upgrade` and take the Template's `## Architecture` section of `CONTEXT.md` as it is, including the `_Allowed until_` line; keep your own `## Language` terms. Nothing else changes yet: your code, folders and commands stay as they are until the later bounded-context releases.
