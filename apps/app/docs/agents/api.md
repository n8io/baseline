# Changing an API shape

Read when a change adds, renames or removes a field, a query parameter, an error or a route under `/api/v1`. Check it before you push: `pnpm api-check` (needs `oasdiff` on `PATH`; it prints the install line when it is missing). It builds the OpenAPI document of `origin/main` and of your working tree, and runs `oasdiff breaking --fail-on ERR`, with a removed operationId or tag raised from info to an error. CI's `check` job runs the same command. Then run `pnpm sdk-generate`: it rewrites the SDK in `clients/sdk` (`openapi.json` and the generated `sdk.ts`) from the same document, and `check` fails while the committed files differ from what it writes. The OpenAPI document declares a `bearer` scheme and requires it on every operation, and `/api/v1/docs` shows it as an interactive reference with an Authorize button (a removable piece; see `pieces.md`).

## What oasdiff allows

- A new optional request field or query parameter. A new required one is breaking: add it optional.
- A new response field.
- A new error code on a status the route already answers, or a new status. Problem `code` is an extensible enum, so a client treats an unknown code as its status's general failure.
- A removed response field, but only one release after it was marked `deprecated: true`.
- Every `sort` value is contract: narrowing the list is breaking. Removing a query parameter is only a warning, but a client still sends it.

## Expand, then contract

A rename or a removal is two releases. First add the new shape beside the old one and mark the old one `deprecated: true`. Remove the old one in a later release, once no client reads it. Never do both in one change.

## Problem titles and statuses

`httpErrorBodyCreate(error, status)` sets `title` to the status's reason phrase and `code` to the error's `type`:

| Status | Title                |
| ------ | -------------------- |
| 400    | Bad Request          |
| 401    | Unauthorized         |
| 403    | Forbidden            |
| 404    | Not Found            |
| 409    | Conflict             |
| 422    | Unprocessable Entity |
| 429    | Too Many Requests    |

A Use case's error union becomes the route's statuses. Each `type` in the union needs an entry in the Domain's `<domain>-error-status.ts` table (at the Domain's root and exported from `index.ts`, so pages map a failed Result through it too instead of copying statuses), and a route lists the types it can answer in `httpErrorResponsesCreate(table, types)`. Adding a type to a union adds a code, or a whole status, to every route that returns it, so run `pnpm api-check` after changing a union.

Type that table `as const satisfies Record<BarError["type"], number>`, not with `HttpErrorStatus` from `@n8io/baseline-http`: a Domain's root imports no HTTP package (the architecture test refuses it), and `adapters/inbound/` files import the table from `../index.ts`.

Give a route its error list inline, or declare it `as const`: `httpErrorResponsesCreate` takes a `readonly` list. Typing the list as a plain `string[]` fails type-checking, because the types must be keys of the table.

## Route conventions

- Every route sets `operationId` to the name of the Use case its handler calls (`invoiceCreate`) and exactly one tag, its Domain in camelCase (`tags: ["invoice"]`). Generated SDK methods and CLI commands take their names from both, so a renamed or removed operationId or tag is breaking: `pnpm api-check` fails on it. A route has one operationId, so once it ships keep it; a new name waits for the next API major (`/api/v2`). `test/integration/server-wiring.test.ts` checks every operation, and `domain-create` writes both for a new Domain.
- A business verb beyond create, update and delete is a command route: `POST /<things>/{<thing>Id}/<verb>` (`POST /trades/{tradeId}/accept`). It answers 200 with the changed resource.
- A request that names another Domain's id that does not exist answers 422 (the request is well formed, its reference is not). 404 is only for the resource in the path.
- An upsert (`PUT` that creates or replaces) answers 200 either way, so a caller that retries sees one status.
