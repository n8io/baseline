---
"app": major
---

A new removable `sdk` piece: a typed TypeScript SDK generated from the API's OpenAPI document, in `clients/sdk` as its own package (`<project>-sdk`). It exports one function per operation, named by its operationId (`invoiceCreate(body)`), each resolving to `{ status, data, headers }` typed by status, and `sdkConfigure({ baseUrl, token })`; callers install no runtime dependency. `pnpm sdk-generate` writes `clients/sdk/openapi.json` from the app's document and `clients/sdk/sdk.ts` from it (orval, a dev dependency, named only in `scripts/sdk-generate.ts`). app-ci's `check` job gains a step that fails when the committed SDK differs from what `pnpm sdk-generate` writes. The Project's `pnpm-workspace.yaml` now lists the root and `clients/*`, with `ignoreWorkspaceRootCheck` so `pnpm add` in the root still adds to the app, and `.dockerignore` keeps `clients/` out of the image. `pnpm piece-remove sdk` takes it all out (`docs/agents/pieces.md`, "The SDK").

To upgrade a Project: after `pnpm template-upgrade`, run `pnpm install` and `pnpm sdk-generate`, and commit `clients/sdk`: the upgrade brings the SDK of a Project with no routes, and `check` fails until it is generated from yours. Run `pnpm sdk-generate` after every route change from then on. If the Project will never publish an SDK, run `pnpm piece-remove sdk` instead.
