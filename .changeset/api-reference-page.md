---
"app": minor
---

The Template serves an interactive API reference at `/api/v1/docs`, and its OpenAPI document declares bearer auth.

- The page is Swagger UI, self-hosted from `swagger-ui-dist` (the new dependency), with its script and stylesheet served from the app's own origin and the request's CSP nonce on both script tags. It answers without a token in every environment, like `/api/v1/openapi.json`; `httpSecureHeaders` is unchanged. Use Authorize with a token from the memory issuer (`authnMemoryTokenFetch`) or your provider to send requests.
- `/api/v1/openapi.json` now has a `bearer` security scheme (`type: http`, `scheme: bearer`, `bearerFormat: JWT`) and a document-level `security` requirement, so generated clients and viewers know every operation needs a token.
- It is the `api-reference` piece: `pnpm piece-remove api-reference` removes `src/api-reference.ts`, its tests, its block in `src/server.ts`, the dependency and the `@scarf/scarf` line in `pnpm-workspace.yaml`.

To upgrade a Project: `pnpm template-upgrade`. To remove the page, run `pnpm piece-remove api-reference` afterwards; `/api/v1/docs` then answers the API's JSON 404. The `/api/v1/docs` exemption in the "no Actor, no API" guard stays in `server.ts`.
