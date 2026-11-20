# Zod inside a Package, never required of its callers

Status: accepted, 2026-11-13

A Package may use Zod inside as a regular dependency, but no export names a Zod type and `zod` is never a peer, so a caller picks its own schema library. Where a caller passes a schema, the Package takes any Standard Schema (`StandardSchemaV1`) and its README shows a Zod example. `@n8io/baseline-http` is the one exception and keeps its Zod peer, because it is built on `@hono/zod-openapi` and the Standard Schema alternative was still in development. Do not swap a Package's internal Zod for hand-written checks only to drop the dependency.
