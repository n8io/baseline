---
"app": major
---

The architecture rules allow what Rules need and catch what they missed.

- A2: a Rule may import other Rules of its Domain, and the types (`import type`) of `@n8io/baseline-id` and `@n8io/baseline-result`, so a Domain stops copying a Rule or a result type.
- A14: another Domain's id is found by the id prefix of the column (`postgresIdColumnCreate("team")("proposer_team_id")`), not only by a column named `<domain>_id`. A table that holds such a column without that Domain's `deleted` Consumer now fails.
- A25 (new): `api/` never calls `.openapi(` on a schema it imports from `models/` or the Domain's `index.ts`. Build the API's own schema (`z.object({ id: Foo.shape.id }).openapi("FooResponse")`).
- The `migrations` job's destructive check now includes `DROP INDEX`, so a new migration with it needs a `destructive.md`.
- `docs/agents/tracing.md` lists the attribute shapes with another Domain's id and the span names of one Event hop; `data.md` names the `destructive.md` file.

To upgrade a Project: take `architecture-test-rules.ts`, `architecture.test.ts` and `architecture-test-samples/` from the Template. Run `pnpm test architecture.test.ts`; fix an A14 failure by adding the other Domain's `deleted` Consumer, and an A25 failure by building the API schema from the Model's `shape` instead of calling `.openapi(` on the Model. The stricter `migrations` check arrives with the next `app-ci.yml@v<major>`.
