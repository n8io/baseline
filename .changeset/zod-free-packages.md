---
"@n8io/baseline-cache": minor
"@n8io/baseline-queue": minor
"@n8io/baseline-id": major
"@n8io/baseline-authn": major
"app": major
---

Four Packages no longer need you to install Zod to use them. You bring the schema library, and each README shows how to pass a Zod schema.

- `@n8io/baseline-cache` and `@n8io/baseline-queue`: `cacheCreate`'s `schema` and `queueConsumerCreate`'s schema are any [Standard Schema](https://standardschema.dev), so a Zod, Valibot or ArkType schema goes in as it is. Calls that pass a Zod schema do not change. The `zod` peer is gone. A Consumer's validation error now names the paths that failed in its message (`Event failed validation for billing.order-placed at totalCents`) and has no `cause`, so no validator can put an Event's values in a log.
- `@n8io/baseline-id`: `idSchemaCreate` is gone. `idPatternCreate(prefix)` returns the `RegExp` to build an id schema from, in any schema library.
- `@n8io/baseline-authn`: `Actor` is a type only; the Zod schema of the same name is no longer exported. Zod is the package's own dependency now, not a peer.

`@n8io/baseline-http` keeps its `zod` peer: it is built on `@hono/zod-openapi`.

In the Template, the new `src/id-schema.ts` exports `idSchemaCreate`, the Zod schema built from `idPatternCreate`. Foo: `models/foo.ts` imports `idSchemaCreate` from `../../../id-schema.ts`, not from `@n8io/baseline-id`, and `ui/routes/foo-detail.tsx` parses the id with `Foo.shape.id`. When you upgrade, change that import in every Domain's `models/<domain>.ts` and anywhere else that imports `idSchemaCreate`.
